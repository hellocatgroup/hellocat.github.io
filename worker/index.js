let jwksCache = null;
let jwksCacheExpiresAt = 0;

function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

function base64UrlToBytes(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "===".slice((normalized.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function decodeJwtPart(value) {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(value)));
}

async function fetchAccessKeys(issuer, forceRefresh) {
  if (!forceRefresh && jwksCache && Date.now() < jwksCacheExpiresAt) return jwksCache;
  const endpoint = issuer.replace(/\/+$/, "") + "/cdn-cgi/access/certs";
  const response = await fetch(endpoint, { cache: "no-store" });
  if (!response.ok) throw new Error("Unable to retrieve Access signing keys.");
  const data = await response.json();
  if (!data || !Array.isArray(data.keys)) throw new Error("Invalid Access signing-key response.");
  jwksCache = data;
  jwksCacheExpiresAt = Date.now() + 10 * 60 * 1000;
  return data;
}

async function verifyAccessRequest(request, env) {
  if (!env.ACCESS_ISSUER || !env.ACCESS_AUD) return false;
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return false;

  try {
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const header = decodeJwtPart(parts[0]);
    const claims = decodeJwtPart(parts[1]);
    if (header.alg !== "RS256" || !header.kid) return false;

    let keys = await fetchAccessKeys(env.ACCESS_ISSUER, false);
    let jwk = keys.keys.find((key) => key.kid === header.kid);
    if (!jwk) {
      keys = await fetchAccessKeys(env.ACCESS_ISSUER, true);
      jwk = keys.keys.find((key) => key.kid === header.kid);
    }
    if (!jwk) return false;

    const publicKey = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const signatureValid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      publicKey,
      base64UrlToBytes(parts[2]),
      new TextEncoder().encode(parts[0] + "." + parts[1])
    );
    if (!signatureValid) return false;

    const now = Math.floor(Date.now() / 1000);
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    const allowedAudiences = String(env.ACCESS_AUD).split(",").map((value) => value.trim()).filter(Boolean);
    if (claims.iss !== env.ACCESS_ISSUER) return false;
    if (!allowedAudiences.some((audience) => audiences.includes(audience))) return false;
    if (!Number.isFinite(Number(claims.exp)) || Number(claims.exp) <= now) return false;
    if (claims.nbf && Number(claims.nbf) > now + 60) return false;
    return true;
  } catch (error) {
    console.error("Access token validation failed:", error);
    return false;
  }
}

function cleanFileName(value) {
  const parts = String(value || "download").replace(/\\/g, "/").split("/");
  const name = (parts[parts.length - 1] || "download")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 180);
  return name || "download";
}

function contentDisposition(fileName) {
  const fallback = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\;]/g, "_");
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (character) => {
    return "%" + character.charCodeAt(0).toString(16).toUpperCase();
  });
  return "attachment; filename=\"" + fallback + "\"; filename*=UTF-8''" + encoded;
}

function formatFile(row) {
  return {
    id: row.id,
    fileName: row.file_name,
    description: row.description || "",
    size: Number(row.size),
    createdAt: Number(row.created_at),
    published: Boolean(row.published)
  };
}

async function listPublicFiles(env) {
  const result = await env.FILES_DB.prepare(
    "SELECT id, file_name, description, size, created_at FROM files WHERE published = 1 ORDER BY created_at DESC"
  ).all();
  return jsonResponse({ files: (result.results || []).map(formatFile) });
}

async function listAdminFiles(env) {
  const result = await env.FILES_DB.prepare(
    "SELECT id, file_name, description, size, created_at, published FROM files ORDER BY created_at DESC"
  ).all();
  return jsonResponse({ files: (result.results || []).map(formatFile) });
}

async function downloadFile(id, env) {
  const row = await env.FILES_DB.prepare(
    "SELECT object_key, file_name FROM files WHERE id = ? AND published = 1"
  ).bind(id).first();
  if (!row) return jsonResponse({ error: "File not found." }, 404);

  const object = await env.FILES_BUCKET.get(row.object_key);
  if (!object) return jsonResponse({ error: "File not found." }, 404);

  const headers = new Headers({
    "Content-Type": "application/octet-stream",
    "Content-Disposition": contentDisposition(row.file_name),
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "public, max-age=300"
  });
  if (object.size) headers.set("Content-Length", String(object.size));
  return new Response(object.body, { headers: headers });
}

