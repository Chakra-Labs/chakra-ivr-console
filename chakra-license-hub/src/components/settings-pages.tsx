"use client";

// Settings pages.
//
// Admins, one company at a time:
//  - "Company settings": company & package, voice pipeline, the voice callers
//    hear, and daily talk time: how the company's lines behave.
//  - "Licences & sign-in" (licences-page.tsx) uses the cards exported here: the
//    customer's IVR Console sign-in, licence status & key, deleting the licence.
//
// A company account: "Talk-time limit", "Voice" and "Account" (its licence
// details and password). The server enforces the same split (api/licenses,
// api/voice, api/console-users, api/auth/password).
import { useEffect, useState } from "react";

import { licenseApi, signedOut, useHub } from "./hub-context";
import { AlertTriangle, Building, Clock, Copy, Key, Phone, Plus, RefreshCw, Trash2, X } from "./icons";
import { Badge, Button, Card, Empty, KeyValue, LinesSkeleton, Spinner, cx, inputClass } from "./ui";
import { MIN_PASSWORD } from "@/lib/account-rules";
import { MAX_LIMIT_MINUTES, MAX_WARNING_SECONDS, formatAgentLimits, parseAgentLimits, wholeNumber } from "@/lib/daily-limit";
import { ago, compact, dateOnly, dateTime } from "@/lib/format";
import { track } from "@/lib/loading";
import { DEFAULT_PACKAGE, findPackage } from "@/lib/packages";
import { PIPELINES, isPipeline, pipelineLabel } from "@/lib/pipelines";
import { VoiceEditor } from "./voice-settings";
import type { Client, ConsoleAccount } from "@/lib/types";

// ── shared pieces ────────────────────────────────────────────────────────────

/** Save a licence change and fold the returned row into the hub's list. */
function useLicenceUpdate(client: Client) {
  const { setClients, toast } = useHub();
  const [busy, setBusy] = useState<string | null>(null);
  const update = async (body: Record<string, unknown>, what: string) => {
    setBusy(what);
    try {
      const row = await licenseApi<Partial<Client>>("PUT", { id: client.id, ...body });
      // The usage figures come from the list query, not from an update's reply.
      setClients((cs) =>
        cs.map((c) =>
          c.id === client.id
            ? { ...c, ...row, month_minutes: c.month_minutes, month_calls: c.month_calls, has_custom_voice: c.has_custom_voice, last_activity: c.last_activity }
            : c,
        ),
      );
      toast(`${what} saved`, "success");
      return true;
    } catch (e) {
      toast(`Could not save: ${(e as Error).message}`);
      return false;
    } finally {
      setBusy(null);
    }
  };
  return { busy, setBusy, update };
}

function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={cx(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50",
        on ? "bg-accent" : "bg-panel-3 border border-line-strong",
      )}
    >
      <span className={cx("inline-block h-4 w-4 rounded-full bg-white shadow transition-transform", on ? "translate-x-6" : "translate-x-1")} />
    </button>
  );
}

function NumberField({
  id,
  label,
  hint,
  unit,
  value,
  onChange,
  invalid,
}: {
  id: string;
  label: string;
  hint?: string;
  unit: string;
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
}) {
  return (
    <div>
      <label className="block text-[12px] text-ink-2 mb-1.5" htmlFor={id}>
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          inputMode="numeric"
          className={cx(inputClass, "pr-14 tabular", invalid && "border-critical")}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-ink-3 pointer-events-none">{unit}</span>
      </div>
      {hint && <p className="text-[11px] text-ink-3 mt-1">{hint}</p>}
    </div>
  );
}

/** The daily talk-time limit per caller: on/off, minutes, the reminder, and
 * optional per-agent limits. Used by admins and by the company itself. */
