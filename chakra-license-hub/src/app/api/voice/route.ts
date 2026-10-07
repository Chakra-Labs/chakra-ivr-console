import { currentViewer, forbidden, unauthorized, type Viewer } from "@/lib/auth";
import { pool } from "@/lib/db";
import { TRANSCRIPT_MAX_CHARS, clipProblem, isPresetVoice, readWav, voiceModes } from "@/lib/voice-rules";
import { customVoice, removeVoice, saveVoice, voiceAudio } from "@/lib/voices";

// The voice a licence's callers hear. Admins for any licence; a company account
// for its own (it may choose its voice; it still cannot choose its pipeline).
//
//   GET    /api/voice?license=7            { modes, preset, custom }
//   GET    /api/voice?license=7&audio=1    the reference clip (audio/wav)
//   PUT    { licenseId, preset }           a preset voice ("" = the app's default)
//   POST   multipart: license, file, transcript   upload a reference clip
//   DELETE { licenseId }                   remove the reference clip
//
// A preset reaches chakra-ivr-core in the signed licence check (within its
// 10-minute re-check); a clip reaches the speech gateway within its key cache
// (about a minute).

function bad(error: string, status = 400): Response {
  return Response.json({ error }, { status });
}

/** The licence this request may act on, or the response refusing it. */
function licenceFor(viewer: Viewer | null, raw: unknown): number | Response {
  if (!viewer) return unauthorized();
  const id = Number(raw);
  if (viewer.role === "company") return raw == null || raw === "" || id === viewer.licenseId ? viewer.licenseId : forbidden();
  return Number.isInteger(id) && id > 0 ? id : bad("license is required");
}

async function state(licenseId: number) {
  const r = await pool!.query("SELECT pipelines, agent_pipelines, gemini_voice FROM licenses WHERE id = $1", [licenseId]);
  if (!r.rowCount) return null;
  const row = r.rows[0];
  return {
    // Named by kind, not by technology: a company account reads this too.
    modes: voiceModes(row.pipelines, row.agent_pipelines),
    preset: isPresetVoice(row.gemini_voice) ? row.gemini_voice : "",
    custom: await customVoice(licenseId),
  };
}

export async function GET(request: Request) {
  const viewer = await currentViewer();
  const q = new URL(request.url).searchParams;
  const id = licenceFor(viewer, q.get("license"));
  if (id instanceof Response) return id;
  if (!pool) return bad("DATABASE_URL is not configured", 500);
  try {
    if (q.get("audio")) {
      const audio = await voiceAudio(id);
      if (!audio) return bad("No reference clip", 404);
      return new Response(new Uint8Array(audio), {
        headers: { "Content-Type": "audio/wav", "Cache-Control": "private, no-store", "Content-Length": String(audio.length) },
      });
    }
    const s = await state(id);
    return s ? Response.json(s) : bad("Not found", 404);
  } catch (error) {
    console.error("voice GET:", error);
    return bad("Failed to load the voice", 500);
  }
}

export async function PUT(request: Request) {
  const viewer = await currentViewer();
  let body: { licenseId?: unknown; preset?: unknown };
  try {
    body = await request.json();
  } catch {
    return bad("Invalid request");
  }
  const id = licenceFor(viewer, body.licenseId);
  if (id instanceof Response) return id;
  if (!pool) return bad("DATABASE_URL is not configured", 500);
  const preset = body.preset === "" || body.preset == null ? null : body.preset;
  if (preset !== null && !isPresetVoice(preset)) return bad("Choose one of the listed voices.");
  try {
    const r = await pool.query("UPDATE licenses SET gemini_voice = $1 WHERE id = $2", [preset, id]);
    if (!r.rowCount) return bad("Not found", 404);
    return Response.json(await state(id));
  } catch (error) {
    console.error("voice PUT:", error);
    return bad("Failed to save the voice", 500);
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
  if (!transcript) return bad("Type exactly what is said in the clip.");
  if (transcript.length > TRANSCRIPT_MAX_CHARS) return bad(`The transcript is too long (the limit is ${TRANSCRIPT_MAX_CHARS} characters).`);
  const audio = Buffer.from(await file.arrayBuffer());
  const problem = clipProblem(audio);
  if (problem) return bad(problem);
  const wav = readWav(audio);
  try {
    if (!(await pool.query("SELECT 1 FROM licenses WHERE id = $1", [id])).rowCount) return bad("Not found", 404);
    await saveVoice(id, {
      audio,
      transcript,
      seconds: typeof wav === "string" ? 0 : wav.seconds,
      fileName: file.name || "voice.wav",
      by: viewer!.email,
    });
    return Response.json(await state(id));
  } catch (error) {
    console.error("voice POST:", error);
    return bad("Failed to save the clip", 500);
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
    await removeVoice(id);
    return Response.json(await state(id));
  } catch (error) {
    console.error("voice DELETE:", error);
    return bad("Failed to remove the clip", 500);
  }
}
