"use client";

// Manage licences (Customers section). Admins pick a company and manage its
// licence and its IVR Console sign-in; a company account manages what it may:
// its daily talk time and its own password. The server enforces the same split
// (api/licenses, api/console-users, api/auth/password).
import { useEffect, useState } from "react";

import { licenseApi, signedOut, useHub } from "./hub-context";
import { Building, Copy, Key, RefreshCw, Trash2 } from "./icons";
import { Badge, Button, Card, Empty, KeyValue, LinesSkeleton, Spinner, cx, inputClass } from "./ui";
import { MIN_PASSWORD } from "@/lib/account-rules";
import { MAX_LIMIT_MINUTES, MAX_WARNING_SECONDS, formatAgentLimits, parseAgentLimits, wholeNumber } from "@/lib/daily-limit";
import { ago, compact, dateOnly, dateTime } from "@/lib/format";
import { track } from "@/lib/loading";
import { findPackage } from "@/lib/packages";
import { PIPELINES, formatAgentPins, parseAgentPins, pipelineLabel } from "@/lib/pipelines";
import type { Client, ConsoleAccount } from "@/lib/types";

function PipelineSettings({
  client,
  busy,
  onSave,
}: {
  client: Client;
  busy: string | null;
  onSave: (body: { pipelines: string[]; agentPipelines: Record<string, string> }) => void;
}) {
  const current = client.pipelines ?? [];
  const [primary, setPrimary] = useState<string>(current[0] ?? "");
  const [alsoOther, setAlsoOther] = useState(current.length > 1);
  const [pins, setPins] = useState(formatAgentPins(client.agent_pipelines));
  const other = PIPELINES.find((p) => p.id !== primary);
  const next = primary ? [primary, ...(alsoOther && other ? [other.id] : [])] : [];
  const nextPins = parseAgentPins(pins);
  const unchanged =
    JSON.stringify(next) === JSON.stringify(current) &&
    JSON.stringify(nextPins) === JSON.stringify(client.agent_pipelines ?? {});

  return (
    <div>
      <label className="block text-[12px] text-ink-2 mb-1.5" htmlFor="company-pipeline">Voice pipeline</label>
      <div className="flex gap-2">
        <select id="company-pipeline" className={inputClass} value={primary} onChange={(e) => setPrimary(e.target.value)}>
          <option value="">Not assigned (the client&apos;s config decides)</option>
          {PIPELINES.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label} · {p.detail}
            </option>
          ))}
        </select>
        <Button disabled={unchanged || busy !== null} onClick={() => onSave({ pipelines: next, agentPipelines: nextPins })}>
          {busy === "Pipeline" && <Spinner size={13} />} Save
        </Button>
      </div>
      {primary && other && (
        <label className="mt-2 flex items-center gap-2 text-[12px] text-ink-2">
          <input type="checkbox" checked={alsoOther} onChange={(e) => setAlsoOther(e.target.checked)} />
          Also allow {other.label} (for agents pinned to it, or the client choosing it)
        </label>
      )}
      <label className="block text-[12px] text-ink-2 mt-3 mb-1.5" htmlFor="company-agent-pins">
        Agents pinned to a pipeline <span className="text-ink-3">(optional, one per line: agent = chakra | gemini_live)</span>
      </label>
      <textarea
        id="company-agent-pins"
        className={cx(inputClass, "font-mono text-[12px] min-h-[64px]")}
        value={pins}
        placeholder="sayury-ai = chakra"
        onChange={(e) => setPins(e.target.value)}
      />
      <p className="text-[11px] text-ink-3 mt-1.5">
        Read from the signed licence check: takes effect when the client&apos;s agents next start (running agents within 10 minutes).
        A pin always wins; otherwise the client&apos;s own setting is used only if allowed here, else the default.
      </p>
    </div>
  );
}