async function uploadFile(request, env) {
  const maxBytes = Number.parseInt(env.MAX_UPLOAD_BYTES || "104857600", 10);
  const declaredLength = Number.parseInt(request.headers.get("Content-Length") || "0", 10);
  if (declaredLength && declaredLength > maxBytes + 1024 * 1024) {
    return jsonResponse({ error: "Upload exceeds the configured size limit." }, 413);
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!file || typeof file.stream !== "function" || typeof file.size !== "number") {
    return jsonResponse({ error: "Choose a file to upload." }, 400);
  }
  if (file.size <= 0) return jsonResponse({ error: "Empty files cannot be uploaded." }, 400);
  if (file.size > maxBytes) return jsonResponse({ error: "File exceeds the configured size limit." }, 413);

  const id = crypto.randomUUID().replace(/-/g, "");
  const objectKey = "uploads/" + id;
  const fileName = cleanFileName(file.name);
  const description = String(form.get("description") || "").trim().slice(0, 500);
  const published = String(form.get("published") || "true") === "true";
  const createdAt = Date.now();

  await env.FILES_BUCKET.put(objectKey, file.stream(), {
    httpMetadata: { contentType: "application/octet-stream" },
    customMetadata: { originalName: fileName }
  });

  try {
    await env.FILES_DB.prepare(
      "INSERT INTO files (id, object_key, file_name, description, size, content_type, created_at, published) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(
      id,
      objectKey,
      fileName,
      description,
      file.size,
      file.type || "application/octet-stream",
      createdAt,
      published ? 1 : 0
    ).run();
  } catch (error) {
    await env.FILES_BUCKET.delete(objectKey);
    throw error;
  }

  return jsonResponse({
    file: {
      id: id,
      fileName: fileName,
      description: description,
      size: file.size,
      createdAt: createdAt,
      published: published
    }
  }, 201);
}

async function updateFile(id, request, env) {
  const current = await env.FILES_DB.prepare(
    "SELECT id FROM files WHERE id = ?"
  ).bind(id).first();
  if (!current) return jsonResponse({ error: "File not found." }, 404);

  let body;
  try {
    body = await request.json();
  } catch (error) {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }
  if (typeof body.published !== "boolean") {
    return jsonResponse({ error: "A boolean published value is required." }, 400);
  }

  await env.FILES_DB.prepare(
    "UPDATE files SET published = ? WHERE id = ?"
  ).bind(body.published ? 1 : 0, id).run();
  return jsonResponse({ success: true, published: body.published });
}

async function deleteFile(id, env) {
  const row = await env.FILES_DB.prepare(
    "SELECT object_key FROM files WHERE id = ?"
  ).bind(id).first();
  if (!row) return jsonResponse({ error: "File not found." }, 404);

  await env.FILES_BUCKET.delete(row.object_key);
  await env.FILES_DB.prepare("DELETE FROM files WHERE id = ?").bind(id).run();
  return jsonResponse({ success: true });
}

async function handleRequest(request, env) {
  const path = new URL(request.url).pathname;

  if (path === "/api/files" && request.method === "GET") return listPublicFiles(env);

  const downloadMatch = path.match(/^\/api\/files\/([a-f0-9]{32})\/download$/);
  if (downloadMatch && request.method === "GET") return downloadFile(downloadMatch[1], env);

  if (path === "/api/admin/files") {
    if (!env.ACCESS_ISSUER || !env.ACCESS_AUD) {
      return jsonResponse({ error: "Admin authentication has not been configured." }, 503);
    }
    if (!(await verifyAccessRequest(request, env))) return jsonResponse({ error: "Admin access denied." }, 401);
    if (request.method === "GET") return listAdminFiles(env);
    if (request.method === "POST") return uploadFile(request, env);
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  const adminFileMatch = path.match(/^\/api\/admin\/files\/([a-f0-9]{32})$/);
  if (adminFileMatch) {
    if (!env.ACCESS_ISSUER || !env.ACCESS_AUD) {
      return jsonResponse({ error: "Admin authentication has not been configured." }, 503);
    }
    if (!(await verifyAccessRequest(request, env))) return jsonResponse({ error: "Admin access denied." }, 401);
    if (request.method === "PATCH") return updateFile(adminFileMatch[1], request, env);
    if (request.method === "DELETE") return deleteFile(adminFileMatch[1], env);
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  return jsonResponse({ error: "Not found." }, 404);
}

export default {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      console.error("Hello Cat file service error:", error);
      return jsonResponse({ error: "The file service encountered an internal error." }, 500);
    }
  }
};