export function TalkTimeEditor({
  client,
  busy,
  onSave,
}: {
  client: Client;
  busy: boolean;
  onSave: (body: { dailyLimitMinutes: number; limitWarningSeconds: number; agentDailyLimits: Record<string, number> }) => void;
}) {
  const savedMinutes = client.daily_limit_minutes ?? 0;
  const savedWarning = client.limit_warning_seconds ?? 60;
  const savedAgents = client.agent_daily_limits ?? {};
  const [on, setOn] = useState(savedMinutes > 0);
  const [minutes, setMinutes] = useState(String(savedMinutes > 0 ? savedMinutes : 15));
  const [warning, setWarning] = useState(String(savedWarning));
  const [agents, setAgents] = useState(formatAgentLimits(savedAgents));

  const nextMinutes = on ? wholeNumber(minutes, MAX_LIMIT_MINUTES) : 0;
  const nextWarning = wholeNumber(warning, MAX_WARNING_SECONDS);
  const nextAgents = parseAgentLimits(agents);
  const minutesInvalid = on && (nextMinutes === null || nextMinutes === 0);
  const valid = !minutesInvalid && nextMinutes !== null && nextWarning !== null;
  const unchanged =
    nextMinutes === savedMinutes && nextWarning === savedWarning && JSON.stringify(nextAgents) === JSON.stringify(savedAgents);
  const agentCount = Object.keys(nextAgents).length;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 p-4 rounded-xl bg-panel-2 border border-line">
        <div>
          <div className="text-[13px] font-medium text-ink">Limit each caller&apos;s talk time per day</div>
          <div className="text-[12px] text-ink-3 mt-0.5">Counted per phone number, from midnight Sri Lanka time.</div>
        </div>
        <Switch on={on} onChange={setOn} label="Limit each caller's talk time per day" disabled={busy} />
      </div>

      {on && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <NumberField
            id="limit-minutes"
            label="Talk time per caller, per day"
            unit="min"
            value={minutes}
            onChange={setMinutes}
            invalid={minutesInvalid}
            hint={`1 to ${compact(MAX_LIMIT_MINUTES)} minutes`}
          />
          <NumberField
            id="limit-warning"
            label="Reminder before the time runs out"
            unit="sec"
            value={warning}
            onChange={setWarning}
            invalid={nextWarning === null}
            hint="0 = no reminder"
          />
        </div>
      )}

      <div className="flex items-start gap-3 p-4 rounded-xl border border-accent/25 bg-accent/[0.05]">
        <Clock size={16} className="text-accent mt-0.5 shrink-0" />
        <p className="text-[13px] text-ink-2 leading-relaxed">
          {!on ? (
            <>No limit: callers can talk for as long as they need.</>
          ) : nextMinutes ? (
            <>
              Each caller can talk for <span className="text-ink font-medium">{nextMinutes} minutes a day</span>.
              {nextWarning ? (
                <> They hear a reminder {nextWarning} seconds before the time runs out,</>
              ) : (
                <> When the time runs out</>
              )}{" "}
              then the agent says goodbye and ends the call. A caller with no time left is asked to call again tomorrow.
            </>
          ) : (
            <>Enter the minutes each caller may talk per day.</>
          )}
        </p>
      </div>

      {on && (
        <details className="group rounded-xl border border-line" open={agentCount > 0}>
          <summary className="cursor-pointer select-none px-4 py-3 text-[13px] text-ink-2 hover:text-ink flex items-center justify-between">
            <span>Different limits for specific agents</span>
            <span className="text-[12px] text-ink-3">{agentCount ? `${agentCount} set` : "optional"}</span>
          </summary>
          <div className="px-4 pb-4">
            <textarea
              id="limit-agents"
              aria-label="Agent limits"
              className={cx(inputClass, "font-mono text-[12px] min-h-[72px]")}
              value={agents}
              placeholder="sayuru-ai-tamil = 10"
              onChange={(e) => setAgents(e.target.value)}
            />
            <p className="text-[11px] text-ink-3 mt-1.5">One per line: agent name = minutes. 0 means no limit for that agent.</p>
          </div>
        </details>
      )}

      <div className="flex items-center justify-between gap-3 pt-1">
        <span className="text-[11px] text-ink-3">Applies to new calls within 10 minutes.</span>
        <div className="flex gap-2">
          {!unchanged && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setOn(savedMinutes > 0);
                setMinutes(String(savedMinutes > 0 ? savedMinutes : 15));
                setWarning(String(savedWarning));
                setAgents(formatAgentLimits(savedAgents));
              }}
            >
              Discard
            </Button>
          )}
          <Button
            variant="primary"
            disabled={!valid || unchanged || busy}
            onClick={() => {
              if (valid && nextMinutes !== null && nextWarning !== null) {
                onSave({ dailyLimitMinutes: nextMinutes, limitWarningSeconds: nextWarning, agentDailyLimits: on ? nextAgents : {} });
              }
            }}
          >
            {busy && <Spinner size={13} />} Save changes
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── admins: Company settings ─────────────────────────────────────────────────

