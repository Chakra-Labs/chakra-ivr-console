// The voice a company's callers hear. Safe to import in the browser (no database).
//
// Two kinds, by the voice pipeline a licence runs:
//  - "preset": one of the realtime model's named voices (Gemini Live);
//  - "clone":  the company's own reference recording, which Chakra TTS speaks in
//              (Chakra Voice): the clip, and exactly what is said in it.

export const PRESET_VOICES = [
  { id: "Leda", gender: "Female", style: "Youthful" },
  { id: "Orus", gender: "Male", style: "Firm" },
  { id: "Alnilam", gender: "Male", style: "Firm" },
  { id: "Sadachbia", gender: "Male", style: "Lively" },
  { id: "Algenib", gender: "Male", style: "Gravelly" },
  { id: "Sadaltager", gender: "Male", style: "Knowledgeable" },
  { id: "Laomedeia", gender: "Female", style: "Upbeat" },
  { id: "Zubenelgenubi", gender: "Male", style: "Casual" },
  { id: "Algieba", gender: "Male", style: "Smooth" },
  { id: "Despina", gender: "Female", style: "Smooth" },
] as const;

const PRESET_IDS = new Set<string>(PRESET_VOICES.map((v) => v.id));

export function isPresetVoice(value: unknown): value is string {
  return typeof value === "string" && PRESET_IDS.has(value);
}

export type VoiceMode = "preset" | "clone";

/** Which kinds of voice a licence's lines use, from its pipelines: the default
 * one (the first), plus any a line is pinned to. Not assigned: either may run. */
export function voiceModes(pipelines: unknown, agentPipelines: unknown): VoiceMode[] {
  const used = new Set<string>();
  if (Array.isArray(pipelines) && typeof pipelines[0] === "string") used.add(pipelines[0]);
  if (agentPipelines && typeof agentPipelines === "object") {
    for (const p of Object.values(agentPipelines as Record<string, unknown>)) if (typeof p === "string") used.add(p);
  }
  const noDefault = !Array.isArray(pipelines) || pipelines.length === 0;
  const modes: VoiceMode[] = [];
  if (noDefault || used.has("chakra")) modes.push("clone");
  if (noDefault || used.has("gemini_live")) modes.push("preset");
  return modes;
}

// The reference recording: a 5-10 second WAV and its transcript.
export const CLIP_MIN_SECONDS = 5;
export const CLIP_MAX_SECONDS = 10;
/** Recorders rarely stop on the second: accept this much either side. */
export const CLIP_TOLERANCE_SECONDS = 0.25;
export const CLIP_MAX_BYTES = 4 * 1024 * 1024;
export const TRANSCRIPT_MAX_CHARS = 500;

export type WavInfo = { seconds: number; sampleRate: number; channels: number; bits: number };

/** Read a WAV file's header. An error message when it is not a WAV the speech
 * engine can use (PCM or float, 8 kHz or more), else its length and format. */
export function readWav(bytes: Uint8Array): WavInfo | string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
  if (bytes.length < 44 || tag(0) !== "RIFF" || tag(8) !== "WAVE") return "This is not a WAV file.";
  let at = 12;
  let fmt: { format: number; channels: number; sampleRate: number; byteRate: number; bits: number } | null = null;
  while (at + 8 <= bytes.length) {
    const id = tag(at);
    const size = view.getUint32(at + 4, true);
    if (id === "fmt " && at + 24 <= bytes.length) {
      fmt = {
        format: view.getUint16(at + 8, true),
        channels: view.getUint16(at + 10, true),
        sampleRate: view.getUint32(at + 12, true),
        byteRate: view.getUint32(at + 16, true),
        bits: view.getUint16(at + 22, true),
      };
    } else if (id === "data") {
      if (!fmt) return "This WAV file has no format header.";
      // 1 = PCM, 3 = float, 0xFFFE = extensible (PCM or float inside).
      if (![1, 3, 0xfffe].includes(fmt.format)) return "Save the recording as an uncompressed (PCM) WAV file.";
      if (!fmt.byteRate || !fmt.channels || fmt.sampleRate < 8000) return "This WAV file's format is not supported.";
      const dataBytes = Math.min(size, bytes.length - at - 8);
      return { seconds: dataBytes / fmt.byteRate, sampleRate: fmt.sampleRate, channels: fmt.channels, bits: fmt.bits };
    }
    at += 8 + size + (size % 2);
  }
  return "This WAV file has no audio in it.";
}

/** What is wrong with a reference clip, or null when it can be used. */
export function clipProblem(bytes: Uint8Array): string | null {
  if (bytes.length > CLIP_MAX_BYTES) return `The file is too large (the limit is ${CLIP_MAX_BYTES / 1024 / 1024} MB).`;
  const wav = readWav(bytes);
  if (typeof wav === "string") return wav;
  if (wav.seconds < CLIP_MIN_SECONDS - CLIP_TOLERANCE_SECONDS || wav.seconds > CLIP_MAX_SECONDS + CLIP_TOLERANCE_SECONDS) {
    return `The clip is ${wav.seconds.toFixed(1)} seconds long. It must be ${CLIP_MIN_SECONDS} to ${CLIP_MAX_SECONDS} seconds.`;
  }
  return null;
}

/** How soon a suspended, deleted or replaced key stops calls (`stops`), or an
 * activated one serves them again, by the kinds of line the licence has: Chakra
 * Voice speech goes through the gateway, which re-checks a key about once a
 * minute; a Gemini Live line only learns at the app's 10-minute licence re-check. */
export function licenceChangeTiming(modes: VoiceMode[] | undefined, stops: boolean): string {
  const chakra = !modes || modes.includes("clone");
  const gemini = !modes || modes.includes("preset");
  const both = chakra && gemini;
  if (stops) {
    const fast = `${both ? "Chakra Voice lines: calls" : "Calls"} stop within about a minute, including calls in progress.`;
    const slow = `${both ? "Gemini Live lines: new calls" : "New calls"} stop within 10 minutes; calls in progress carry on until they end.`;
    return [chakra && fast, gemini && slow].filter(Boolean).join(" ");
  }
  const fast = `${both ? "Chakra Voice lines take" : "Lines take"} calls again within about a minute.`;
  const slow = `${both ? "Gemini Live lines take" : "Lines take"} calls again within 10 minutes.`;
  return `${[chakra && fast, gemini && slow].filter(Boolean).join(" ")} An app that was restarted while suspended must be started again.`;
}
