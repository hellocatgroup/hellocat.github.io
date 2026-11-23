(() => {
  const API_BASE_URL = String(window.HC_CONFIG?.apiBaseUrl || "").replace(/\/+$/, "");
  const API_ROOT = API_BASE_URL ? API_BASE_URL + "/api/admin/files" : "";
  // Login is a top-level navigation to the Access-protected admin app. This
  // avoids following Cloudflare's cross-origin login redirect inside fetch().
  const LOGIN_URL = API_BASE_URL ? API_BASE_URL + "/admin/" : "";
  const adminControls = document.getElementById("adminControls");
  const form = document.getElementById("uploadForm");
  const fileInput = document.getElementById("fileInput");
  const descriptionInput = document.getElementById("descriptionInput");
  const publishInput = document.getElementById("publishImmediately");
  const uploadButton = document.getElementById("uploadButton");
  const uploadStatus = document.getElementById("uploadStatus");
  const fileList = document.getElementById("fileList");
  const accessNotice = document.getElementById("accessNotice");
  const refreshButton = document.getElementById("refreshButton");
  const accessActions = document.getElementById("accessActions");
  const accessLoginLink = document.getElementById("accessLoginLink");

  if (accessLoginLink && LOGIN_URL) accessLoginLink.href = LOGIN_URL;

  function setStatus(element, message, kind) {
    element.textContent = message;
    if (kind) element.dataset.kind = kind;
    else delete element.dataset.kind;
  }

  function lockAdminUI(message, kind) {
    adminControls.hidden = true;
    setStatus(accessNotice, message, kind || "error");
  }

  function showLoginAction(show) {
    if (accessActions) accessActions.hidden = !show;
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
    const response = await fetch(url, Object.assign({
      credentials: "include",
      cache: "no-store"
    }, options || {}));
    const contentType = response.headers.get("content-type") || "";
    const isJson = contentType.toLowerCase().includes("application/json");
    const payload = isJson ? await response.json().catch(() => ({})) : {};

    if (response.status === 401 || response.status === 403) {
      lockAdminUI("Access denied. Sign in through Cloudflare Access with the approved administrator account.", "error");
      showLoginAction(true);
      throw new Error("Admin access denied.");
    }

    if (response.status === 503 && String(payload.error || "").toLowerCase().includes("authentication")) {
      lockAdminUI("Admin panel locked. Cloudflare Access and the administrator email allowlist have not been configured.", "error");
      showLoginAction(false);
      throw new Error("Admin authentication is not configured.");
    }

    if (!isJson) {
      lockAdminUI("The API did not return an authenticated JSON response. Sign in through Cloudflare Access, then try again.", "error");
      showLoginAction(true);
      throw new Error("Admin API did not return JSON.");
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
          const body = new URLSearchParams({ published: String(!file.published) });
          await request(API_ROOT + "/" + encodeURIComponent(file.id) + "/publish", {
            method: "POST",
            body
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
          await request(API_ROOT + "/" + encodeURIComponent(file.id) + "/delete", { method: "POST" });
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
    if (!API_BASE_URL) {
      lockAdminUI("The file service has not been connected yet. Deploy the Worker, then set apiBaseUrl in js/config.js.", "error");
      showLoginAction(false);
      fileList.replaceChildren();
      const empty = document.createElement("p");
      empty.className = "portal-empty";
      empty.textContent = "File management is unavailable until the Cloudflare Worker URL is configured.";
      fileList.appendChild(empty);
      return;
    }

    lockAdminUI("Verifying administrator access…", "info");
    showLoginAction(false);
    fileList.replaceChildren();
    const loading = document.createElement("p");
    loading.className = "portal-empty";
    loading.textContent = "Checking authorization…";
    fileList.appendChild(loading);

    try {
      const payload = await request(API_ROOT, { method: "GET" });
      if (!Array.isArray(payload.files)) {
        throw new Error("The admin API response was invalid. The admin interface remains locked.");
      }
      renderFiles(payload.files);
      adminControls.hidden = false;
      showLoginAction(false);
      setStatus(accessNotice, "Authorized administrator session verified. File management is enabled.", "success");
    } catch (error) {
      adminControls.hidden = true;
      showLoginAction(error.message !== "Admin authentication is not configured.");
      const empty = document.createElement("p");
      empty.className = "portal-empty";
      empty.textContent = error.message === "Admin access denied."
        ? "This area is restricted. Sign in using the approved administrator account."
        : error.message === "Admin authentication is not configured."
          ? "Uploads are disabled until Cloudflare Access and the administrator email allowlist are configured."
          : "The admin service could not verify your session. Use the sign-in link above, then return here.";
      fileList.replaceChildren(empty);
      if (error.message !== "Admin access denied." && error.message !== "Admin authentication is not configured.") {
        setStatus(accessNotice, "Administrator authentication could not be verified. No upload or management controls are available.", "error");
      }
    }
  }


  // Keep the existing one-request upload for smaller files. Send larger files
  // to R2 through authenticated multipart upload endpoints in 8 MiB pieces.
  const LEGACY_UPLOAD_LIMIT = 90 * 1024 * 1024;
  const LARGE_UPLOAD_LIMIT = 512 * 1024 * 1024;

  async function uploadLargeFile(file, description, published) {
    const start = await request(API_ROOT + "/multipart/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName: file.name, size: file.size })
    });
    const prefix = API_ROOT + "/multipart/" + encodeURIComponent(start.id);
    const chunkSize = Number(start.chunkSize);
    if (!Number.isSafeInteger(chunkSize) || chunkSize < 5 * 1024 * 1024 ||
        chunkSize > 8 * 1024 * 1024 || !start.uploadId) {
      throw new Error("The upload service returned an invalid multipart session.");
    }

    const parts = [];
    let completed = false;
    try {
      for (let offset = 0, partNumber = 1; offset < file.size; offset += chunkSize, partNumber++) {
        const end = Math.min(file.size, offset + chunkSize);
        const part = await request(prefix + "/part?uploadId=" +
          encodeURIComponent(start.uploadId) + "&partNumber=" + partNumber, {
          method: "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body: file.slice(offset, end)
        });
        parts.push(part);
        setStatus(uploadStatus, "Uploading… " + Math.round((end / file.size) * 100) + "%");
      }

      const result = await request(prefix + "/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uploadId: start.uploadId,
          parts: parts,
          fileName: file.name,
          size: file.size,
          description: description,
          published: published
        })
      });
      completed = true;
      return result;
    } catch (error) {
      if (!completed) {
        try {
          await request(prefix + "/abort", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ uploadId: start.uploadId })
          });
        } catch (_cleanupError) {
          // R2 automatically expires abandoned multipart uploads.
        }
      }
      throw error;
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!API_ROOT) {
      setStatus(uploadStatus, "The file service is not configured yet.", "error");
      return;
    }
    if (!fileInput.files || !fileInput.files.length) {
      setStatus(uploadStatus, "Choose a file first.", "error");
      return;
    }

    const file = fileInput.files[0];
    if (file.size > LARGE_UPLOAD_LIMIT) {
      setStatus(uploadStatus, "File exceeds the 512 MiB upload limit.", "error");
      return;
    }
    const description = descriptionInput.value.trim();
    const published = publishInput.checked;

    uploadButton.disabled = true;
    setStatus(uploadStatus, "Uploading…");
    try {
      let payload;
      if (file.size > LEGACY_UPLOAD_LIMIT) {
        payload = await uploadLargeFile(file, description, published);
      } else {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("description", description);
        formData.append("published", published ? "true" : "false");
        payload = await request(API_ROOT, { method: "POST", body: formData });
      }
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