export default function CompanySettingsPage({ id }: { id?: number }) {
  const { clients, clientsLoaded, navigate } = useHub();

  if (!clientsLoaded) return <SettingsSkeleton />;
  if (clients.length === 0) return <Empty>No companies yet. Create a licence to add one.</Empty>;
  const client = clients.find((c) => c.id === id) ?? clients[0];

  return (
    <div className="space-y-5">
      <section className="bg-panel border border-line rounded-2xl p-4 flex flex-wrap items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-panel-3 border border-line flex items-center justify-center text-accent shrink-0">
          <Building size={18} />
        </div>
        <div className="w-full sm:w-80">
          <label className="sr-only" htmlFor="settings-company">Company</label>
          <select
            id="settings-company"
            className={inputClass}
            value={client.id}
            onChange={(e) => navigate({ page: "settings", id: Number(e.target.value) })}
          >
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.company_name}
                {c.is_active ? "" : " (suspended)"}
              </option>
            ))}
          </select>
        </div>
        <Badge tone="accent">{client.package_name || DEFAULT_PACKAGE}</Badge>
        <Badge tone={client.is_active ? "good" : "critical"}>{client.is_active ? "Active" : "Suspended"}</Badge>
        <div className="flex-1" />
        <Button variant="ghost" onClick={() => navigate({ page: "company", id: client.id })}>
          View dashboard
        </Button>
        <Button onClick={() => navigate({ page: "licences", id: client.id })}>
          <Key size={14} /> Licence &amp; sign-in
        </Button>
      </section>

      <div key={client.id} className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        {/* Full-width rows above and below two cards of about the same height. */}
        <div className="xl:col-span-12">
          <CompanyPackageCard client={client} />
        </div>
        <div className="xl:col-span-7">
          <PipelineCard client={client} />
        </div>
        <div className="xl:col-span-5">
          <TalkTimeCard client={client} />
        </div>
        <div className="xl:col-span-12">
          <VoiceCard client={client} />
        </div>
      </div>
    </div>
  );
}

function CompanyPackageCard({ client }: { client: Client }) {
  const { packages } = useHub();
  const { busy, update } = useLicenceUpdate(client);
  const [name, setName] = useState(client.company_name);
  const [pkg, setPkg] = useState(findPackage(packages, client.package_name)?.name ?? client.package_name ?? DEFAULT_PACKAGE);
  const known = packages.some((p) => p.name === pkg);

  return (
    <Card title="Company & package" subtitle="How the company is named, and what it has bought">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-[12px] text-ink-2 mb-1.5" htmlFor="company-name">Company name</label>
          <div className="flex gap-2">
            <input id="company-name" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
            <Button
              disabled={!name.trim() || name.trim() === client.company_name || busy !== null}
              onClick={() => update({ action: "edit", companyName: name.trim() }, "Name")}
            >
              {busy === "Name" && <Spinner size={13} />} Save
            </Button>
          </div>
        </div>
        <div>
          <label className="block text-[12px] text-ink-2 mb-1.5" htmlFor="company-package">Package</label>
          <div className="flex gap-2">
            <select id="company-package" className={inputClass} value={pkg} onChange={(e) => setPkg(e.target.value)}>
              {!known && <option value={pkg}>{pkg} (not on the price sheet)</option>}
              {packages.map((p) => (
                <option key={p.id} value={p.name}>
                  {p.name} · {p.calls ? `${compact(p.calls)} calls · ` : ""}{compact(p.maxMinutes)} min · {p.lines} at once
                </option>
              ))}
            </select>
            <Button disabled={pkg === client.package_name || busy !== null} onClick={() => update({ action: "package", packageName: pkg }, "Package")}>
              {busy === "Package" && <Spinner size={13} />} Save
            </Button>
          </div>
        </div>
      </div>
      <p className="text-[11px] text-ink-3 mt-3">The GPU fleet is sized from packages: check GPU fleet after an upgrade.</p>
    </Card>
  );
}

