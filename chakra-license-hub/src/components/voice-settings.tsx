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
import {
  CLIP_MAX_SECONDS,
  CLIP_MIN_SECONDS,
  GREETING_MAX_SECONDS,
  GREETING_MIN_SECONDS,
  PRESET_VOICES,
  TRANSCRIPT_MAX_CHARS,
  clipProblem,
  readWav,
} from "@/lib/voice-rules";
import type { Client, GreetingState, VoiceState } from "@/lib/types";

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
  // An admin can prepare either voice ahead of a pipeline change; each says
  // whether a line uses it now. A company sees only the kinds its lines use.
  const shown = technical ? (["clone", "preset"] as const) : state.modes;
  const both = shown.length > 1;
  const inUse = (mode: "clone" | "preset") => (technical ? state.modes.includes(mode) : undefined);

  return (
    <div className={wide && both ? "grid grid-cols-1 xl:grid-cols-2 gap-x-8 gap-y-6 items-start" : "space-y-6"}>
      {shown.includes("clone") && (
        <section>
          <SectionTitle
            inUse={inUse("clone")}
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
      {shown.includes("preset") && (
        <section>
          <SectionTitle
            inUse={inUse("preset")}
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

/** `inUse`: whether a line runs this kind of voice now (admins only). */
function SectionTitle({ title, hint, inUse }: { title: string; hint: string; inUse?: boolean }) {
  return (
    <div className="mb-3">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-[13px] font-semibold text-ink">{title}</h4>
        {inUse !== undefined && <Badge tone={inUse ? "good" : "neutral"}>{inUse ? "Used by lines now" : "No line uses this now"}</Badge>}
      </div>
      <p className="text-[12px] text-ink-3 mt-0.5">
        {hint}
        {inUse === false && " You can set it now: it applies as soon as a line is moved to this voice AI."}
      </p>
    </div>
  );
}

function PresetEditor({ state, busy, columns, onSave }: { state: VoiceState; busy: string | null; columns: 3 | 4 | 6; onSave: (preset: string) => void }) {
  const { confirm } = useHub();
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
        <Button variant="primary" disabled={picked === state.preset || busy !== null} onClick={async () => {
            const yes = await confirm({
              title: picked ? `Change the voice to ${picked}?` : "Go back to the default voice?",
              body: picked ? "Callers on these lines will hear this voice." : "Callers will hear the voice set in the app.",
              takes: "It takes up to 10 minutes to reach the phone lines. Calls already in progress keep the current voice.",
              confirmLabel: "Change voice",
            });
            if (yes) onSave(picked);
          }}>
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
  const { now, confirm } = useHub();
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
    const yes = await confirm({
      title: custom ? "Replace the custom voice?" : "Use this recording as the voice?",
      body: `Callers will hear the agent speak in the voice of "${file.name}".`,
      takes: "New calls use it within about a minute. Calls already in progress keep the current voice.",
      confirmLabel: custom ? "Replace voice" : "Upload voice",
    });
    if (!yes) return;
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

  const remove = async () => {
    const yes = await confirm({
      title: "Remove the custom voice?",
      body: "Callers will hear the standard voice again. The recording is deleted.",
      takes: "New calls go back to the standard voice within about a minute.",
      confirmLabel: "Remove voice",
      danger: true,
    });
    if (yes) save("Standard voice", () => voiceApi("DELETE", client.id, {}));
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

// ── greeting ──

async function greetingApi(method: string, licenseId: number, body?: Record<string, unknown> | FormData): Promise<GreetingState> {
  const form = body instanceof FormData;
  const res = await track(
    fetch(method === "GET" ? `/api/greeting?license=${licenseId}` : "/api/greeting", {
      method,
      headers: form || !body ? undefined : { "Content-Type": "application/json" },
      body: form ? body : body ? JSON.stringify({ licenseId, ...body }) : undefined,
      cache: "no-store",
    }),
  );
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) signedOut();
  if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
  return data as GreetingState;
}

const GREETING_MODES = [
  { id: "recorded", label: "Recorded opening", detail: "Plays the instant the call connects. The agent then continues, and still welcomes a returning caller by what they called about." },
  { id: "auto", label: "Generated each call", detail: "The agent composes the whole greeting. Callers wait a few seconds before they hear it." },
] as const;

/** How calls are opened on Chakra Voice lines: a card of its own (admins and the company). */
export function GreetingEditor({ client }: { client: Client }) {
  const { toast, confirm, now } = useHub();
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<GreetingState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState("");
  const [transcript, setTranscript] = useState("");

  useEffect(() => {
    let live = true;
    greetingApi("GET", client.id)
      .then((s) => live && setState(s))
      .catch((e) => live && toast(`Could not load the greeting: ${(e as Error).message}`));
    return () => {
      live = false;
    };
  }, [client.id, toast]);

  if (!state) return <LinesSkeleton rows={3} />;
  const rec = state.recording;

  const run = async (what: string, call: () => Promise<GreetingState>) => {
    setBusy(what);
    try {
      setState(await call());
      toast(`${what} saved`, "success");
      return true;
    } catch (e) {
      toast((e as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const setMode = async (mode: string) => {
    if (mode === state.mode) return;
    const yes = await confirm({
      title: mode === "recorded" ? "Open calls with a recorded greeting?" : "Generate the greeting on every call?",
      body:
        mode === "recorded"
          ? rec
            ? "Callers will hear your uploaded recording the moment the call connects."
            : "Callers will hear a recording of the standard opening line. The first call after this makes that recording and is greeted the usual way."
          : "The agent will compose the whole greeting each time. Callers wait a few seconds before they hear it.",
      takes: "It takes up to 10 minutes to reach the phone lines. No redeploy is needed.",
      confirmLabel: "Change greeting",
    });
    if (yes) run("Greeting", () => greetingApi("PUT", client.id, { mode }));
  };

  const choose = async (f: File | null) => {
    setFile(f);
    setProblem("");
    if (!f) return;
    const wav = readWav(new Uint8Array(await f.arrayBuffer()));
    if (typeof wav === "string") setProblem(wav);
    else if (wav.bits !== 16) setProblem("Save the recording as a 16-bit PCM WAV file.");
    else if (wav.seconds < GREETING_MIN_SECONDS || wav.seconds > GREETING_MAX_SECONDS) {
      setProblem(`The recording is ${wav.seconds.toFixed(1)} seconds long. It must be ${GREETING_MIN_SECONDS} to ${GREETING_MAX_SECONDS} seconds.`);
    }
  };

  const upload = async () => {
    if (!file) return;
    const yes = await confirm({
      title: rec ? "Replace the greeting recording?" : "Use this recording as the greeting?",
      body: `Callers will hear "${file.name}" when a call connects, then the agent continues from it.`,
      takes: "It takes up to 10 minutes to reach the phone lines. The first call after that fetches the recording and is greeted the usual way.",
      confirmLabel: rec ? "Replace recording" : "Upload recording",
    });
    if (!yes) return;
    const form = new FormData();
    form.set("license", String(client.id));
    form.set("file", file);
    form.set("transcript", transcript);
    if (await run("Greeting recording", () => greetingApi("POST", client.id, form))) {
      setFile(null);
      setTranscript("");
      if (input.current) input.current.value = "";
    }
  };

  const remove = async () => {
    const yes = await confirm({
      title: "Remove the greeting recording?",
      body: "With a recorded opening still chosen, callers will hear a recording of the standard opening line instead.",
      takes: "It takes up to 10 minutes to reach the phone lines.",
      confirmLabel: "Remove recording",
      danger: true,
    });
    if (yes) run("Greeting recording", () => greetingApi("DELETE", client.id, {}));
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" role="radiogroup" aria-label="Greeting">
        {GREETING_MODES.map((m) => {
          const on = state.mode === m.id;
          return (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={busy !== null}
              onClick={() => setMode(m.id)}
              className={cx("relative text-left p-3 rounded-xl border transition-colors", on ? "bg-accent/10 border-accent/50" : "bg-panel-2 border-line hover:border-line-strong")}
            >
              <div className={cx("text-[13px] font-medium", on ? "text-accent" : "text-ink")}>{m.label}</div>
              <div className="text-[12px] text-ink-3 mt-0.5">{m.detail}</div>
              {on && <Check size={13} className="absolute top-3 right-3 text-accent" />}
            </button>
          );
        })}
      </div>
      {!state.mode && <p className="text-[12px] text-ink-3">Not chosen here yet: the app&apos;s own setting decides.</p>}

      {state.mode !== "auto" && (
        <div className="rounded-xl border border-line p-4 space-y-3">
          {rec ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] text-ink font-medium truncate">{rec.file_name || "Greeting recording"}</div>
                  <div className="text-[11px] text-ink-3">
                    {rec.seconds.toFixed(1)} s · uploaded {ago(rec.updated_at, now)}
                    {rec.updated_by ? ` by ${rec.updated_by}` : ""}
                  </div>
                </div>
                <Button variant="danger" size="sm" disabled={busy !== null} onClick={remove}>
                  <Trash2 size={13} /> Remove
                </Button>
              </div>
              <audio key={rec.greeting_id} controls preload="none" className="w-full h-9" src={`/api/greeting?license=${client.id}&audio=1&v=${rec.greeting_id}`} />
              <p className="text-[12px] text-ink-2">
                <span className="text-ink-3">It says: </span>
                {rec.transcript}
              </p>
            </div>
          ) : (
            <p className="text-[13px] text-ink-2">
              No recording uploaded: with a recorded opening chosen, the app records its standard opening line itself, in the
              current voice, on its first call.
            </p>
          )}
          <div className="pt-1 border-t border-line space-y-3">
            <div className="text-[13px] font-medium text-ink pt-3">{rec ? "Replace it" : "Upload your own opening"}</div>
            <div>
              <label className="block text-[12px] text-ink-2 mb-1.5" htmlFor={`greet-file-${client.id}`}>
                Recording <span className="text-ink-3">(16-bit WAV, {GREETING_MIN_SECONDS} to {GREETING_MAX_SECONDS} seconds: the opening line only)</span>
              </label>
              <input
                ref={input}
                id={`greet-file-${client.id}`}
                type="file"
                accept=".wav,audio/wav,audio/x-wav"
                onChange={(e) => choose(e.target.files?.[0] ?? null)}
                className="block w-full text-[12px] text-ink-2 file:mr-3 file:h-8 file:px-3 file:rounded-lg file:border file:border-line-strong file:bg-panel-3 file:text-ink file:text-[12px] file:cursor-pointer"
              />
              {file && problem && <p className="text-[11px] mt-1.5 text-critical">{problem}</p>}
            </div>
            <div>
              <label className="block text-[12px] text-ink-2 mb-1.5" htmlFor={`greet-text-${client.id}`}>
                What is said in it <span className="text-ink-3">(word for word: the agent is told it has already said this)</span>
              </label>
              <textarea
                id={`greet-text-${client.id}`}
                className={cx(inputClass, "h-auto min-h-[60px] py-2 leading-relaxed")}
                maxLength={TRANSCRIPT_MAX_CHARS}
                value={transcript}
                placeholder="ආයුබෝවන්! ගොවි මිතුරු වෙත ඔබව සාදරයෙන් පිළිගන්නවා."
                onChange={(e) => setTranscript(e.target.value)}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] text-ink-3">Record only the fixed opening. The agent adds the rest, such as what a returning caller last asked about.</span>
              <Button variant="primary" disabled={!file || !!problem || !transcript.trim() || busy !== null} onClick={upload}>
                {busy === "Greeting recording" ? <Spinner size={13} /> : <Upload size={14} />} {rec ? "Replace" : "Upload"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
