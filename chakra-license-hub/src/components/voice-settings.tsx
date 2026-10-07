"use client";

// The voice a company's callers hear, edited by an admin (Company settings) or
// by the company itself (Voice). Which editor shows follows the licence's voice
// pipeline: a preset voice for Gemini Live lines, a reference recording for
// Chakra Voice lines. A company account is never told which technology it is.
import { useCallback, useEffect, useRef, useState } from "react";

import { signedOut, useHub } from "./hub-context";
import { Check, Mic, Trash2, Upload } from "./icons";
import { Badge, Button, LinesSkeleton, Spinner, cx, inputClass } from "./ui";
import { ago } from "@/lib/format";
import { track } from "@/lib/loading";
import { CLIP_MAX_SECONDS, CLIP_MIN_SECONDS, PRESET_VOICES, TRANSCRIPT_MAX_CHARS, clipProblem, readWav } from "@/lib/voice-rules";
import type { Client, VoiceState } from "@/lib/types";

async function voiceApi(method: string, licenseId: number, body?: Record<string, unknown> | FormData): Promise<VoiceState> {
  const form = body instanceof FormData;
  const res = await track(
    fetch(method === "GET" ? `/api/voice?license=${licenseId}` : "/api/voice", {
      method,
      headers: form || !body ? undefined : { "Content-Type": "application/json" },
      body: form ? body : body ? JSON.stringify({ licenseId, ...body }) : undefined,
      cache: "no-store",
    }),
  );
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) signedOut();
  if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
  return data as VoiceState;
}

