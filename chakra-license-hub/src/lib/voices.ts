// A licence's own TTS voice (the "clone" kind in voice-rules.ts): the reference
// clip a company uploads. The speech gateway (chakra-gpu-fleet, fleet/voices.py)
// reads this table, names `voice_id` in the licence's TTS requests and hands the
// clip to GPU nodes; it also writes `status` (pending -> ready | rejected).
import crypto from "crypto";

import { pool } from "./db";

// The same definition as chakra-gpu-fleet/fleet/schema.sql.
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS license_voices (
    license_id    INTEGER PRIMARY KEY,
    voice_id      TEXT NOT NULL,
    audio         BYTEA NOT NULL,
    transcript    TEXT NOT NULL,
    seconds       REAL NOT NULL DEFAULT 0,
    file_name     TEXT,
    status        TEXT NOT NULL DEFAULT 'pending',
    status_detail TEXT NOT NULL DEFAULT '',
    updated_by    TEXT,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
)`;

let ready: Promise<void> | null = null;

/** Create the table on first use (the gateway and init_db.py also do). */
export function ensureVoiceTable(): Promise<void> {
  if (!pool) return Promise.reject(new Error("DATABASE_URL is not configured"));
  ready ??= pool.query(SCHEMA).then(
    () => undefined,
    (e) => {
      ready = null;
      throw e;
    },
  );
  return ready;
}

/** What the hub shows about a custom voice (never the audio itself). */
export type CustomVoice = {
  voice_id: string;
  file_name: string | null;
  seconds: number;
  transcript: string;
  status: "pending" | "ready" | "rejected";
  status_detail: string;
  updated_by: string | null;
  updated_at: string;
};

const VIEW = "voice_id, file_name, seconds::float8 AS seconds, transcript, status, status_detail, updated_by, updated_at";

export async function customVoice(licenseId: number): Promise<CustomVoice | null> {
  await ensureVoiceTable();
  const r = await pool!.query(`SELECT ${VIEW} FROM license_voices WHERE license_id = $1`, [licenseId]);
  return r.rows[0] ?? null;
}

export async function voiceAudio(licenseId: number): Promise<Buffer | null> {
  await ensureVoiceTable();
  const r = await pool!.query("SELECT audio FROM license_voices WHERE license_id = $1", [licenseId]);
  return r.rows[0]?.audio ?? null;
}

/** Store (or replace) a licence's reference clip. The id changes with the clip
 * or its transcript, so a GPU node never speaks in a stale one. */
export async function saveVoice(
  licenseId: number,
  clip: { audio: Buffer; transcript: string; seconds: number; fileName: string; by: string },
): Promise<CustomVoice> {
  await ensureVoiceTable();
  const digest = crypto.createHash("sha256").update(clip.audio).update("\0").update(clip.transcript).digest("hex");
  const r = await pool!.query(
    `INSERT INTO license_voices (license_id, voice_id, audio, transcript, seconds, file_name, status, status_detail, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending', '', $7, now())
     ON CONFLICT (license_id) DO UPDATE SET
       voice_id = EXCLUDED.voice_id, audio = EXCLUDED.audio, transcript = EXCLUDED.transcript,
       seconds = EXCLUDED.seconds, file_name = EXCLUDED.file_name,
       status = CASE WHEN license_voices.voice_id = EXCLUDED.voice_id THEN license_voices.status ELSE 'pending' END,
       status_detail = CASE WHEN license_voices.voice_id = EXCLUDED.voice_id THEN license_voices.status_detail ELSE '' END,
       updated_by = EXCLUDED.updated_by, updated_at = now()
     RETURNING ${VIEW}`,
    [licenseId, `v${licenseId}-${digest.slice(0, 20)}`, clip.audio, clip.transcript, clip.seconds, clip.fileName.slice(0, 200), clip.by],
  );
  return r.rows[0];
}

export async function removeVoice(licenseId: number): Promise<void> {
  await ensureVoiceTable();
  await pool!.query("DELETE FROM license_voices WHERE license_id = $1", [licenseId]);
}
