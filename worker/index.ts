export interface Env {
  ASSETS: Fetcher;
  CLIPS: KVNamespace;
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
    headers: { "Content-Type": "application/json" },
  });
}

function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
}

async function getClips(env: Env, roomId: string): Promise<TextClip[]> {
  const raw = await env.CLIPS.get(roomId);
  return raw ? (JSON.parse(raw) as TextClip[]) : [];
}

async function putClips(env: Env, roomId: string, clips: TextClip[]): Promise<void> {
  await env.CLIPS.put(roomId, JSON.stringify(clips));
}

async function handleClipsGet(env: Env, roomId: string): Promise<Response> {
  return json(await getClips(env, roomId));
}

async function handleClipsPost(env: Env, roomId: string, req: Request): Promise<Response> {
  const body = await req.json<{ content?: string }>();
  const content = body.content?.trim();
  if (!content) return json({ error: "Content is required" }, 400);

  const clips = await getClips(env, roomId);
  const existing = clips.find((c) => c.content === content);
  if (existing) {
    existing.updatedAt = Date.now();
    await putClips(env, roomId, clips);
    return json({ ...existing, isDuplicate: true });
  }

  const newClip: TextClip = {
    id: `clip-${Date.now()}-${crypto.randomUUID().slice(0, 7)}`,
    content,
    updatedAt: Date.now(),
  };
  clips.push(newClip);
  await putClips(env, roomId, clips);
  return json(newClip);
}

async function handleClipsDelete(env: Env, roomId: string, clipId: string): Promise<Response> {
  const clips = await getClips(env, roomId);
  const filtered = clips.filter((c) => c.id !== clipId);
  if (filtered.length === clips.length) return json({ error: "Clip not found" }, 404);
  await putClips(env, roomId, filtered);
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
    },
  });
}

async function handleFileDelete(env: Env, roomId: string, fileId: string): Promise<Response> {
  await env.FILES.delete(`${roomId}/${fileId}`);
  return json({ success: true });
}

async function handleClear(env: Env, roomId: string): Promise<Response> {
  await env.CLIPS.delete(roomId);

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
    // segments[0] = "api", segments[1] = resource, segments[2] = roomId, etc.
    const resource = segments[1];
    const param2 = segments[2]; // roomId or undefined
    const param3 = segments[3]; // clipId / fileId or undefined
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