export function DailyLimitSettings({
  client,
  busy,
  onSave,
}: {
  client: Client;
  busy: string | null;
  onSave: (body: { dailyLimitMinutes: number; limitWarningSeconds: number; agentDailyLimits: Record<string, number> }) => void;
}) {
  const [minutes, setMinutes] = useState(String(client.daily_limit_minutes ?? 0));
  const [warning, setWarning] = useState(String(client.limit_warning_seconds ?? 60));
  const [agents, setAgents] = useState(formatAgentLimits(client.agent_daily_limits));
  const nextMinutes = wholeNumber(minutes, MAX_LIMIT_MINUTES);
  const nextWarning = wholeNumber(warning, MAX_WARNING_SECONDS);
  const nextAgents = parseAgentLimits(agents);
  const valid = nextMinutes !== null && nextWarning !== null;
  const unchanged =
    nextMinutes === (client.daily_limit_minutes ?? 0) &&
    nextWarning === (client.limit_warning_seconds ?? 60) &&
    JSON.stringify(nextAgents) === JSON.stringify(client.agent_daily_limits ?? {});

  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[12px] text-ink-2 mb-1.5" htmlFor="company-daily-limit">
            Daily talk time per caller <span className="text-ink-3">(minutes, 0 = no limit)</span>
          </label>
          <input
            id="company-daily-limit"
            className={cx(inputClass, nextMinutes === null && "border-critical")}
            inputMode="numeric"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-[12px] text-ink-2 mb-1.5" htmlFor="company-limit-warning">
            Warn before the end <span className="text-ink-3">(seconds, 0 = no warning)</span>
          </label>
          <input
            id="company-limit-warning"
            className={cx(inputClass, nextWarning === null && "border-critical")}
            inputMode="numeric"
            value={warning}
            onChange={(e) => setWarning(e.target.value)}
          />
        </div>
      </div>
      <label className="block text-[12px] text-ink-2 mt-3 mb-1.5" htmlFor="company-agent-limits">
        Agents with their own limit <span className="text-ink-3">(optional, one per line: agent = minutes; 0 = no limit)</span>
      </label>
      <div className="flex gap-2 items-start">
        <textarea
          id="company-agent-limits"
          className={cx(inputClass, "font-mono text-[12px] min-h-[64px]")}
          value={agents}
          placeholder="sayuru-ai-tamil = 10"
          onChange={(e) => setAgents(e.target.value)}
        />
        <Button
          disabled={!valid || unchanged || busy !== null}
          onClick={() => {
            if (nextMinutes !== null && nextWarning !== null) {
              onSave({ dailyLimitMinutes: nextMinutes, limitWarningSeconds: nextWarning, agentDailyLimits: nextAgents });
            }
          }}
        >
          {busy === "Daily limit" && <Spinner size={13} />} Save
        </Button>
      </div>
      <p className="text-[11px] text-ink-3 mt-1.5">
        Minutes each phone number may talk per day (Sri Lanka time), counted from the client&apos;s own call records. A caller
        who is out of time is told to call back tomorrow; a call is warned, then ended, when the time runs out. Needs
        chakra-ivr-core 0.5+; applies within 10 minutes.
      </p>
    </div>
  );
}

function ManageLicense({ client }: { client: Client }) {
  const { packages, setClients, toast, rotateKey, navigate } = useHub();
  const [name, setName] = useState(client.company_name);
  const [pkg, setPkg] = useState(findPackage(packages, client.package_name)?.name ?? client.package_name ?? "Essential");
  const [busy, setBusy] = useState<string | null>(null);

  const update = async (body: Record<string, unknown>, what: string) => {
    setBusy(what);
    try {
      const row = await licenseApi<Partial<Client>>("PUT", { id: client.id, ...body });
      setClients((cs) => cs.map((c) => (c.id === client.id ? { ...c, ...row, month_minutes: c.month_minutes, last_activity: c.last_activity } : c)));
      toast(`${what} saved`, "success");
    } catch (e) {
      toast(`Could not save: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!confirm(`Delete ${client.company_name}'s licence?\n\nIts key stops working within a minute. Usage history is kept. This cannot be undone.`)) return;
    setBusy("delete");
    try {
      await licenseApi("DELETE", { id: client.id });
      setClients((cs) => cs.filter((c) => c.id !== client.id));
      toast("Licence deleted", "success");
      navigate({ page: "companies" });
    } catch (e) {
      toast(`Could not delete: ${(e as Error).message}`);
      setBusy(null);
    }
  };

  return (
    <Card title="Manage licence">
      <div className="space-y-4">
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
              {packages.map((p) => (
                <option key={p.id} value={p.name}>
                  {p.name} · {compact(p.maxMinutes)} min · {p.lines} lines
                </option>
              ))}
            </select>
            <Button
              disabled={pkg === client.package_name || busy !== null}
              onClick={() => update({ action: "package", packageName: pkg }, "Package")}
            >
              {busy === "Package" && <Spinner size={13} />} Save
            </Button>
          </div>
          <p className="text-[11px] text-ink-3 mt-1.5">The GPU fleet re-sizes from packages, so check GPU fleet after an upgrade.</p>
        </div>

        <PipelineSettings client={client} busy={busy} onSave={(body) => update({ action: "pipelines", ...body }, "Pipeline")} />
        <DailyLimitSettings client={client} busy={busy} onSave={(body) => update({ action: "daily_limit", ...body }, "Daily limit")} />

        <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-panel-2 border border-line">
          <div>
            <div className="text-[13px] text-ink">Licence status</div>
            <div className="text-[11px] text-ink-3">{client.is_active ? "Active: the key works" : "Suspended: the key is refused"}</div>
          </div>
          <button
            role="switch"
            aria-checked={client.is_active}
            aria-label="Licence active"
            disabled={busy !== null}
            onClick={() => update({ action: "toggle_status", isActive: !client.is_active }, client.is_active ? "Suspension" : "Activation")}
            className={cx("relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50", client.is_active ? "bg-accent" : "bg-panel-3 border border-line-strong")}
          >
            <span className={cx("inline-block h-4 w-4 rounded-full bg-white shadow transition-transform", client.is_active ? "translate-x-6" : "translate-x-1")} />
          </button>
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
              {busy === "rotate" ? <Spinner size={13} /> : <RefreshCw size={13} />} {busy === "rotate" ? "Rotating…" : "Rotate key"}
            </Button>
          </div>
          <p className="text-[11px] text-ink-3 mt-2">
            Keys are stored only as a hash, so the full key is shown once, when it is created or rotated.
          </p>
        </div>

        <div className="pt-1 flex justify-end">
          <Button variant="danger" disabled={busy !== null} onClick={remove}>
            <Trash2 size={14} /> Delete licence
          </Button>
        </div>
      </div>
    </Card>
  );
}


// ── the Manage licences tab ───────────────────────────────────────────────────

export default function ManagePage({ id }: { id?: number }) {
  const { viewer, clients, clientsLoaded, navigate } = useHub();

  if (!clientsLoaded) {
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

  if (viewer.role === "company") {
    const own = clients.find((c) => c.id === viewer.licenseId);
    return own ? <CompanyManage client={own} /> : <Empty>Your licence could not be loaded.</Empty>;
  }

  if (clients.length === 0) return <Empty>No companies yet. Create a licence to add one.</Empty>;
  const client = clients.find((c) => c.id === id) ?? clients[0];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-[12px] text-ink-2" htmlFor="manage-company">Company</label>
        <div className="w-full sm:w-80">
          <select
            id="manage-company"
            className={inputClass}
            value={client.id}
            onChange={(e) => navigate({ page: "manage", id: Number(e.target.value) })}
          >
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.company_name}
                {c.is_active ? "" : " (suspended)"}
              </option>
            ))}
          </select>
        </div>
        <Button variant="ghost" size="sm" onClick={() => navigate({ page: "company", id: client.id })}>
          <Building size={14} /> Open company page
        </Button>
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
        <ManageLicense key={`licence-${client.id}`} client={client} />
        <ConsoleAccessCard key={`access-${client.id}`} client={client} />
      </div>
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

