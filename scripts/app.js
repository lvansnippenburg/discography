const app = (() => {
  // --- State & Config ---
  let stream = null;
  let currentId = null;
  let apiKey = "";

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
      discogs: document.getElementById("inp-discogs"),
      token: document.getElementById("codeberg-token"),
      filepath: document.getElementById("codeberg-music-filepath"),
      branch: document.getElementById("codeberg-branch"),
    },
    discogsBtn: document.getElementById("btn-discogs-link"),
    deleteBtn: document.getElementById("btn-delete"),
    loadingText: document.getElementById("loading-text"),
  };

  // --- Initialization ---
  async function init() {
    try {
      await dbManager.open();
      apiKey = localStorage.getItem("geminiApiKey") || "";
      els.inputs.apikey.value = apiKey;
      token = localStorage.getItem("codeberg_token");
      els.inputs.token.value = token;
      filepath = localStorage.getItem("codeberg_music_filepath");
      els.inputs.filepath.value = filepath;
      branch = localStorage.getItem("codeberg_branch");
      els.inputs.branch.value = branch;
      await renderList();
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
            Artist, Albumtitle, Composer, Year, songlist (array), mediumtype, recordcompany, and discogsUrl (provide a Discogs Master Release link).
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
    if (els.inputs.discogs) els.inputs.discogs.value = data.discogsUrl || "";

    // Discogs Link Button
    if (els.discogsBtn) {
      if (data.discogsUrl && data.discogsUrl.startsWith("http")) {
        els.discogsBtn.href = data.discogsUrl;
        els.discogsBtn.style.display = "inline-block";
      } else {
        els.discogsBtn.style.display = "none";
      }
    }

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
      discogsUrl: els.inputs.discogs ? els.inputs.discogs.value : "",
      songlist: els.inputs.songs.value.split("\n").filter((s) => s.trim() !== ""),
    };

    await dbManager.save(entry);
    await renderList();
    closeEditor();
  }

  async function deleteCurrent() {
    if (confirm("Delete this album?")) {
      await dbManager.delete(currentId);
      await renderList();
      closeEditor();
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
                          ${item.discogsUrl ? `• <a href="${item.discogsUrl}" target="_blank" style="color:var(--primary-color); font-size:0.75rem;" onclick="event.stopPropagation()">Discogs</a>` : ""}
                      </div>
                  </div>
              `;
      div.onclick = () => openEditor(item);
      els.list.appendChild(div);
    });

    // Optional: Show a message if no results are found
    if (filtered.length === 0) {
      els.list.innerHTML = `<p style="text-align:center; color:#555; margin-top:50px; width:100%;">No albums found matching "${searchTerm}".</p>`;
    }
  }

  // --- Utilities ---
  function search() {
    renderList(document.getElementById("search-input").value);
  }
  function openSettings() {
    els.modals.settings.style.display = "flex";
  }
  function closeSettings() {
    els.modals.settings.style.display = "none";
  }
  function closeEditor() {
    els.modals.editor.style.display = "none";
    currentId = null;
  }
  function saveSettings() {
    apiKey = els.inputs.apikey.value.trim();
    localStorage.setItem("geminiApiKey", apiKey);
    token = els.inputs.token.value.trim();
    localStorage.setItem("codeberg_token", token);
    filepath = els.inputs.filepath.value.trim();
    localStorage.setItem("codeberg_music_filepath", filepath);
    branch = els.inputs.branch.value.trim();
    localStorage.setItem("codeberg_branch", branch);
    closeSettings();
  }

  function showLoading(show, text = "Loading...") {
    if (els.loadingText) els.loadingText.innerText = text;
    els.modals.loading.style.display = show ? "flex" : "none";
  }

  // --- Import / Export ---
  async function exportData() {
    const allData = await dbManager.getAll();
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(allData));
    const a = document.createElement("a");
    a.href = dataStr;
    a.download = "music_db_backup.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function exportCodeberg() {
    const allData = await dbManager.getAll();
    const dataStr = JSON.stringify(allData, null, 2);
    await CodebergSync.init();
    await CodebergSync.pushToCodeberg(
      dataStr,
      "Update music database - " + new Date().toISOString(),
    );
  }

  function triggerImport() {
    document.getElementById("import-file").click();
  }

  async function importData(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const json = JSON.parse(e.target.result);
        if (Array.isArray(json)) {
          for (const item of json) await dbManager.save(item);
          await renderList();
          alert("Imported!");
        }
      } catch (err) {
        alert("Error parsing file.");
      }
    };
    reader.readAsText(file);
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
    exportCodeberg,
    triggerImport,
    importData,
    closeEditor,
  };
})();

document.addEventListener("DOMContentLoaded", app.init);
