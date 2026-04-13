// Codeberg Sync Module - Handles synchronization with Codeberg repository
var CodebergSync = {
  config: {
    token: "",
    owner: "lvansnippenburg",
    repo: "json_storage",
    filepath: "music.json",
    branch: "discography",
    baseUrl: "https://codeberg.org/api/v1",
  },

  // Initialize Codeberg settings from localStorage
  init: function () {
    this.loadSettings();
    this.updateStatus();
    this.bindEvents();
  },

  // Load settings from localStorage
  loadSettings: function () {
    var token = localStorage.getItem("codeberg_token");
    var filepath = localStorage.getItem("codeberg_music_filepath");
    var branch = localStorage.getItem("codeberg_branch");

    if (token) this.config.token = token;
    if (filepath) this.config.filepath = filepath;
    if (branch) this.config.branch = branch;

    // Load settings into form
    if (document.getElementById("codeberg-token")) {
      document.getElementById("codeberg-token").value = token || "";
    }
    if (document.getElementById("codeberg-music-filepath")) {
      document.getElementById("codeberg-music-filepath").value = filepath || "music.json";
    }
    if (document.getElementById("codeberg-branch")) {
      document.getElementById("codeberg-branch").value = branch || "main";
    }
  },

  // Save settings to localStorage
  saveSettings: function () {
    var token = document.getElementById("codeberg-token").value.trim();
    var filepath = document.getElementById("codeberg-music-filepath").value.trim();
    var branch = document.getElementById("codeberg-branch").value.trim();

    if (token) {
      localStorage.setItem("codeberg_token", token);
      this.config.token = token;
    }

    if (filepath) {
      localStorage.setItem("codeberg_music_filepath", filepath);
      this.config.filepath = filepath;
    }

    if (branch) {
      localStorage.setItem("codeberg_branch", branch);
      this.config.branch = branch;
    }

    this.updateStatus();
    alert("Codeberg settings saved successfully");
  },

  // Clear settings
  clearSettings: function () {
    if (confirm("Are you sure you want to clear Codeberg settings?")) {
      localStorage.removeItem("codeberg_token");
      localStorage.removeItem("codeberg_music_filepath");
      localStorage.removeItem("codeberg_branch");

      this.config.token = "";
      this.config.filepath = "music.json";
      this.config.branch = "main";

      document.getElementById("codeberg-token").value = "";
      document.getElementById("codeberg-music-filepath").value = "music.json";
      document.getElementById("codeberg-branch").value = "main";

      this.updateStatus();
      alert("Codeberg settings cleared");
    }
  },

  // Update connection status display
  updateStatus: function () {
    var statusEl = document.getElementById("codeberg-status");
    var pushBtn = document.getElementById("btn-push-codeberg");
    var pullBtn = document.getElementById("btn-pull-codeberg");

    if (!statusEl) return;

    if (this.config.token) {
      statusEl.innerHTML =
        "✓ Connected to Codeberg repository: <strong>" +
        this.config.owner +
        "/" +
        this.config.repo +
        "</strong><br>" +
        "File: " +
        this.config.filepath +
        " (branch: " +
        this.config.branch +
        ")";
      statusEl.className = "codeberg-status connected";

      if (pushBtn) pushBtn.disabled = false;
      if (pullBtn) pullBtn.disabled = false;
    } else {
      statusEl.innerHTML = "✗ Not connected to Codeberg. Please configure settings below.";
      statusEl.className = "codeberg-status disconnected";

      if (pushBtn) pushBtn.disabled = true;
      if (pullBtn) pullBtn.disabled = true;
    }
  },

  // Bind event handlers
  bindEvents: function () {
    var self = this;

    var saveBtn = document.getElementById("btn-save-settings");
    if (saveBtn) {
      saveBtn.addEventListener("click", function () {
        self.saveSettings();
      });
    }

    var clearBtn = document.getElementById("btn-clear-settings");
    if (clearBtn) {
      clearBtn.addEventListener("click", function () {
        self.clearSettings();
      });
    }

    var testBtn = document.getElementById("btn-test-connection");
    if (testBtn) {
      testBtn.addEventListener("click", function () {
        self.testConnection();
      });
    }

    var pushBtn = document.getElementById("btn-push-codeberg");
    if (pushBtn) {
      pushBtn.addEventListener("click", function () {
        self.pushToCodeberg();
      });
    }

    var pullBtn = document.getElementById("btn-pull-codeberg");
    if (pullBtn) {
      pullBtn.addEventListener("click", function () {
        self.pullFromCodeberg();
      });
    }

    var historyBtn = document.getElementById("btn-view-history");
    if (historyBtn) {
      historyBtn.addEventListener("click", function () {
        self.viewHistory();
      });
    }
  },

  // Test Codeberg connection
  testConnection: function () {
    if (!this.config.token) {
      alert("Please enter a Codeberg token first");
      return;
    }

    var statusEl = document.getElementById("connection-status");
    statusEl.innerHTML = '<div class="status-progress">Testing connection...</div>';
    statusEl.style.display = "block";

    var url = this.config.baseUrl + "/repos/" + this.config.owner + "/" + this.config.repo;

    fetch(url, {
      headers: {
        Authorization: "token " + this.config.token,
        Accept: "application/json",
      },
    })
      .then(function (response) {
        if (response.ok) {
          statusEl.innerHTML =
            '<div class="status-success">✓ Connection successful! Repository found.</div>';
        } else {
          statusEl.innerHTML =
            '<div class="status-error">✗ Connection failed: ' +
            response.status +
            " " +
            response.statusText +
            "</div>";
        }
      })
      .catch(function (error) {
        statusEl.innerHTML =
          '<div class="status-error">✗ Connection error: ' + error.message + "</div>";
      });
  },

  // Push data to Codeberg
  pushToCodeberg: function (content, message) {
    if (!this.config.token) {
      alert("Please configure Codeberg settings first");
      return;
    }

    if (!confirm("Push local database to Codeberg? This will overwrite the remote file.")) {
      return;
    }

    var self = this;

    // Get current file SHA (required for update)
    var getUrl =
      this.config.baseUrl +
      "/repos/" +
      this.config.owner +
      "/" +
      this.config.repo +
      "/contents/" +
      this.config.filepath +
      "?ref=" +
      this.config.branch;

    fetch(getUrl, {
      headers: {
        Authorization: "token " + this.config.token,
        Accept: "application/json",
      },
    })
      .then(function (response) {
        if (response.ok) {
          return response.json();
        } else if (response.status === 404) {
          return null; // File doesn't exist yet
        } else {
          throw new Error("Failed to get file info: " + response.statusText);
        }
      })
      .then(function (fileData) {
        var sha = fileData ? fileData.sha : null;

        // Update or create file
        var putUrl =
          self.config.baseUrl +
          "/repos/" +
          self.config.owner +
          "/" +
          self.config.repo +
          "/contents/" +
          self.config.filepath;

        var body = {
          message: message,
          content: btoa(unescape(encodeURIComponent(content))),
          branch: self.config.branch,
        };

        if (sha) {
          body.sha = sha;
        }

        return fetch(putUrl, {
          method: "PUT",
          headers: {
            Authorization: "token " + self.config.token,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });
      })
      .then(function (response) {
        if (response.ok) {
          alert("Successfully pushed to Codeberg");
        } else {
          return response.json().then(function (data) {
            throw new Error(data.message || "Push failed");
          });
        }
      })
      .catch(function (error) {
        alert("Push failed: " + error.message);
      });
  },

  // Pull data from Codeberg
  pullFromCodeberg: function () {
    if (!this.config.token) {
      alert("Please configure Codeberg settings first");
      return;
    }

    if (!confirm("Pull database from Codeberg? This will overwrite your local data.")) {
      return;
    }

    var statusEl = document.getElementById("sync-status");
    statusEl.innerHTML = '<div class="sync-progress">Pulling from Codeberg...</div>';
    statusEl.style.display = "block";

    var url =
      this.config.baseUrl +
      "/repos/" +
      this.config.owner +
      "/" +
      this.config.repo +
      "/contents/" +
      this.config.filepath +
      "?ref=" +
      this.config.branch;

    fetch(url, {
      headers: {
        Authorization: "token " + this.config.token,
        Accept: "application/json",
      },
    })
      .then(function (response) {
        if (response.ok) {
          return response.json();
        } else {
          throw new Error("Failed to fetch file: " + response.statusText);
        }
      })
      .then(function (data) {
        var content = decodeURIComponent(escape(atob(data.content)));
        var success = Database.importJSON(content);

        if (success) {
          statusEl.innerHTML =
            '<div class="sync-success">✓ Successfully pulled from Codeberg!</div>';
          UI.displayStatistics();
          UI.displayBrowseResults();
        } else {
          throw new Error("Invalid database format");
        }
      })
      .catch(function (error) {
        statusEl.innerHTML = '<div class="sync-error">✗ Pull failed: ' + error.message + "</div>";
      });
  },

  // View commit history
  viewHistory: function () {
    alert(
      "Commit history viewer - Coming soon!\n\nFor now, visit:\nhttps://codeberg.org/" +
        this.config.owner +
        "/" +
        this.config.repo +
        "/commits/branch/" +
        this.config.branch +
        "/" +
        this.config.filepath,
    );
  },
};

// Initialize when settings view is loaded
document.addEventListener("DOMContentLoaded", function () {
  CodebergSync.init();
});

console.log("Codeberg Sync module loaded successfully");
