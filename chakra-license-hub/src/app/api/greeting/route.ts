import crypto from "crypto";

import { currentViewer, forbidden, unauthorized, type Viewer } from "@/lib/auth";
import { pool } from "@/lib/db";
import { GREETING_MAX_SECONDS, GREETING_MIN_SECONDS, TRANSCRIPT_MAX_CHARS, CLIP_MAX_BYTES, readWav } from "@/lib/voice-rules";

// How a licence's calls are greeted (Chakra Voice lines). Admins for any licence;
// a company account for its own.
//
//   GET    /api/greeting?license=7            { mode, recording }
//   GET    /api/greeting?license=7&audio=1    the recording (audio/wav)
//   PUT    { licenseId, mode }                "recorded" | "auto" | "" (the app decides)
//   POST   multipart: license, file, transcript   upload the opening recording
//   DELETE { licenseId }                      remove it
//
// "recorded": a recorded opening line plays the moment a call connects, and the
// model writes only what follows it. The recording is the one uploaded here, or
// else one the app makes from its own opening line on its first call. "auto":
// the whole greeting is generated. chakra-ivr-core 0.6.5+ reads the choice from
// the signed licence check (within 10 minutes) and fetches the recording from
// the speech gateway.

// The same definition as chakra-gpu-fleet/fleet/schema.sql.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS license_greetings (
    license_id    INTEGER PRIMARY KEY,
    greeting_id   TEXT NOT NULL,
    audio         BYTEA NOT NULL,
    transcript    TEXT NOT NULL,
    seconds       REAL NOT NULL DEFAULT 0,
    file_name     TEXT,
    updated_by    TEXT,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
)`;
const MODES = new Set(["recorded", "auto"]);

let ready: Promise<void> | null = null;
function ensureTable(): Promise<void> {
  ready ??= pool!
    .query(SCHEMA)
    .then(() => pool!.query("ALTER TABLE licenses ADD COLUMN IF NOT EXISTS greeting_mode TEXT"))
    .then(
      () => undefined,
      (e) => {
        ready = null;
        throw e;
      },
    );
  return ready;
}

function bad(error: string, status = 400): Response {
  return Response.json({ error }, { status });
}

function licenceFor(viewer: Viewer | null, raw: unknown): number | Response {
  if (!viewer) return unauthorized();
  const id = Number(raw);
  if (viewer.role === "company") return raw == null || raw === "" || id === viewer.licenseId ? viewer.licenseId : forbidden();
  return Number.isInteger(id) && id > 0 ? id : bad("license is required");
}

async function state(licenseId: number) {
  await ensureTable();
  const lic = await pool!.query("SELECT greeting_mode FROM licenses WHERE id = $1", [licenseId]);
  if (!lic.rowCount) return null;
  const rec = await pool!.query(
    "SELECT greeting_id, file_name, seconds::float8 AS seconds, transcript, updated_by, updated_at FROM license_greetings WHERE license_id = $1",
    [licenseId],
  );
  const mode = lic.rows[0].greeting_mode;
  return { mode: MODES.has(mode) ? mode : "", recording: rec.rows[0] ?? null };
}

export async function GET(request: Request) {
  const viewer = await currentViewer();
  const q = new URL(request.url).searchParams;
  const id = licenceFor(viewer, q.get("license"));
  if (id instanceof Response) return id;
  if (!pool) return bad("DATABASE_URL is not configured", 500);
  try {
    if (q.get("audio")) {
      await ensureTable();
      const r = await pool.query("SELECT audio FROM license_greetings WHERE license_id = $1", [id]);
      if (!r.rowCount) return bad("No recording", 404);
      const audio: Buffer = r.rows[0].audio;
      return new Response(new Uint8Array(audio), {
        headers: { "Content-Type": "audio/wav", "Cache-Control": "private, no-store", "Content-Length": String(audio.length) },
      });
    }
    const s = await state(id);
    return s ? Response.json(s) : bad("Not found", 404);
  } catch (error) {
    console.error("greeting GET:", error);
    return bad("Failed to load the greeting", 500);
  }
}

export async function PUT(request: Request) {
  const viewer = await currentViewer();
  let body: { licenseId?: unknown; mode?: unknown };
  try {
    body = await request.json();
  } catch {
    return bad("Invalid request");
  }
  const id = licenceFor(viewer, body.licenseId);
  if (id instanceof Response) return id;
  if (!pool) return bad("DATABASE_URL is not configured", 500);
  const mode = body.mode === "" || body.mode == null ? null : body.mode;
  if (mode !== null && !MODES.has(String(mode))) return bad("Choose how calls are greeted.");
  try {
    await ensureTable();
    const r = await pool.query("UPDATE licenses SET greeting_mode = $1 WHERE id = $2", [mode, id]);
    if (!r.rowCount) return bad("Not found", 404);
    return Response.json(await state(id));
  } catch (error) {
    console.error("greeting PUT:", error);
    return bad("Failed to save the greeting", 500);
  }
}

export async function POST(request: Request) {
  const viewer = await currentViewer();
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return bad("Invalid request");
  }
  const id = licenceFor(viewer, form.get("license"));
  if (id instanceof Response) return id;
  if (!pool) return bad("DATABASE_URL is not configured", 500);
  const file = form.get("file");
  const transcript = String(form.get("transcript") ?? "").replace(/\s+/g, " ").trim();
  if (!(file instanceof File)) return bad("Choose a WAV file.");
  if (!transcript) return bad("Type exactly what is said in the recording.");
  if (transcript.length > TRANSCRIPT_MAX_CHARS) return bad(`The text is too long (the limit is ${TRANSCRIPT_MAX_CHARS} characters).`);
  const audio = Buffer.from(await file.arrayBuffer());
  if (audio.length > CLIP_MAX_BYTES) return bad(`The file is too large (the limit is ${CLIP_MAX_BYTES / 1024 / 1024} MB).`);
  const wav = readWav(audio);
  if (typeof wav === "string") return bad(wav);
  if (wav.bits !== 16) return bad("Save the recording as a 16-bit PCM WAV file.");
  if (wav.seconds < GREETING_MIN_SECONDS || wav.seconds > GREETING_MAX_SECONDS) {
    return bad(`The recording is ${wav.seconds.toFixed(1)} seconds long. It must be ${GREETING_MIN_SECONDS} to ${GREETING_MAX_SECONDS} seconds.`);
  }
  try {
    await ensureTable();
    if (!(await pool.query("SELECT 1 FROM licenses WHERE id = $1", [id])).rowCount) return bad("Not found", 404);
    const digest = crypto.createHash("sha256").update(audio).update("\0").update(transcript).digest("hex");
    await pool.query(
      `INSERT INTO license_greetings (license_id, greeting_id, audio, transcript, seconds, file_name, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (license_id) DO UPDATE SET greeting_id = EXCLUDED.greeting_id, audio = EXCLUDED.audio,
         transcript = EXCLUDED.transcript, seconds = EXCLUDED.seconds, file_name = EXCLUDED.file_name,
         updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [id, `g${id}-${digest.slice(0, 20)}`, audio, transcript, wav.seconds, (file.name || "greeting.wav").slice(0, 200), viewer!.email],
    );
    return Response.json(await state(id));
  } catch (error) {
    console.error("greeting POST:", error);
    return bad("Failed to save the recording", 500);
  }
}

export async function DELETE(request: Request) {
  const viewer = await currentViewer();
  let body: { licenseId?: unknown };
  try {
    body = await request.json();
  } catch {
    return bad("Invalid request");
  }
  const id = licenceFor(viewer, body.licenseId);
  if (id instanceof Response) return id;
  if (!pool) return bad("DATABASE_URL is not configured", 500);
  try {
    await ensureTable();
    await pool.query("DELETE FROM license_greetings WHERE license_id = $1", [id]);
    return Response.json(await state(id));
  } catch (error) {
    console.error("greeting DELETE:", error);
    return bad("Failed to remove the recording", 500);
  }
}
