(() => {
  const list = document.getElementById("downloadList");
  const API_BASE_URL = String(window.HC_CONFIG?.apiBaseUrl || "").replace(/\/+$/, "");

  function formatBytes(bytes) {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value < 0) return "Unknown size";
    if (value < 1024) return value + " B";
    if (value < 1024 * 1024) return (value / 1024).toFixed(1) + " KB";
    if (value < 1024 * 1024 * 1024) return (value / (1024 * 1024)).toFixed(1) + " MB";
    return (value / (1024 * 1024 * 1024)).toFixed(2) + " GB";
  }

  function formatDate(timestamp) {
    const date = new Date(Number(timestamp));
    return Number.isNaN(date.getTime()) ? "Date unavailable" : date.toLocaleDateString();
  }

  function showMessage(message) {
    list.replaceChildren();
    const element = document.createElement("p");
    element.className = "portal-empty";
    element.textContent = message;
    list.appendChild(element);
  }

  function render(files) {
    list.replaceChildren();
    if (!files.length) {
      showMessage("There are no public downloads available right now.");
      return;
    }

    files.forEach((file) => {
      const card = document.createElement("article");
      card.className = "portal-download-card";
      const info = document.createElement("div");
      info.className = "portal-file-info";

      const name = document.createElement("h2");
      name.className = "portal-file-name";
      name.textContent = file.fileName;

      const description = document.createElement("p");
      description.className = "portal-file-description";
      description.textContent = file.description || "No description provided.";

      const meta = document.createElement("div");
      meta.className = "portal-file-meta";
      const size = document.createElement("span");
      size.textContent = formatBytes(file.size);
      const date = document.createElement("span");
      date.textContent = "Added " + formatDate(file.createdAt);
      meta.append(size, date);
      info.append(name, description, meta);

      const download = document.createElement("a");
      download.className = "portal-button";
      download.textContent = "Download";
      download.href = API_BASE_URL + "/api/files/" + encodeURIComponent(file.id) + "/download";
      download.setAttribute("aria-label", "Download " + file.fileName);

      card.append(info, download);
      list.appendChild(card);
    });
  }

  async function loadDownloads() {
    if (!API_BASE_URL) {
      showMessage("The downloads service has not been deployed and connected yet.");
      return;
    }

    try {
      const response = await fetch(API_BASE_URL + "/api/files", {
        cache: "no-store",
        credentials: "omit"
      });
      if (!response.ok) throw new Error("Download library unavailable.");
      const payload = await response.json();
      render(Array.isArray(payload.files) ? payload.files : []);
    } catch (error) {
      showMessage("The download library is not available yet. Please try again later.");
      console.error("HC downloads request failed:", error);
    }
  }

  loadDownloads();
})();
