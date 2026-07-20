const app = (() => {
  // --- State & Config ---
  let stream = null;
  let currentId = null;
  let apiKey = "";
  let pendingInitialPull = false;

  // --- GitHub Auto-Push (debounced & serialized) ---
  let pushTimer = null;
  let pushChain = Promise.resolve();

  function scheduleAutoPush() {
    if (!GitHubSync.isConfigured()) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      pushChain = pushChain
        .then(() => performAutoPush())
        .catch((err) => console.error("GitHub auto-push failed:", err));
    }, 1500);
  }

  async function performAutoPush() {
    const allData = await dbManager.getAll();
    const dataStr = JSON.stringify(allData, null, 2);
    await GitHubSync.pushToGitHub(
      dataStr,
      "Update music database - " + new Date().toISOString(),
    );
    localStorage.setItem("last_github_upload", Date.now().toString());
  }

  async function tryInitialPull() {
    try {
      const items = await GitHubSync.pullFromGitHub();
      for (const item of items) await dbManager.save(item);
      await renderList();
      updateSyncStatus();
      console.log(`Initial pull: imported ${items.length} albums from GitHub`);
    } catch (err) {
      if (err.status === 404) {
        console.log("GitHub file does not exist yet (404) - expected on first run");
        return;
      }
      console.error("Initial pull from GitHub failed:", err.message || err);
      const statusEl = document.getElementById("sync-status");
      if (statusEl) {
        statusEl.textContent = `GitHub sync error: ${err.message || "unknown error"}`;
      }
    }
  }

  // --- IndexedDB Manager ---
  const dbManager = {
    dbName: "MusicCollectorDB",
    dbVersion: 1,
    storeName: "albums",
    db: null,

    async open() {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(this.dbName, this.dbVersion);
        request.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(this.storeName)) {
            db.createObjectStore(this.storeName, { keyPath: "id" });
          }
        };
        request.onsuccess = (e) => {
          this.db = e.target.result;
          resolve();
        };
        request.onerror = (e) => reject("DB Error");
      });
    },

    async getAll() {
      return new Promise((resolve) => {
        const tx = this.db.transaction([this.storeName], "readonly");
        const store = tx.objectStore(this.storeName);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result);
      });
    },

    async save(item) {
      return new Promise((resolve) => {
        const tx = this.db.transaction([this.storeName], "readwrite");
        const store = tx.objectStore(this.storeName);
        item.updatedAt = Date.now();
        item.synced = false;
        const req = store.put(item);
        req.onsuccess = () => resolve();
      });
    },

    async delete(id) {
      return new Promise((resolve) => {
        const tx = this.db.transaction([this.storeName], "readwrite");
        const store = tx.objectStore(this.storeName);
        const req = store.delete(id);
        req.onsuccess = () => resolve();
      });
    },
  };

  // --- DOM Cache ---
  const els = {
    list: document.getElementById("album-list"),
    video: document.getElementById("video-feed"),
    modals: {
      camera: document.getElementById("camera-modal"),
      editor: document.getElementById("editor-modal"),
      settings: document.getElementById("settings-modal"),
      loading: document.getElementById("loading-overlay"),
    },
    inputs: {
      artist: document.getElementById("inp-artist"),
      album: document.getElementById("inp-album"),
      composer: document.getElementById("inp-composer"),
      year: document.getElementById("inp-year"),
      medium: document.getElementById("inp-medium"),
      company: document.getElementById("inp-company"),
      songs: document.getElementById("inp-songs"),
      apikey: document.getElementById("inp-apikey"),
      preview: document.getElementById("preview-img"),
      token: document.getElementById("github-token"),
      branch: document.getElementById("github-branch"),
    },
    deleteBtn: document.getElementById("btn-delete"),
    loadingText: document.getElementById("loading-text"),
  };

  // --- Initialization ---
  async function init() {
    try {
      await dbManager.open();
      apiKey = localStorage.getItem("geminiApiKey") || "";
      els.inputs.apikey.value = apiKey;

      // Load GitHub settings via GitHubSync (it also populates the input fields)
      GitHubSync.loadSettings();

      const savedTheme = document.documentElement.getAttribute("data-theme");
      if (savedTheme === "dark") {
        document.getElementById("icon-sun").style.display = "";
        document.getElementById("icon-moon").style.display = "none";
      }
      await renderList();

      // Auto-pull on empty DB at startup
      const allData = await dbManager.getAll();
      if (allData.length === 0) {
        if (GitHubSync.isConfigured()) {
          console.log("DB is empty and GitHub is configured - attempting initial pull...");
          await tryInitialPull();
        } else {
          console.log("DB is empty and GitHub is not configured - prompting user for settings");
          pendingInitialPull = true;
          openSettings();
        }
      }

      console.log("App Initialized. DB Open.");
    } catch (err) {
      console.error(err);
    }
  }

  // --- Camera & Capture ---
  async function startCamera() {
    if (!apiKey) {
      alert("Please set API Key in settings.");
      openSettings();
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 } },
      });
      els.video.srcObject = stream;
      els.modals.camera.style.display = "flex";
    } catch (e) {
      alert("Camera error: " + e.message);
    }
  }

  function closeCamera() {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    els.modals.camera.style.display = "none";
  }

  function capture() {
    const vW = els.video.videoWidth;
    const vH = els.video.videoHeight;
    if (vW === 0) return;

    const sourceSize = Math.min(vW, vH);
    const startX = (vW - sourceSize) / 2;
    const startY = (vH - sourceSize) / 2;

    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = 300;
    cropCanvas.height = 300;
    const cropCtx = cropCanvas.getContext("2d");

    cropCtx.imageSmoothingEnabled = true;
    cropCtx.imageSmoothingQuality = "high";
    cropCtx.drawImage(els.video, startX, startY, sourceSize, sourceSize, 0, 0, 300, 300);

    const base64 = cropCanvas.toDataURL("image/jpeg", 0.8);
    console.log("Image Captured at 300x300");

    closeCamera();
    analyzeImage(base64);
  }

  // --- AI Integration ---
  async function analyzeImage(base64Image) {
    showLoading(true, "AI Analyzing Image...");

    const cleanBase64 = base64Image.replace(/^data:image\/(png|jpeg);base64,/, "");

    const prompt = `
            Analyze this music album cover. Return ONLY a valid JSON object with keys:
            Artist, Albumtitle, Composer, Year, songlist (array), mediumtype, and recordcompany.
            No markdown formatting or extra text.
        `;

    // UPDATED TO EXACT REQUESTED MODEL: gemini-3-flash-preview using v1beta endpoint
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;
    // using the GLOBAL endpoint
    // model choises at this moment (27/02/2026) are:
    // gemini-3.1-flash-image-preview
    // gemini-3.1-pro-preview
    // gemini-3-flash-preview
    // gemini-2.5-pro
    // gemini-2.0-flash

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                { inline_data: { mime_type: "image/jpeg", data: cleanBase64 } },
              ],
            },
          ],
        }),
      });

      if (!response.ok) throw new Error("API Network Error: " + response.status);

      const data = await response.json();
      console.log("Raw AI Response:", data);

      if (!data.candidates || !data.candidates[0].content) throw new Error("No data from AI");

      const textResponse = data.candidates[0].content.parts[0].text;

      // Safe JSON Extraction (Regex to find JSON inside the text)
      const jsonMatch = textResponse.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("Could not find JSON in AI response");

      const result = JSON.parse(jsonMatch[0]);
      console.log("Parsed AI Data:", result);

      openEditor(result, base64Image);
    } catch (err) {
      console.error("Gemini Error:", err);
      alert("AI Error: " + err.message + ". Opening editor for manual entry.");
      openEditor({}, base64Image);
    } finally {
      showLoading(false);
    }
  }

  // --- Editor Logic ---
  function openEditor(data, imageSrc) {
    currentId = data.id || null;

    // Reset and populate fields
    if (els.inputs.preview) els.inputs.preview.src = imageSrc || data.image || "";
    if (els.inputs.artist) els.inputs.artist.value = data.Artist || "";
    if (els.inputs.album) els.inputs.album.value = data.Albumtitle || "";
    if (els.inputs.composer) els.inputs.composer.value = data.Composer || "";
    if (els.inputs.year) els.inputs.year.value = data.Year || "";
    if (els.inputs.company) els.inputs.company.value = data.recordcompany || "";

    // Medium
    if (els.inputs.medium) {
      let medium = "CD";
      if (data.mediumtype) {
        const m = data.mediumtype.toLowerCase();
        if (m.includes("vinyl") || m.includes("lp")) medium = "Vinyl";
      }
      els.inputs.medium.value = medium;
    }

    // Songs
    if (els.inputs.songs) {
      els.inputs.songs.value = Array.isArray(data.songlist)
        ? data.songlist.join("\n")
        : data.songlist || "";
    }

    els.deleteBtn.style.display = currentId ? "block" : "none";
    els.modals.editor.style.display = "flex";
  }

  async function saveEntry() {
    const entry = {
      id: currentId || crypto.randomUUID(),
      image: els.inputs.preview.src,
      Artist: els.inputs.artist.value,
      Albumtitle: els.inputs.album.value,
      Composer: els.inputs.composer.value,
      Year: els.inputs.year.value,
      mediumtype: els.inputs.medium.value,
      recordcompany: els.inputs.company.value,
      songlist: els.inputs.songs.value.split("\n").filter((s) => s.trim() !== ""),
    };

    await dbManager.save(entry);
    await renderList();
    closeEditor();
    scheduleAutoPush();
  }

  async function deleteCurrent() {
    if (confirm("Delete this album?")) {
      await dbManager.delete(currentId);
      await renderList();
      closeEditor();
      scheduleAutoPush();
    }
  }

  // --- View Logic ---
  async function renderList(searchTerm = "") {
    els.list.innerHTML = "";
    const term = searchTerm.toLowerCase();
    const allItems = await dbManager.getAll();

    // UPDATED: Now filters by Albumtitle, Artist, OR Composer
    const filtered = allItems
      .filter(
        (item) =>
          (item.Albumtitle && item.Albumtitle.toLowerCase().includes(term)) ||
          (item.Artist && item.Artist.toLowerCase().includes(term)) ||
          (item.Composer && item.Composer.toLowerCase().includes(term)),
      )
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    filtered.forEach((item) => {
      const div = document.createElement("div");
      div.className = "album-card";
      div.innerHTML = `
                  <img src="${item.image}" class="album-img" alt="Cover">
                  <div class="album-info">
                      <p class="album-artist">${item.Artist || "Unknown Artist"}</p>
                      <p class="album-title">${item.Albumtitle || "Unknown Album"}</p>
                      <div class="album-meta">
                          ${item.Year || "?"} • ${item.mediumtype}
                      </div>
                  </div>
              `;
      div.onclick = () => openEditor(item);
      els.list.appendChild(div);
    });

    // Optional: Show a message if no results are found
    if (filtered.length === 0) {
      els.list.innerHTML = `<p class="empty-message">No albums found matching "${searchTerm}".</p>`;
    }
  }

  // --- Utilities ---
  function search() {
    renderList(document.getElementById("search-input").value);
  }
  function timeAgo(ts) {
    const mins = Math.floor((Date.now() - ts) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  async function updateSyncStatus() {
    const el = document.getElementById("sync-status");
    if (!el) return;
    const allData = await dbManager.getAll();
    const count = allData.length;
    const lastUpload = localStorage.getItem("last_github_upload");
    let text = `${count} album${count !== 1 ? "s" : ""}`;
    if (lastUpload) {
      text += ` · Last synced ${timeAgo(parseInt(lastUpload, 10))}`;
    } else if (GitHubSync.isConfigured()) {
      text += " · Never synced to GitHub";
    }
    el.textContent = text;
  }

  function openSettings() {
    updateSyncStatus();
    els.modals.settings.style.display = "flex";
  }
  function closeSettings() {
    els.modals.settings.style.display = "none";
  }
  function toggleTheme() {
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    const newTheme = isDark ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", newTheme);
    localStorage.setItem("theme", newTheme);
    document.getElementById("icon-sun").style.display = newTheme === "dark" ? "" : "none";
    document.getElementById("icon-moon").style.display = newTheme === "dark" ? "none" : "";
  }
  function closeEditor() {
    els.modals.editor.style.display = "none";
    currentId = null;
  }
  function saveSettings() {
    apiKey = els.inputs.apikey.value.trim();
    localStorage.setItem("geminiApiKey", apiKey);
    const token = els.inputs.token.value.trim();
    localStorage.setItem("github_token", token);
    const branch = els.inputs.branch.value.trim();
    localStorage.setItem("github_branch", branch);

    // Reload GitHub settings into GitHubSync.config
    GitHubSync.loadSettings();

    // If we were waiting for settings to be configured and now they are, do initial pull
    if (pendingInitialPull && GitHubSync.isConfigured()) {
      pendingInitialPull = false;
      tryInitialPull().then(() => closeSettings());
    } else {
      closeSettings();
    }
  }

  function showLoading(show, text = "Loading...") {
    if (els.loadingText) els.loadingText.innerText = text;
    els.modals.loading.style.display = show ? "flex" : "none";
  }

  // --- Import / Export ---
  async function exportData() {
    showLoading(true, "Exporting...");
    try {
      const allData = await dbManager.getAll();
      const dataStr =
        "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(allData));
      const a = document.createElement("a");
      a.href = dataStr;
      a.download = "music_db_backup.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      showLoading(false);
    }
  }

  async function pushGitHub() {
    GitHubSync.loadSettings();
    if (!GitHubSync.isConfigured()) {
      alert("Please configure a GitHub token in Settings first.");
      return;
    }
    if (!confirm("Push local database to GitHub? This will overwrite the remote file.")) return;
    showLoading(true, "Pushing to GitHub...");
    try {
      const allData = await dbManager.getAll();
      const dataStr = JSON.stringify(allData, null, 2);
      await GitHubSync.pushToGitHub(
        dataStr,
        "Update music database - " + new Date().toISOString(),
      );
      localStorage.setItem("last_github_upload", Date.now().toString());
      updateSyncStatus();
      alert(`Successfully pushed ${allData.length} albums to GitHub.`);
    } catch (err) {
      alert("Push failed: " + err.message);
    } finally {
      showLoading(false);
    }
  }

  async function pullGitHub() {
    GitHubSync.loadSettings();
    if (!GitHubSync.isConfigured()) {
      alert("Please configure a GitHub token in Settings first.");
      return;
    }
    if (!confirm("Pull from GitHub? Matching local albums will be overwritten.")) return;
    showLoading(true, "Pulling from GitHub...");
    try {
      const items = await GitHubSync.pullFromGitHub();
      for (const item of items) await dbManager.save(item);
      await renderList();
      updateSyncStatus();
      closeSettings();
      alert(`Imported ${items.length} albums from GitHub.`);
    } catch (err) {
      if (err.status === 404) {
        alert("No file found on GitHub yet. You can create one by pushing local data.");
      } else {
        alert("Pull failed: " + err.message);
      }
    } finally {
      showLoading(false);
    }
  }

  function triggerImport() {
    document.getElementById("import-file").click();
  }

  async function importData(input) {
    const file = input.files[0];
    if (!file) return;
    showLoading(true, "Importing...");
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      if (!Array.isArray(json)) throw new Error("Expected a JSON array");
      for (const item of json) await dbManager.save(item);
      await renderList();
      closeSettings();
      alert(`Imported ${json.length} albums.`);
      scheduleAutoPush();
    } catch (err) {
      alert("Error importing file: " + err.message);
    } finally {
      showLoading(false);
      input.value = "";
    }
  }

  return {
    init,
    startCamera,
    capture,
    closeCamera,
    saveEntry,
    deleteCurrent,
    search,
    openSettings,
    closeSettings,
    saveSettings,
    exportData,
    pushGitHub,
    pullGitHub,
    triggerImport,
    importData,
    closeEditor,
    toggleTheme,
  };
})();

document.addEventListener("DOMContentLoaded", app.init);
