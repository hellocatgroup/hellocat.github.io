(() => {
  const list = document.getElementById("downloadList");

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

  function render(files) {
    list.replaceChildren();
    if (!files.length) {
      const empty = document.createElement("p");
      empty.className = "portal-empty";
      empty.textContent = "There are no public downloads available right now.";
      list.appendChild(empty);
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
      download.href = "/api/files/" + encodeURIComponent(file.id) + "/download";
      download.setAttribute("aria-label", "Download " + file.fileName);

      card.append(info, download);
      list.appendChild(card);
    });
  }

  async function loadDownloads() {
    try {
      const response = await fetch("/api/files", { cache: "no-store" });
      if (!response.ok) throw new Error("Download library unavailable.");
      const payload = await response.json();
      render(Array.isArray(payload.files) ? payload.files : []);
    } catch (error) {
      list.replaceChildren();
      const message = document.createElement("p");
      message.className = "portal-empty";
      message.textContent = "The download library is not available yet. Please try again later.";
      list.appendChild(message);
      console.error("HC downloads request failed:", error);
    }
  }

  loadDownloads();
})();
