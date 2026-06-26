CREATE TABLE IF NOT EXISTS clips (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  content TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_clips_room ON clips (room_id, updated_at);