/** Load a licence's voice settings; `save` runs a change and folds the result in. */
function useVoice(client: Client) {
  const { toast, setClients } = useHub();
  const [state, setState] = useState<VoiceState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const apply = useCallback(
    (s: VoiceState) => {
      setState(s);
      // The cards on Companies show the voice too.
      setClients((cs) => cs.map((c) => (c.id === client.id ? { ...c, gemini_voice: s.preset || null, has_custom_voice: !!s.custom } : c)));
    },
    [client.id, setClients],
  );

  useEffect(() => {
    let live = true;
    voiceApi("GET", client.id)
      .then((s) => live && setState(s))
      .catch((e) => live && toast(`Could not load the voice: ${(e as Error).message}`));
    return () => {
      live = false;
    };
    // Reload when the pipeline changes: it decides which editors show.
  }, [client.id, client.voice_modes?.join(), toast]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (what: string, run: () => Promise<VoiceState>) => {
    setBusy(what);
    try {
      apply(await run());
      toast(`${what} saved`, "success");
      return true;
    } catch (e) {
      toast((e as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  };
  return { state, busy, save };
}

/** `technical`: name the pipelines (admins). A company sees the same editors
 * described by what they do. `wide`: the card spans the page, so lay the parts
 * out side by side. */
export function VoiceEditor({ client, technical, wide = false }: { client: Client; technical: boolean; wide?: boolean }) {
  const { state, busy, save } = useVoice(client);
  if (!state) return <LinesSkeleton rows={5} />;
  const both = state.modes.length > 1;

  return (
    <div className={wide && both ? "grid grid-cols-1 xl:grid-cols-2 gap-x-8 gap-y-6 items-start" : "space-y-6"}>
      {state.modes.includes("clone") && (
        <section>
          <SectionTitle
            title={technical ? "Chakra Voice lines: reference voice" : both ? "Custom voice" : "Your custom voice"}
            hint={
              technical
                ? "Chakra TTS speaks in the voice of a short reference recording. Without one, it uses the standard Chakra voice."
                : "Upload a short recording of the voice you want. Your agent will speak in that voice."
            }
          />
          <CloneEditor client={client} state={state} busy={busy} save={save} sideBySide={wide && !both} />
        </section>
      )}
      {state.modes.includes("preset") && (
        <section>
          <SectionTitle
            title={technical ? "Gemini Live lines: preset voice" : both ? "Preset voice" : "Your agent's voice"}
            hint={
              technical
                ? "One of the model's named voices. Needs chakra-ivr-core 0.6 or later in the company's app."
                : both
                  ? "Some of your lines use a preset voice. Choose the one callers hear on them."
                  : "Choose the voice your callers hear."
            }
          />
          <PresetEditor state={state} busy={busy} columns={wide ? (both ? 3 : 6) : 4} onSave={(preset) => save("Voice", () => voiceApi("PUT", client.id, { preset }))} />
        </section>
      )}
    </div>
  );
}

function SectionTitle({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="mb-3">
      <h4 className="text-[13px] font-semibold text-ink">{title}</h4>
      <p className="text-[12px] text-ink-3 mt-0.5">{hint}</p>
    </div>
  );
}

function PresetEditor({ state, busy, columns, onSave }: { state: VoiceState; busy: string | null; columns: 3 | 4 | 6; onSave: (preset: string) => void }) {
  const [picked, setPicked] = useState(state.preset);
  const options = [{ id: "", gender: "", style: "Set in the app" }, ...PRESET_VOICES];
  return (
    <div>
      <div className={cx("grid grid-cols-2 sm:grid-cols-3 gap-2", columns === 6 ? "lg:grid-cols-4 xl:grid-cols-6" : columns === 4 && "lg:grid-cols-4")} role="radiogroup" aria-label="Preset voice">
        {options.map((v) => {
          const on = picked === v.id;
          return (
            <button
              key={v.id || "default"}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setPicked(v.id)}
              className={cx(
                "relative text-left px-3 py-2.5 rounded-xl border transition-colors",
                on ? "bg-accent/10 border-accent/50" : "bg-panel-2 border-line hover:border-line-strong",
              )}
            >
              <div className={cx("text-[13px] font-medium truncate", on ? "text-accent" : "text-ink")}>{v.id || "Default"}</div>
              <div className="text-[11px] text-ink-3 truncate">{v.gender ? `${v.gender} · ${v.style}` : v.style}</div>
              {on && <Check size={13} className="absolute top-2.5 right-2.5 text-accent" />}
            </button>
          );
        })}
      </div>
      <div className="flex items-center justify-between gap-3 mt-3">
        <span className="text-[11px] text-ink-3">Applies to new calls within 10 minutes.</span>
        <Button variant="primary" disabled={picked === state.preset || busy !== null} onClick={() => onSave(picked)}>
          {busy === "Voice" && <Spinner size={13} />} Save voice
        </Button>
      </div>
    </div>
  );
}

const STATUS = {
  pending: { tone: "warning", label: "Saved · used from the next call" },
  ready: { tone: "good", label: "In use" },
  rejected: { tone: "critical", label: "Could not be used" },
} as const;

function CloneEditor({
  client,
  state,
  busy,
  save,
  sideBySide,
}: {
  client: Client;
  state: VoiceState;
  busy: string | null;
  save: (what: string, run: () => Promise<VoiceState>) => Promise<boolean>;
  sideBySide?: boolean;
}) {
  const { now } = useHub();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [seconds, setSeconds] = useState<number | null>(null);
  const [problem, setProblem] = useState("");
  const [transcript, setTranscript] = useState("");
  const custom = state.custom;

  const choose = async (f: File | null) => {
    setFile(f);
    setSeconds(null);
    setProblem("");
    if (!f) return;
    const bytes = new Uint8Array(await f.arrayBuffer());
    const wav = readWav(bytes);
    if (typeof wav !== "string") setSeconds(wav.seconds);
    setProblem(clipProblem(bytes) ?? "");
  };

  const upload = async () => {
    if (!file) return;
    const form = new FormData();
    form.set("license", String(client.id));
    form.set("file", file);
    form.set("transcript", transcript);
    if (await save("Reference voice", () => voiceApi("POST", client.id, form))) {
      setFile(null);
      setSeconds(null);
      setTranscript("");
      if (input.current) input.current.value = "";
    }
  };

  const remove = () => {
    if (!confirm("Remove the custom voice?\n\nCalls go back to the standard voice within a minute.")) return;
    save("Standard voice", () => voiceApi("DELETE", client.id, {}));
  };

  return (
    <div className={sideBySide ? "grid grid-cols-1 xl:grid-cols-2 gap-4 items-start" : "space-y-4"}>
      {custom ? (
        <div className="rounded-xl bg-panel-2 border border-line p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-panel-3 border border-line flex items-center justify-center text-accent shrink-0">
              <Mic size={15} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] text-ink font-medium truncate">{custom.file_name || "Reference recording"}</div>
              <div className="text-[11px] text-ink-3">
                {custom.seconds.toFixed(1)} s · uploaded {ago(custom.updated_at, now)}
                {custom.updated_by ? ` by ${custom.updated_by}` : ""}
              </div>
            </div>
            <Badge tone={STATUS[custom.status].tone}>{STATUS[custom.status].label}</Badge>
          </div>
          {custom.status === "rejected" && (
            <p className="text-[12px] text-critical">
              The speech engine could not use this clip{custom.status_detail ? `: ${custom.status_detail}` : ""}. Calls use the
              standard voice until you upload another.
            </p>
          )}
          {/* Keyed by the clip, so a new upload reloads the player. */}
          <audio key={custom.voice_id} controls preload="none" className="w-full h-9" src={`/api/voice?license=${client.id}&audio=1&v=${custom.voice_id}`} />
          <p className="text-[12px] text-ink-2 leading-relaxed">
            <span className="text-ink-3">Transcript: </span>
            {custom.transcript}
          </p>
          <div className="flex justify-end">
            <Button variant="danger" size="sm" disabled={busy !== null} onClick={remove}>
              <Trash2 size={13} /> Remove and use the standard voice
            </Button>
          </div>
        </div>
      ) : (
        <div className="rounded-xl bg-panel-2 border border-line p-4 text-[13px] text-ink-2">
          No custom voice yet: calls use the standard voice.
        </div>
      )}

      <div className="rounded-xl border border-line p-4 space-y-3">
        <div className="text-[13px] font-medium text-ink">{custom ? "Replace it with a new recording" : "Upload a recording"}</div>
        <div>
          <label className="block text-[12px] text-ink-2 mb-1.5" htmlFor={`voice-file-${client.id}`}>
            Voice clip <span className="text-ink-3">(WAV, {CLIP_MIN_SECONDS} to {CLIP_MAX_SECONDS} seconds)</span>
          </label>
          <input
            ref={input}
            id={`voice-file-${client.id}`}
            type="file"
            accept=".wav,audio/wav,audio/x-wav"
            onChange={(e) => choose(e.target.files?.[0] ?? null)}
            className="block w-full text-[12px] text-ink-2 file:mr-3 file:h-8 file:px-3 file:rounded-lg file:border file:border-line-strong file:bg-panel-3 file:text-ink file:text-[12px] file:cursor-pointer"
          />
          {file && (
            <p className={cx("text-[11px] mt-1.5", problem ? "text-critical" : "text-good")}>
              {problem || `${seconds?.toFixed(1)} seconds: good.`}
            </p>
          )}
        </div>
        <div>
          <label className="block text-[12px] text-ink-2 mb-1.5" htmlFor={`voice-text-${client.id}`}>
            What is said in the clip <span className="text-ink-3">(word for word, in Sinhala)</span>
          </label>
          <textarea
            id={`voice-text-${client.id}`}
            className={cx(inputClass, "h-auto min-h-[72px] py-2 leading-relaxed")}
            maxLength={TRANSCRIPT_MAX_CHARS}
            value={transcript}
            placeholder="ආයුබෝවන්, ඔබට සහාය වෙන්නේ කෙසේද?"
            onChange={(e) => setTranscript(e.target.value)}
          />
        </div>
        <ul className="text-[11px] text-ink-3 space-y-1 list-disc pl-4">
          <li>One speaker, speaking naturally, in a quiet room: no music, echo or background noise.</li>
          <li>The text must match the recording exactly. A wrong word makes the voice stumble.</li>
          <li>Only use a voice you have the speaker&apos;s permission to use.</li>
        </ul>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] text-ink-3">Used on calls within about a minute.</span>
          <Button variant="primary" disabled={!file || !!problem || !transcript.trim() || busy !== null} onClick={upload}>
            {busy === "Reference voice" ? <Spinner size={13} /> : <Upload size={14} />} {custom ? "Replace voice" : "Upload voice"}
          </Button>
        </div>
      </div>
    </div>
  );
}
