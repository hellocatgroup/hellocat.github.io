(() => {
  const API_ROOT = "/api/admin/files";
  const form = document.getElementById("uploadForm");
  const fileInput = document.getElementById("fileInput");
  const descriptionInput = document.getElementById("descriptionInput");
  const publishInput = document.getElementById("publishImmediately");
  const uploadButton = document.getElementById("uploadButton");
  const uploadStatus = document.getElementById("uploadStatus");
  const fileList = document.getElementById("fileList");
  const accessNotice = document.getElementById("accessNotice");
  const refreshButton = document.getElementById("refreshButton");

  function setStatus(element, message, kind) {
    element.textContent = message;
    if (kind) element.dataset.kind = kind;
    else delete element.dataset.kind;
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(Number(bytes)) || Number(bytes) < 0) return "Unknown size";
    const value = Number(bytes);
    if (value < 1024) return value + " B";
    if (value < 1024 * 1024) return (value / 1024).toFixed(1) + " KB";
    if (value < 1024 * 1024 * 1024) return (value / (1024 * 1024)).toFixed(1) + " MB";
    return (value / (1024 * 1024 * 1024)).toFixed(2) + " GB";
  }

  function formatDate(timestamp) {
    const date = new Date(Number(timestamp));
    return Number.isNaN(date.getTime()) ? "Date unavailable" : date.toLocaleString();
  }

  async function request(url, options) {
    const response = await fetch(url, Object.assign({ credentials: "same-origin", cache: "no-store" }, options || {}));
    const payload = await response.json().catch(() => ({}));

    if (response.status === 401 || response.status === 403) {
      setStatus(accessNotice, "Admin access was denied. Sign in with an email allowed by the Cloudflare Access policy.", "error");
      throw new Error("Admin access denied.");
    }
    if (!response.ok) throw new Error(payload.error || "Request failed with status " + response.status + ".");
    return payload;
  }

  function makeAction(label, className, handler) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "portal-button " + className;
    button.textContent = label;
    button.addEventListener("click", handler);
    return button;
  }

  function renderFiles(files) {
    fileList.replaceChildren();
    if (!files.length) {
      const empty = document.createElement("p");
      empty.className = "portal-empty";
      empty.textContent = "No files have been uploaded yet.";
      fileList.appendChild(empty);
      return;
    }

    files.forEach((file) => {
      const row = document.createElement("article");
      row.className = "portal-file-row";
      const info = document.createElement("div");
      info.className = "portal-file-info";

      const name = document.createElement("h3");
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
      date.textContent = formatDate(file.createdAt);
      const status = document.createElement("span");
      status.textContent = file.published ? "Published" : "Unpublished";
      meta.append(size, date, status);
      info.append(name, description, meta);

      const actions = document.createElement("div");
      actions.className = "portal-file-actions";
      const publishButton = makeAction(file.published ? "Unpublish" : "Publish", "portal-button--secondary", async () => {
        publishButton.disabled = true;
        try {
          await request(API_ROOT + "/" + encodeURIComponent(file.id), {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ published: !file.published })
          });
          await loadFiles();
        } catch (error) {
          setStatus(uploadStatus, error.message, "error");
          publishButton.disabled = false;
        }
      });

      const deleteButton = makeAction("Delete", "portal-button--danger", async () => {
        if (!window.confirm("Permanently delete " + file.fileName + "?")) return;
        deleteButton.disabled = true;
        try {
          await request(API_ROOT + "/" + encodeURIComponent(file.id), { method: "DELETE" });
          await loadFiles();
          setStatus(uploadStatus, "File deleted.", "success");
        } catch (error) {
          setStatus(uploadStatus, error.message, "error");
          deleteButton.disabled = false;
        }
      });

      actions.append(publishButton, deleteButton);
      row.append(info, actions);
      fileList.appendChild(row);
    });
  }

  async function loadFiles() {
    fileList.replaceChildren();
    const loading = document.createElement("p");
    loading.className = "portal-empty";
    loading.textContent = "Loading files…";
    fileList.appendChild(loading);

    try {
      const payload = await request(API_ROOT, { method: "GET" });
      renderFiles(Array.isArray(payload.files) ? payload.files : []);
      setStatus(accessNotice, "Authenticated admin session. Uploads and file management are enabled.", "success");
    } catch (error) {
      const empty = document.createElement("p");
      empty.className = "portal-empty";
      empty.textContent = error.message.indexOf("Admin access denied") !== -1
        ? "This page is restricted. Sign in with an authorized admin account."
        : error.message;
      fileList.replaceChildren(empty);
      if (error.message.indexOf("Admin access denied") === -1) {
        setStatus(accessNotice, "The file service is not ready or could not be reached. Check the Cloudflare setup.", "error");
      }
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!fileInput.files || !fileInput.files.length) {
      setStatus(uploadStatus, "Choose a file first.", "error");
      return;
    }

    const formData = new FormData();
    formData.append("file", fileInput.files[0]);
    formData.append("description", descriptionInput.value.trim());
    formData.append("published", publishInput.checked ? "true" : "false");

    uploadButton.disabled = true;
    setStatus(uploadStatus, "Uploading…");
    try {
      const payload = await request(API_ROOT, { method: "POST", body: formData });
      form.reset();
      publishInput.checked = true;
      setStatus(uploadStatus, "Uploaded " + payload.file.fileName + ".", "success");
      await loadFiles();
    } catch (error) {
      setStatus(uploadStatus, error.message, "error");
    } finally {
      uploadButton.disabled = false;
    }
  });

  refreshButton.addEventListener("click", loadFiles);
  loadFiles();
})();