type LineRule = { agent: string; pipeline: string };

/** Which voice AI the company's phone lines run: one for all of them, and any
 * named line ("agent") that runs the other. */
function PipelineCard({ client }: { client: Client }) {
  const { busy, update } = useLicenceUpdate(client);
  const savedDefault = client.pipelines?.[0] ?? "";
  const savedRules = client.agent_pipelines ?? {};
  const [primary, setPrimary] = useState<string>(savedDefault);
  const [rules, setRules] = useState<LineRule[]>(Object.entries(savedRules).map(([agent, pipeline]) => ({ agent, pipeline })));

  const other = PIPELINES.find((p) => p.id !== primary)?.id ?? PIPELINES[0].id;
  const pins: Record<string, string> = {};
  for (const r of rules) if (r.agent.trim() && isPipeline(r.pipeline)) pins[r.agent.trim()] = r.pipeline;
  // The licence lists its default first, then any other pipeline a line uses.
  const next = primary ? [primary, ...PIPELINES.map((p) => p.id).filter((id) => id !== primary && Object.values(pins).includes(id))] : [];
  const sorted = (o: Record<string, string>) => JSON.stringify(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
  const unchanged = primary === savedDefault && sorted(pins) === sorted(savedRules);
  const different = Object.entries(pins).filter(([, pipeline]) => pipeline !== primary);
  const setRule = (at: number, change: Partial<LineRule>) => setRules((rs) => rs.map((r, n) => (n === at ? { ...r, ...change } : r)));

  return (
    <Card title="Voice pipeline" subtitle="Which voice AI answers the company's calls. Only Chakra Labs can change this.">
      <div className="text-[12px] text-ink-2 mb-2">For all of the company&apos;s phone lines</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {[...PIPELINES, { id: "", label: "Not assigned", detail: "The company's own app configuration decides" }].map((p) => (
          <label
            key={p.id || "none"}
            className={cx(
              "flex gap-3 p-3 rounded-xl border cursor-pointer transition-colors",
              primary === p.id ? "border-accent/50 bg-accent/[0.06]" : "border-line hover:border-line-strong",
              !p.id && "sm:col-span-2",
            )}
          >
            <input type="radio" name="pipeline" className="mt-1 accent-[var(--accent)]" checked={primary === p.id} onChange={() => setPrimary(p.id)} />
            <span>
              <span className="block text-[13px] text-ink font-medium">{p.label}</span>
              <span className="block text-[12px] text-ink-3">{p.detail}</span>
            </span>
          </label>
        ))}
      </div>

      <div className="mt-5 rounded-xl border border-line p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[13px] font-medium text-ink inline-flex items-center gap-2">
            <Phone size={14} className="text-ink-3" /> Lines that use a different voice AI
          </div>
          <span className="text-[11px] text-ink-3">optional</span>
        </div>
        <p className="text-[12px] text-ink-3 mt-1.5 leading-relaxed">
          Each phone line of the company runs as an &ldquo;agent&rdquo; with its own name, set in the company&apos;s app (for
          example <span className="font-mono text-ink-2">test-agent-ta</span> for a Tamil line). Every line uses the voice AI
          chosen above. To run one line on the other voice AI, add its agent name here.
        </p>
        {rules.length > 0 && (
          <div className="mt-3 space-y-2">
            {rules.map((r, at) => (
              <div key={at} className="flex flex-wrap sm:flex-nowrap items-center gap-2">
                <input
                  aria-label="Agent name"
                  className={cx(inputClass, "font-mono text-[12px]")}
                  value={r.agent}
                  placeholder="Agent name, e.g. sayuru-ai-tamil"
                  onChange={(e) => setRule(at, { agent: e.target.value })}
                  spellCheck={false}
                />
                <span className="text-[12px] text-ink-3 shrink-0">uses</span>
                <select
                  aria-label="Voice AI for this line"
                  className={cx(inputClass, "sm:w-44 shrink-0")}
                  value={r.pipeline}
                  onChange={(e) => setRule(at, { pipeline: e.target.value })}
                >
                  {PIPELINES.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  aria-label="Remove this line"
                  className="p-2 rounded-lg text-ink-3 hover:text-critical hover:bg-critical/10 shrink-0"
                  onClick={() => setRules((rs) => rs.filter((_, n) => n !== at))}
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
        <Button size="sm" className="mt-3" onClick={() => setRules((rs) => [...rs, { agent: "", pipeline: other }])}>
          <Plus size={13} /> Add a line
        </Button>
      </div>

      <div className="mt-4 flex items-start gap-3 p-4 rounded-xl border border-accent/25 bg-accent/[0.05]">
        <Building size={16} className="text-accent mt-0.5 shrink-0" />
        <p className="text-[13px] text-ink-2 leading-relaxed">
          {primary ? (
            <>
              {different.length ? "Lines use " : "Every line uses "}
              <span className="text-ink font-medium">{pipelineLabel(primary)}</span>
            </>
          ) : (
            <>Each line uses what the company&apos;s app is configured for</>
          )}
          {different.length > 0 && (
            <>
              , except{" "}
              {different.map(([agent, pipeline], n) => (
                <span key={agent}>
                  {n > 0 && (n === different.length - 1 ? " and " : ", ")}
                  <span className="font-mono text-ink">{agent}</span> ({pipelineLabel(pipeline)})
                </span>
              ))}
            </>
          )}
          .
        </p>
      </div>

      <div className="flex items-center justify-between gap-3 mt-4">
        <span className="text-[11px] text-ink-3">Running agents switch within 10 minutes. No redeploy is needed.</span>
        <Button variant="primary" disabled={unchanged || busy !== null} onClick={() => update({ action: "pipelines", pipelines: next, agentPipelines: pins }, "Voice pipeline")}>
          {busy && <Spinner size={13} />} Save
        </Button>
      </div>
    </Card>
  );
}

function VoiceCard({ client }: { client: Client }) {
  return (
    <Card title="Voice" subtitle="The voice callers hear. The company can also change this from its own account.">
      <VoiceEditor client={client} technical wide />
    </Card>
  );
}

function TalkTimeCard({ client }: { client: Client }) {
  const { busy, update } = useLicenceUpdate(client);
  return (
    <Card title="Daily talk time" subtitle="The company can also change this from its own account">
      <TalkTimeEditor client={client} busy={busy !== null} onSave={(body) => update({ action: "daily_limit", ...body }, "Daily talk time")} />
    </Card>
  );
}

export function StatusKeyCard({ client }: { client: Client }) {
  const { rotateKey } = useHub();
  const { busy, setBusy, update } = useLicenceUpdate(client);
  return (
    <Card title="Licence status & key">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-panel-2 border border-line">
          <div>
            <div className="text-[13px] text-ink">Licence active</div>
            <div className="text-[11px] text-ink-3">{client.is_active ? "The key works and calls are served" : "Suspended: the key is refused"}</div>
          </div>
          <Switch
            on={client.is_active}
            label="Licence active"
            disabled={busy !== null}
            onChange={(v) => update({ action: "toggle_status", isActive: v }, v ? "Activation" : "Suspension")}
          />
        </div>
        <div className="p-3 rounded-xl bg-panel-2 border border-line">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[13px] text-ink inline-flex items-center gap-1.5">
                <Key size={13} /> Licence key
              </div>
              <div className="font-mono text-[12px] text-ink-2 truncate mt-0.5">{client.token_prefix ?? "chk_live_"}••••••••••••</div>
            </div>
            <Button
              disabled={busy !== null}
              onClick={async () => {
                setBusy("rotate");
                await rotateKey(client);
                setBusy(null);
              }}
            >
              {busy === "rotate" ? <Spinner size={13} /> : <RefreshCw size={13} />} {busy === "rotate" ? "Rotating…" : "Rotate"}
            </Button>
          </div>
          <p className="text-[11px] text-ink-3 mt-2">Stored only as a hash: the full key is shown once, when created or rotated.</p>
        </div>
      </div>
    </Card>
  );
}

export function DangerCard({ client }: { client: Client }) {
  const { setClients, toast, navigate } = useHub();
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    if (!confirm(`Delete ${client.company_name}'s licence?\n\nIts key stops working within a minute. Usage history is kept. This cannot be undone.`)) return;
    setBusy(true);
    try {
      await licenseApi("DELETE", { id: client.id });
      setClients((cs) => cs.filter((c) => c.id !== client.id));
      toast("Licence deleted", "success");
      navigate({ page: "companies" });
    } catch (e) {
      toast(`Could not delete: ${(e as Error).message}`);
      setBusy(false);
    }
  };
  return (
    <section className="rounded-2xl border border-critical/30 bg-critical/[0.04] p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-[14px] font-semibold text-ink inline-flex items-center gap-2">
            <AlertTriangle size={15} className="text-critical" /> Delete licence
          </h3>
          <p className="text-[12px] text-ink-3 mt-1">The key and the company&apos;s sign-in stop working. Usage history is kept.</p>
        </div>
        <Button variant="danger" disabled={busy} onClick={remove}>
          {busy ? <Spinner size={13} /> : <Trash2 size={14} />} Delete
        </Button>
      </div>
    </section>
  );
}

// ── a company account: Talk-time limit and Account ───────────────────────────

function useOwnLicence(): Client | null | undefined {
  const { viewer, clients, clientsLoaded } = useHub();
  if (!clientsLoaded) return undefined;
  return viewer.role === "company" ? (clients.find((c) => c.id === viewer.licenseId) ?? null) : null;
}

export function TalkTimePage() {
  const client = useOwnLicence();
  if (client === undefined) return <SettingsSkeleton />;
  if (!client) return <Empty>Your licence could not be loaded.</Empty>;
  return <TalkTimeSettings key={client.id} client={client} />;
}

function TalkTimeSettings({ client }: { client: Client }) {
  const { busy, update } = useLicenceUpdate(client);
  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
      <Card className="xl:col-span-8" title="Daily talk time per caller" subtitle="Keep calls fair: give each caller a daily allowance">
        <TalkTimeEditor client={client} busy={busy !== null} onSave={(body) => update({ action: "daily_limit", ...body }, "Daily talk time")} />
      </Card>
      <Card className="xl:col-span-4" title="How it works">
        <ul className="space-y-3 text-[13px] text-ink-2">
          {[
            "Each phone number has its own allowance, which resets at midnight (Sri Lanka time).",
            "All of a caller's calls that day count towards it.",
            "Near the end the caller hears a short reminder, then the agent says goodbye and ends the call.",
            "A caller with no time left is asked, politely, to call again tomorrow.",
            "Changes reach your agents within 10 minutes. No restart needed.",
          ].map((t) => (
            <li key={t} className="flex gap-2.5">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
              <span>{t}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

export function AccountPage() {
  const client = useOwnLicence();
  if (client === undefined) return <SettingsSkeleton />;
  if (!client) return <Empty>Your licence could not be loaded.</Empty>;
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
      <Card title="Your licence" subtitle="Managed by Chakra Labs">
        <KeyValue label="Company">{client.company_name}</KeyValue>
        <KeyValue label="Package">{client.package_name || DEFAULT_PACKAGE}</KeyValue>
        <KeyValue label="Status">
          <Badge tone={client.is_active ? "good" : "critical"}>{client.is_active ? "Active" : "Suspended"}</Badge>
        </KeyValue>
        <KeyValue label="Licence key">
          <span className="font-mono text-[12px]">{client.token_prefix ?? "chk_live_"}…</span>
        </KeyValue>
        <KeyValue label="Customer since">{dateOnly(client.created_at)}</KeyValue>
        <p className="text-[11px] text-ink-3 mt-3">To change your package, contact Chakra Labs.</p>
      </Card>
      <PasswordCard />
    </div>
  );
}

export function VoicePage() {
  const client = useOwnLicence();
  if (client === undefined) return <SettingsSkeleton />;
  if (!client) return <Empty>Your licence could not be loaded.</Empty>;
  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
      <Card className="xl:col-span-8" title="Agent voice" subtitle="The voice your callers hear">
        <VoiceEditor key={client.id} client={client} technical={false} />
      </Card>
      <Card className="xl:col-span-4" title="Good to know">
        <ul className="space-y-3 text-[13px] text-ink-2">
          {[
            "A change reaches your phone lines within a few minutes. No restart is needed.",
            "Calls already in progress keep the voice they started with.",
            "You can go back to the standard voice at any time.",
            "To change anything else about how your agent sounds or speaks, contact Chakra Labs.",
          ].map((t) => (
            <li key={t} className="flex gap-2.5">
              <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
              <span>{t}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

export function SettingsSkeleton() {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4" aria-busy="true">
      {[0, 1].map((i) => (
        <div key={i} className="bg-panel border border-line rounded-2xl p-5">
          <LinesSkeleton rows={6} />
        </div>
      ))}
    </div>
  );
}

// ── a company's IVR Console sign-in (admins) ─────────────────────────────────

async function accountApi<T>(method: string, body?: unknown, licenseId?: number): Promise<T> {
  const url = method === "GET" ? `/api/console-users?license=${licenseId}` : "/api/console-users";
  const res = await track(
    fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    }),
  );
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) signedOut();
  if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
  return data as T;
}

/** 16 characters from an alphabet without look-alikes (no 0/O, 1/l/I). */
function generatePassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export function ConsoleAccessCard({ client }: { client: Client }) {
  const { toast, now } = useHub();
  const [account, setAccount] = useState<ConsoleAccount | null | undefined>(undefined);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [shared, setShared] = useState<{ email: string; password: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    accountApi<ConsoleAccount | null>("GET", undefined, client.id)
      .then((a) => {
        if (!live) return;
        setAccount(a);
        setEmail(a?.email ?? "");
      })
      .catch((e) => live && (setAccount(null), toast(`Could not load the sign-in: ${(e as Error).message}`)));
    return () => {
      live = false;
    };
  }, [client.id, toast]);

  const save = async (body: Record<string, unknown>, what: string, reveal?: { email: string; password: string }) => {
    setBusy(what);
    try {
      const a = await accountApi<ConsoleAccount | null>("PUT", { licenseId: client.id, ...body });
      setAccount(a);
      setEmail(a?.email ?? "");
      setPassword("");
      if (reveal) setShared(reveal);
      toast(`${what} saved`, "success");
    } catch (e) {
      toast(`Could not save: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!confirm(`Remove ${client.company_name}'s IVR Console sign-in?\n\nThey are signed out at once and can no longer sign in.`)) return;
    setBusy("remove");
    try {
      await accountApi("DELETE", { licenseId: client.id });
      setAccount(null);
      setEmail("");
      setShared(null);
      toast("Sign-in removed", "success");
    } catch (e) {
      toast(`Could not remove: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD;

  return (
    <Card title="Customer sign-in" subtitle="The company's own IVR Console account: it sees only this licence">
      {account === undefined ? (
        <LinesSkeleton rows={4} />
      ) : (
        <div className="space-y-4">
          {shared && (
            <div className="p-3 rounded-xl border border-warning/40 bg-warning/[0.06]">
              <div className="text-[12px] text-warning font-medium mb-2">Share these with {client.company_name} securely. The password is not shown again.</div>
              <div className="font-mono text-[12px] text-ink break-all select-all bg-canvas border border-line rounded-lg p-2.5">
                Email: {shared.email}
                <br />
                Password: {shared.password}
              </div>
              <div className="flex justify-end gap-2 mt-2">
                <Button
                  size="sm"
                  onClick={() => {
                    navigator.clipboard.writeText(`IVR Console\nEmail: ${shared.email}\nPassword: ${shared.password}`).catch(() => {});
                    toast("Copied", "success");
                  }}
                >
                  <Copy size={13} /> Copy
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShared(null)}>
                  Done
                </Button>
              </div>
            </div>
          )}

          {account && (
            <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-3">
              <Badge tone={account.is_active ? "good" : "critical"}>{account.is_active ? "Can sign in" : "Switched off"}</Badge>
              <span>
                Last sign-in {account.last_login_at ? `${ago(account.last_login_at, now)} · ${dateTime(account.last_login_at)}` : "never"}
              </span>
            </div>
          )}

          <div>
            <label className="block text-[12px] text-ink-2 mb-1.5" htmlFor="account-email">Sign-in email</label>
            <div className="flex gap-2">
              <input
                id="account-email"
                type="email"
                className={inputClass}
                value={email}
                placeholder="name@company.lk"
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="off"
              />
              {account && (
                <Button
                  disabled={!email.trim() || email.trim().toLowerCase() === account.email || busy !== null}
                  onClick={() => save({ email: email.trim() }, "Email")}
                >
                  {busy === "Email" && <Spinner size={13} />} Save
                </Button>
              )}
            </div>
          </div>

          <div>
            <label className="block text-[12px] text-ink-2 mb-1.5" htmlFor="account-password">
              {account ? "Set a new password" : "Password"} <span className="text-ink-3">(at least {MIN_PASSWORD} characters)</span>
            </label>
            <div className="flex gap-2">
              <input
                id="account-password"
                type="text"
                className={cx(inputClass, "font-mono", tooShort && "border-critical")}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                spellCheck={false}
              />
              <Button onClick={() => setPassword(generatePassword())} title="Generate a strong password">
                <RefreshCw size={13} /> Generate
              </Button>
            </div>
            <div className="flex justify-end mt-2">
              <Button
                variant="primary"
                disabled={!password || tooShort || !email.trim() || busy !== null}
                onClick={() =>
                  save(
                    account ? { password } : { email: email.trim(), password },
                    account ? "Password" : "Sign-in",
                    { email: (account?.email ?? email.trim()).toLowerCase(), password },
                  )
                }
              >
                {(busy === "Password" || busy === "Sign-in") && <Spinner size={13} />} {account ? "Set password" : "Create sign-in"}
              </Button>
            </div>
            {account && <p className="text-[11px] text-ink-3 mt-1.5">A new password signs the company out everywhere.</p>}
          </div>

          {account && (
            <>
              <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-panel-2 border border-line">
                <div>
                  <div className="text-[13px] text-ink">Allow sign-in</div>
                  <div className="text-[11px] text-ink-3">{account.is_active ? "The company can sign in" : "Signed out and refused"}</div>
                </div>
                <button
                  role="switch"
                  aria-checked={account.is_active}
                  aria-label="Allow sign-in"
                  disabled={busy !== null}
                  onClick={() => save({ isActive: !account.is_active }, account.is_active ? "Sign-in switched off" : "Sign-in switched on")}
                  className={cx("relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50", account.is_active ? "bg-accent" : "bg-panel-3 border border-line-strong")}
                >
                  <span className={cx("inline-block h-4 w-4 rounded-full bg-white shadow transition-transform", account.is_active ? "translate-x-6" : "translate-x-1")} />
                </button>
              </div>
              <div className="flex justify-end">
                <Button variant="danger" disabled={busy !== null} onClick={remove}>
                  <Trash2 size={14} /> Remove sign-in
                </Button>
              </div>
            </>
          )}

          <p className="text-[11px] text-ink-3">
            With this sign-in the company sees its own dashboard and licence, and can set its daily talk time, its
            agent&apos;s voice and its own password. It cannot change the voice pipeline, package, name, status or key, or
            see other companies or the GPUs.
          </p>
        </div>
      )}
    </Card>
  );
}

function PasswordCard() {
  const { viewer, toast } = useHub();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const mismatch = again.length > 0 && again !== next;
  const tooShort = next.length > 0 && next.length < MIN_PASSWORD;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await track(
        fetch("/api/auth/password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ currentPassword: current, newPassword: next }),
        }),
      );
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) signedOut();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setCurrent("");
      setNext("");
      setAgain("");
      toast("Password changed", "success");
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Your sign-in" subtitle={viewer.email}>
      <form onSubmit={submit} className="space-y-3">
        <input type="email" value={viewer.email} autoComplete="username" readOnly hidden />
        <div>
          <label className="block text-[12px] text-ink-2 mb-1.5" htmlFor="pw-current">Current password</label>
          <input id="pw-current" type="password" className={inputClass} value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label className="block text-[12px] text-ink-2 mb-1.5" htmlFor="pw-new">New password</label>
            <input id="pw-new" type="password" className={cx(inputClass, tooShort && "border-critical")} value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required />
          </div>
          <div>
            <label className="block text-[12px] text-ink-2 mb-1.5" htmlFor="pw-again">New password again</label>
            <input id="pw-again" type="password" className={cx(inputClass, mismatch && "border-critical")} value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" required />
          </div>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] text-ink-3">At least {MIN_PASSWORD} characters. Other sessions are signed out.</span>
          <Button type="submit" variant="primary" disabled={busy || !current || !next || tooShort || mismatch || next !== again}>
            {busy && <Spinner size={13} />} Change password
          </Button>
        </div>
      </form>
    </Card>
  );
}
