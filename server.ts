/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from "express";
import { createServer } from "http";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import multer from "multer";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const UPLOADS_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Configure multer for file storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const roomId = (req.params as any).roomId || "global";
    const roomPath = path.join(UPLOADS_DIR, roomId);
    if (!fs.existsSync(roomPath)) {
      fs.mkdirSync(roomPath, { recursive: true });
    }
    cb(null, roomPath);
  },
  filename: (req, file, cb) => {
    // Keep original name but add timestamp to prevent collisions
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    cb(null, `${Date.now()}-${safeName}`);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB limit
});

// In-memory storage for multiple text clips per room
interface TextClip {
  id: string;
  content: string;
  updatedAt: number;
}
const clips: Record<string, TextClip[]> = {};

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true }));

  // Request logger for debugging
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) {
      console.log(`${new Date().toISOString()} [${req.method}] ${req.path}`);
    }
    next();
  });

  const PORT = parseInt(process.env.PORT || '3000', 10);

  // Middleware to ensure all /api requests have correct content-type and don't fall through
  app.use("/api", (req, res, next) => {
    // If we've reached this point and it's an /api request that hasn't been handled yet,
    // we should continue to the routes. If it's still not handled, the catch-all below will get it.
    next();
  });

  // REST API Endpoints
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", time: Date.now() });
  });

  // Text Clips API
  app.get(["/api/clips/:roomId", "/api/clips/:roomId/"], (req, res) => {
    const { roomId } = req.params;
    console.log(`[GET] Fetching room clips: ${roomId}`);
    res.json(clips[roomId] || []);
  });

  app.post(["/api/clips/:roomId", "/api/clips/:roomId/"], (req, res) => {
    const { roomId } = req.params;
    const { content } = req.body;
    
    if (!content || !content.trim()) {
      return res.status(400).json({ error: "Content is required" });
    }

    if (!clips[roomId]) {
      clips[roomId] = [];
    }

    const existingClip = clips[roomId].find(c => c.content === content);
    if (existingClip) {
      existingClip.updatedAt = Date.now();
      console.log(`[POST] Duplicate content found in room ${roomId}. Updated updatedAt for clip: ${existingClip.id}`);
      return res.json({ ...existingClip, isDuplicate: true });
    }

    const updatedAt = Date.now();
    const id = `clip-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    
    console.log(`[POST] Adding clip to room: ${roomId} (${content.length} chars)`);
    const newClip = { id, content, updatedAt };
    clips[roomId].push(newClip);
    res.json(newClip);
  });

  app.delete(["/api/clips/:roomId/:clipId", "/api/clips/:roomId/:clipId/"], (req, res) => {
    const { roomId, clipId } = req.params;
    console.log(`[DELETE] Deleting clip ${clipId} from room ${roomId}`);
    if (clips[roomId]) {
      clips[roomId] = clips[roomId].filter(c => c.id !== clipId);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "Room not found" });
    }
  });

  // Files API
  app.post(["/api/files/:roomId", "/api/files/:roomId/"], upload.array("file"), (req, res) => {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }
    
    const responseFiles = files.map(file => ({
      id: file.filename,
      name: file.originalname,
      size: file.size,
      uploadedAt: Date.now()
    }));

    res.json(responseFiles);
  });

  app.get(["/api/files/:roomId", "/api/files/:roomId/"], (req, res) => {
    const { roomId } = req.params;
    const roomPath = path.join(UPLOADS_DIR, roomId);
    
    console.log(`[GET] Listing files for room: ${roomId}`);
    
    if (!fs.existsSync(roomPath)) {
      return res.json([]);
    }

    try {
      const files = fs.readdirSync(roomPath).filter(f => f.includes("-")).map(filename => {
        const stats = fs.statSync(path.join(roomPath, filename));
        // filename is timestamp-originalname
        const name = filename.substring(filename.indexOf("-") + 1);
        return {
          id: filename,
          name: name,
          size: stats.size,
          uploadedAt: stats.mtimeMs
        };
      });
      res.json(files.sort((a, b) => a.uploadedAt - b.uploadedAt));
    } catch (err) {
      console.error(`[ERROR] Failed to list files for ${roomId}:`, err);
      res.status(500).json({ error: "Failed to list files" });
    }
  });

  app.get("/api/files/:roomId/:fileId", (req, res) => {
    const { roomId, fileId } = req.params;
    const filePath = path.join(UPLOADS_DIR, roomId, fileId);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).send("File not found");
    }
    
    const originalName = fileId.substring(fileId.indexOf("-") + 1);
    res.download(filePath, originalName);
  });

  app.delete("/api/files/:roomId/:fileId", (req, res) => {
    const { roomId, fileId } = req.params;
    const filePath = path.join(UPLOADS_DIR, roomId, fileId);
    
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "File not found" });
    }
  });

  app.delete(["/api/clear/:roomId", "/api/clear/:roomId/"], (req, res) => {
    const { roomId } = req.params;
    console.log(`[DELETE] Clearing all items (clips & files) from room ${roomId}`);
    
    // Clear in-memory text clips
    clips[roomId] = [];
    
    // Clear files in directory
    const roomPath = path.join(UPLOADS_DIR, roomId);
    if (fs.existsSync(roomPath)) {
      try {
        const files = fs.readdirSync(roomPath);
        for (const file of files) {
          const filePath = path.join(roomPath, file);
          if (fs.statSync(filePath).isFile()) {
            fs.unlinkSync(filePath);
          }
        }
      } catch (err) {
        console.error(`[ERROR] Failed to clear files in room directory for ${roomId}:`, err);
      }
    }
    
    res.json({ success: true });
  });

  // Explicitly catch all other /api routes to prevent falling through to SPA fallback
  app.all("/api/*", (req, res) => {
    console.warn(`[404] Unhandled API request: ${req.method} ${req.path}`);
    res.status(404).json({ error: "API route not found" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