function ConsoleAccessCard({ client }: { client: Client }) {
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
    <Card title="IVR Console sign-in" subtitle="The company's own account: it sees only this licence">
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
            With this sign-in the company sees its own dashboard and licence, and can set its daily talk time and its own
            password. It cannot change the voice pipeline, package, name, status or key, or see other companies or the GPUs.
          </p>
        </div>
      )}
    </Card>
  );
}

// ── what a company account manages ───────────────────────────────────────────

function CompanyManage({ client }: { client: Client }) {
  const { setClients, toast } = useHub();
  const [busy, setBusy] = useState<string | null>(null);

  const saveLimit = async (body: Record<string, unknown>) => {
    setBusy("Daily limit");
    try {
      const row = await licenseApi<Partial<Client>>("PUT", { id: client.id, action: "daily_limit", ...body });
      setClients((cs) => cs.map((c) => (c.id === client.id ? { ...c, ...row, month_minutes: c.month_minutes, last_activity: c.last_activity } : c)));
      toast("Daily talk time saved", "success");
    } catch (e) {
      toast(`Could not save: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
      <Card title="Daily talk time" subtitle="How long each caller may talk per day">
        <DailyLimitSettings key={client.id} client={client} busy={busy} onSave={saveLimit} />
      </Card>
      <div className="space-y-4">
        <Card title="Your licence" subtitle="Set by Chakra Labs">
          <KeyValue label="Company">{client.company_name}</KeyValue>
          <KeyValue label="Package">{client.package_name || "Essential"}</KeyValue>
          <KeyValue label="Voice pipeline">
            {client.pipelines?.length
              ? client.pipelines.map((p, i) => (i === 0 ? pipelineLabel(p) : `+ ${pipelineLabel(p)}`)).join(" ")
              : "Set by your configuration"}
          </KeyValue>
          <KeyValue label="Status">{client.is_active ? "Active" : "Suspended"}</KeyValue>
          <KeyValue label="Licence key">
            <span className="font-mono text-[12px]">{client.token_prefix ?? "chk_live_"}…</span>
          </KeyValue>
          <KeyValue label="Customer since">{dateOnly(client.created_at)}</KeyValue>
          <p className="text-[11px] text-ink-3 mt-3">To change the package or the voice pipeline, contact Chakra Labs.</p>
        </Card>
        <PasswordCard />
      </div>
    </div>
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
