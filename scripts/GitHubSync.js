var GitHubSync = (function () {
  const config = {
    token: "",
    owner: "lvansnippenburg",
    repo: "discography",
    filepath: "data/music.json",
    branch: "main",
    baseUrl: "https://api.github.com",
  };

  function loadSettings() {
    const token = localStorage.getItem("github_token") || "";
    const branch = localStorage.getItem("github_branch") || "main";

    config.token = token;
    config.branch = branch;

    console.log("GitHub settings loaded:", { token: token ? "***" : "(empty)", branch, owner: config.owner, repo: config.repo, filepath: config.filepath });

    // Populate input fields if they exist
    const tokenEl = document.getElementById("github-token");
    const branchEl = document.getElementById("github-branch");
    if (tokenEl) tokenEl.value = token;
    if (branchEl) branchEl.value = branch;
  }

  function isConfigured() {
    return !!this.config.token;
  }

  function headers() {
    return {
      "Authorization": `Bearer ${config.token}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
  }

  async function pushToGitHub(content, message) {
    // Step 1: Get current file SHA
    const getUrl = `${config.baseUrl}/repos/${config.owner}/${config.repo}/contents/${config.filepath}?ref=${config.branch}`;
    const getResponse = await fetch(getUrl, {
      method: "GET",
      headers: headers(),
    });

    let sha = null;
    if (getResponse.ok) {
      const data = await getResponse.json();
      sha = data.sha;
    } else if (getResponse.status !== 404) {
      const data = await getResponse.json();
      throw new Error(data.message || "Failed to fetch file SHA");
    }

    // Step 2: Put file with content
    const putUrl = `${config.baseUrl}/repos/${config.owner}/${config.repo}/contents/${config.filepath}`;
    const payload = {
      message,
      content: btoa(unescape(encodeURIComponent(content))),
      branch: config.branch,
    };
    if (sha) {
      payload.sha = sha;
    }

    const putResponse = await fetch(putUrl, {
      method: "PUT",
      headers: headers(),
      body: JSON.stringify(payload),
    });

    if (!putResponse.ok) {
      const data = await putResponse.json();
      throw new Error(data.message || "Push failed");
    }

    return await putResponse.json();
  }

  async function pullFromGitHub() {
    const url = `${config.baseUrl}/repos/${config.owner}/${config.repo}/contents/${config.filepath}?ref=${config.branch}`;
    const response = await fetch(url, {
      method: "GET",
      headers: headers(),
    });

    if (!response.ok) {
      const error = new Error(`Failed to fetch file: ${response.statusText}`);
      error.status = response.status;
      throw error;
    }

    const data = await response.json();

    let contentStr;

    // For large files, GitHub doesn't include content inline; use download_url instead
    if (!data.content || data.encoding === "none") {
      if (data.download_url) {
        const downloadResponse = await fetch(data.download_url);
        if (!downloadResponse.ok) {
          throw new Error(`Failed to download file from download_url: ${downloadResponse.statusText}`);
        }
        contentStr = await downloadResponse.text();
      } else {
        throw new Error("File is too large or empty; no download_url provided");
      }
    } else {
      // For smaller files, decode the base64 content
      try {
        contentStr = decodeURIComponent(escape(atob(data.content)));
      } catch (err) {
        throw new Error(`Failed to decode base64 content: ${err.message}`);
      }
    }

    if (!contentStr || contentStr.trim() === "") {
      throw new Error("Content is empty");
    }

    let parsed;
    try {
      parsed = JSON.parse(contentStr);
    } catch (err) {
      throw new Error(`Failed to parse JSON: ${err.message}`);
    }

    if (!Array.isArray(parsed)) {
      throw new Error("Invalid format: expected a JSON array");
    }

    return parsed;
  }

  // Auto-init: load settings from localStorage on page load
  document.addEventListener("DOMContentLoaded", function () {
    loadSettings();
  });

  return {
    config,
    loadSettings,
    isConfigured,
    headers,
    pushToGitHub,
    pullFromGitHub,
  };
})();
