export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  FILES: R2Bucket;
}

interface TextClip {
  id: string;
  content: string;
  updatedAt: number;
}

interface FileEntry {
  id: string;
  name: string;
  size: number;
  uploadedAt: number;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
}

async function handleClipsGet(env: Env, roomId: string): Promise<Response> {
  const { results } = await env.DB.prepare(
    "SELECT id, content, updated_at as updatedAt FROM clips WHERE room_id = ? ORDER BY updated_at ASC"
  ).bind(roomId).all<TextClip>();
  return json(results);
}

async function handleClipsPost(env: Env, roomId: string, req: Request): Promise<Response> {
  const body = await req.json<{ content?: string }>();
  const content = body.content?.trim();
  if (!content) return json({ error: "Content is required" }, 400);

  const existing = await env.DB.prepare(
    "SELECT id, content, updated_at as updatedAt FROM clips WHERE room_id = ? AND content = ?"
  ).bind(roomId, content).first<TextClip>();

  if (existing) {
    const updatedAt = Date.now();
    await env.DB.prepare(
      "UPDATE clips SET updated_at = ? WHERE id = ?"
    ).bind(updatedAt, existing.id).run();
    return json({ ...existing, updatedAt, isDuplicate: true });
  }

  const id = `clip-${Date.now()}-${crypto.randomUUID().slice(0, 7)}`;
  const updatedAt = Date.now();
  await env.DB.prepare(
    "INSERT INTO clips (id, room_id, content, updated_at) VALUES (?, ?, ?, ?)"
  ).bind(id, roomId, content, updatedAt).run();
  return json({ id, content, updatedAt });
}

async function handleClipsDelete(env: Env, roomId: string, clipId: string): Promise<Response> {
  const result = await env.DB.prepare(
    "DELETE FROM clips WHERE id = ? AND room_id = ?"
  ).bind(clipId, roomId).run();
  if (result.meta.changes === 0) return json({ error: "Clip not found" }, 404);
  return json({ success: true });
}

async function handleFilesPost(env: Env, roomId: string, req: Request): Promise<Response> {
  const formData = await req.formData();
  const fileEntries = formData.getAll("file") as unknown as File[];
  if (fileEntries.length === 0) return json({ error: "No files uploaded" }, 400);

  const results: FileEntry[] = [];
  for (const file of fileEntries) {
    const id = `${Date.now()}-${safeFileName(file.name)}`;
    const key = `${roomId}/${id}`;
    await env.FILES.put(key, file.stream(), {
      httpMetadata: { contentType: file.type || "application/octet-stream" },
      customMetadata: { name: file.name },
    });
    results.push({ id, name: file.name, size: file.size, uploadedAt: Date.now() });
  }
  return json(results);
}

async function handleFilesGet(env: Env, roomId: string): Promise<Response> {
  const prefix = `${roomId}/`;
  const listed = await env.FILES.list({ prefix });
  const files: FileEntry[] = listed.objects.map((obj) => ({
    id: obj.key.slice(prefix.length),
    name: obj.customMetadata?.name ?? obj.key.slice(prefix.length).replace(/^\d+-/, ""),
    size: obj.size,
    uploadedAt: obj.uploaded.getTime(),
  }));
  files.sort((a, b) => a.uploadedAt - b.uploadedAt);
  return json(files);
}

async function handleFileDownload(env: Env, roomId: string, fileId: string): Promise<Response> {
  const key = `${roomId}/${fileId}`;
  const object = await env.FILES.get(key);
  if (!object) return new Response("File not found", { status: 404 });

  const originalName = object.customMetadata?.name ?? fileId.replace(/^\d+-/, "");
  const encoded = encodeURIComponent(originalName);
  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
      "Content-Disposition": `attachment; filename="${safeFileName(originalName)}"; filename*=UTF-8''${encoded}`,
      "Cache-Control": "no-store",
    },
  });
}

async function handleFileDelete(env: Env, roomId: string, fileId: string): Promise<Response> {
  await env.FILES.delete(`${roomId}/${fileId}`);
  return json({ success: true });
}

async function handleClear(env: Env, roomId: string): Promise<Response> {
  await env.DB.prepare("DELETE FROM clips WHERE room_id = ?").bind(roomId).run();

  const prefix = `${roomId}/`;
  let cursor: string | undefined;
  do {
    const listed = await env.FILES.list({ prefix, cursor });
    await Promise.all(listed.objects.map((obj) => env.FILES.delete(obj.key)));
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);

  return json({ success: true });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (!path.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    const segments = path.replace(/\/$/, "").split("/").filter(Boolean);
    const resource = segments[1];
    const param2 = segments[2];
    const param3 = segments[3];
    const method = request.method;

    try {
      if (resource === "health" && method === "GET") {
        return json({ status: "ok", time: Date.now() });
      }

      if (resource === "clips" && param2) {
        if (method === "GET" && !param3) return handleClipsGet(env, param2);
        if (method === "POST" && !param3) return handleClipsPost(env, param2, request);
        if (method === "DELETE" && param3) return handleClipsDelete(env, param2, param3);
      }

      if (resource === "files" && param2) {
        if (method === "POST" && !param3) return handleFilesPost(env, param2, request);
        if (method === "GET" && !param3) return handleFilesGet(env, param2);
        if (method === "GET" && param3) return handleFileDownload(env, param2, param3);
        if (method === "DELETE" && param3) return handleFileDelete(env, param2, param3);
      }

      if (resource === "clear" && param2 && method === "DELETE") {
        return handleClear(env, param2);
      }

      return json({ error: "API route not found" }, 404);
    } catch (err) {
      console.error("Worker error:", err);
      return json({ error: "Internal server error" }, 500);
    }
  },
};
