"use client";

import { useState } from "react";

import { ColumnChart, Heatmap } from "./charts";
import { RequestsAndErrors, monthProgress } from "./dashboard-page";
import { useFleet } from "./fleet-context";
import { licenseApi, useAnalytics, useHub } from "./hub-context";
import { AlertTriangle, ArrowLeft, Building, Calendar, Clock, Gauge, Key, RefreshCw, Trash2, Zap } from "./icons";
import { Badge, Button, Card, ChartSkeleton, Empty, ErrorBanner, KeyValue, LinesSkeleton, Meter, MiniStat, Segmented, Skeleton, Stat, Spinner, cx, inputClass } from "./ui";
import { ago, compact, dateOnly, dateTime, dayLabel, minutes, num, pct, signedPct } from "@/lib/format";
import { INFLIGHT_PER_LINE, findPackage, gpusFor, packageLines, packageQuota } from "@/lib/packages";
import { MAX_LIMIT_MINUTES, MAX_WARNING_SECONDS, describeLimit, formatAgentLimits, parseAgentLimits, wholeNumber } from "@/lib/daily-limit";
import { PIPELINES, formatAgentPins, parseAgentPins, pipelineLabel } from "@/lib/pipelines";
import type { Client, LicenseUsage } from "@/lib/types";

const EMPTY_USAGE: LicenseUsage = {
  license_id: 0, month_minutes: 0, month_stt_min: 0, month_tts_min: 0, month_live_min: 0, month_calls: 0,
  last_mtd_calls: 0, month_requests: 0, month_errors: 0,
  month_rejected: 0, month_peak_inflight: 0, last_mtd_minutes: 0, last_mtd_requests: 0, last_mtd_errors: 0,
  last_month_minutes: 0, last_month_requests: 0, last_activity: null,
};

function change(now: number, before: number): number | null {
  if (before === 0) return now === 0 ? 0 : null;
  return (now - before) / before;
}

export default function CompanyDetail({ id }: { id: number }) {
  const { clients, clientsLoaded, packages, navigate, now } = useHub();
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const { data, error } = useAnalytics(days, id);
  const client = clients.find((c) => c.id === id);

  if (!clientsLoaded) return <CompanySkeleton />;
  if (!client) {
    return (
      <div className="space-y-4">
        <BackLink onClick={() => navigate({ page: "companies" })} />
        <Empty>This company no longer exists.</Empty>
      </div>
    );
  }

  const u = data?.licenses.find((l) => l.license_id === id) ?? { ...EMPTY_USAGE, license_id: id };
  const quota = packageQuota(packages, client.package_name);
  const lines = packageLines(packages, client.package_name);
  const { elapsedDays, fraction } = monthProgress(data);
  const monthEnd = data ? new Date(new Date(data.month_start).getTime() + data.days_in_month * 86_400_000) : null;
  const daysLeft = monthEnd ? Math.max(0, Math.ceil((monthEnd.getTime() - new Date(data!.now).getTime()) / 86_400_000)) : null;
  const errorRate = u.month_requests ? u.month_errors / u.month_requests : 0;
  const daily = data?.daily ?? [];
  const labels = daily.map((d) => dayLabel(d.day));
  const waiting = !data && !error;

  return (
    <div className="space-y-5">
      <BackLink onClick={() => navigate({ page: "companies" })} />

      {/* Shares its view-transition-name with this company's card on the
          Companies page, so opening a card grows it into this header. */}
      <section
        className="bg-panel border border-line rounded-2xl p-5 flex flex-wrap items-center gap-4"
        style={{ viewTransitionName: `company-${client.id}` }}
      >
        <div className="w-12 h-12 rounded-xl bg-panel-3 border border-line flex items-center justify-center text-accent shrink-0">
          <Building size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-[20px] font-semibold text-ink truncate">{client.company_name}</h2>
          <div className="flex flex-wrap items-center gap-2 mt-1.5">
            <Badge tone="accent">{client.package_name || "Essential"}</Badge>
            <Badge tone={client.is_active ? "good" : "critical"}>{client.is_active ? "Active" : "Suspended"}</Badge>
            <span className="text-[12px] text-ink-3 font-mono">{client.token_prefix ?? "chk_live_"}…</span>
          </div>
        </div>
        <div className="w-full sm:w-64">
          <Meter
            value={u.month_minutes}
            max={quota}
            label="This month"
            detail={data ? `${minutes(u.month_minutes)} / ${compact(quota)} min` : "…"}
          />
        </div>
      </section>

      <ErrorBanner message={error} />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Stat
          label="Minutes this month"
          loading={waiting}
          value={minutes(u.month_minutes)}
          sub={`${pct(u.month_minutes / quota)} of ${compact(quota)} min`}
          icon={<Clock size={16} />}
          tone={u.month_minutes / quota >= 0.9 ? "critical" : u.month_minutes / quota >= 0.75 ? "warning" : undefined}
        />
        <Stat
          label="Calls this month"
          loading={waiting}
          value={compact(u.month_calls)}
          sub={`${compact(u.month_requests)} speech requests`}
          delta={{ ratio: change(u.month_calls, u.last_mtd_calls), label: "vs same days last month" }}
          icon={<Zap size={16} />}
        />
        <Stat
          label="Error rate this month"
          loading={waiting}
          value={pct(errorRate, 1)}
          sub={`${num(u.month_errors)} failed · ${num(u.month_rejected)} refused at line limit`}
          icon={<AlertTriangle size={16} />}
          tone={errorRate >= 0.05 && u.month_requests >= 20 ? "critical" : undefined}
        />
        <Stat
          label="Usage resets in"
          loading={waiting}
          value={daysLeft == null ? "–" : `${daysLeft} day${daysLeft === 1 ? "" : "s"}`}
          sub={monthEnd ? `on ${dateOnly(monthEnd.toISOString())}` : undefined}
          icon={<Calendar size={16} />}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card title="Overview & package">
          <KeyValue label="Package">{client.package_name || "Essential"}</KeyValue>
          <KeyValue label="Monthly minutes">{num(quota)} min</KeyValue>
          <KeyValue label="Concurrent lines">{num(lines)}</KeyValue>
          <KeyValue label="Voice pipeline">
            {client.pipelines?.length
              ? client.pipelines.map((p, i) => (i === 0 ? pipelineLabel(p) : `+ ${pipelineLabel(p)}`)).join(" ")
              : "Not assigned (client config)"}
          </KeyValue>
          <KeyValue label="Daily talk time">
            {describeLimit(client.daily_limit_minutes, client.limit_warning_seconds)}
            {Object.keys(client.agent_daily_limits ?? {}).length > 0 && " · some agents differ"}
          </KeyValue>
          <KeyValue label="Status">{client.is_active ? "Active" : "Suspended"}</KeyValue>
          <KeyValue label="Licence key">
            <span className="font-mono text-[12px]">{client.token_prefix ?? "chk_live_"}…</span>
          </KeyValue>
          <KeyValue label="Customer since">{dateOnly(client.created_at)}</KeyValue>
          <KeyValue label="Last activity">
            {u.last_activity ? `${ago(u.last_activity, now)} · ${dateTime(u.last_activity)}` : "never"}
          </KeyValue>
        </Card>

        <QuotaForecast used={u.month_minutes} quota={quota} elapsedDays={elapsedDays} fraction={fraction} monthEnd={monthEnd} nowIso={data?.now} />

        <Card title="This month vs last month" subtitle={`First ${Math.floor(elapsedDays) + 1} days of each month`}>
          <div className="space-y-3">
            {[
              { label: "Minutes", now: u.month_minutes, before: u.last_mtd_minutes, fmt: minutes, upGood: true },
              { label: "Calls", now: u.month_calls, before: u.last_mtd_calls, fmt: compact, upGood: true },
              { label: "Speech requests", now: u.month_requests, before: u.last_mtd_requests, fmt: compact, upGood: true },
              { label: "Failed requests", now: u.month_errors, before: u.last_mtd_errors, fmt: compact, upGood: false },
            ].map((r) => {
              const ch = change(r.now, r.before);
              const good = ch != null && ((ch > 0 && r.upGood) || (ch < 0 && !r.upGood));
              return (
                <div key={r.label} className="flex items-baseline justify-between gap-3 text-[13px] border-b border-line pb-2.5 last:border-0">
                  <span className="text-ink-2">{r.label}</span>
                  <span className="tabular text-right">
                    <span className="text-ink font-medium">{r.fmt(r.now)}</span>
                    <span className="text-ink-3"> vs {r.fmt(r.before)}</span>
                    <span className={cx("ml-2 font-medium", ch == null || ch === 0 ? "text-ink-3" : good ? "text-good" : "text-critical")}>
                      {ch == null ? "new" : signedPct(ch)}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-ink-3 mt-3">
            All of last month: {minutes(u.last_month_minutes)} min · {compact(u.last_month_requests)} requests
          </p>
        </Card>
      </div>

      <div className="flex items-center gap-3">
        <Segmented
          label="Chart range"
          value={days}
          onChange={setDays}
          options={[
            { value: 7, label: "7 days" },
            { value: 30, label: "30 days" },
            { value: 90, label: "90 days" },
          ]}
        />
        <span className="text-[12px] text-ink-3">for the charts below</span>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <Card
          className="xl:col-span-7"
          title="Usage"
          subtitle={`STT ${minutes(u.month_stt_min)} min · TTS ${minutes(u.month_tts_min)} min · Gemini Live ${minutes(u.month_live_min)} min this month`}
        >
          {!data ? (
            <ChartSkeleton height={230} bars={30} />
          ) : (
            <ColumnChart
              labels={labels}
              tooltipLabels={daily.map((d) => d.day)}
              series={[
                { key: "stt", label: "STT", color: "var(--series-1)", values: daily.map((d) => d.stt_min) },
                { key: "tts", label: "TTS", color: "var(--series-2)", values: daily.map((d) => d.tts_min) },
                { key: "live", label: "Gemini Live", color: "var(--series-3)", values: daily.map((d) => d.live_min) },
              ]}
              unit=" min"
              height={230}
            />
          )}
        </Card>
        <Card className="xl:col-span-5" title="Busiest hours" subtitle="When this company's callers use the line (last 30 days)">
          {!data ? <Skeleton className="h-[230px]" /> : <Heatmap cells={data.heatmap} format={(v) => `${minutes(v)} min`} />}
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <Card className="xl:col-span-7" title="Requests & errors" subtitle={`Last ${days} days`}>
          <RequestsAndErrors data={data} labels={labels} />
        </Card>
        <div className="xl:col-span-5 space-y-4">
          <CapacityCard client={client} lines={lines} usage={u} />
          <ManageLicense key={client.id} client={client} />
        </div>
      </div>
    </div>
  );
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick} className="-ml-2">
      <ArrowLeft size={14} /> All companies
    </Button>
  );
}

function QuotaForecast({
  used,
  quota,
  elapsedDays,
  fraction,
  monthEnd,
  nowIso,
}: {
  used: number;
  quota: number;
  elapsedDays: number;
  fraction: number;
  monthEnd: Date | null;
  nowIso?: string;
}) {
  const pace = elapsedDays > 0 ? used / elapsedDays : 0;
  const projected = fraction > 0 ? used / fraction : used;
  const nowMs = nowIso ? new Date(nowIso).getTime() : null;
  const hitAt = pace > 0 && used < quota && nowMs != null ? new Date(nowMs + ((quota - used) / pace) * 86_400_000) : null;
  const runsOut = hitAt && monthEnd && hitAt < monthEnd;
  const over = used >= quota;

  return (
    <Card title="Quota forecast" subtitle="At this month's pace so far" className={cx(over ? "border-critical/40" : runsOut ? "border-warning/40" : undefined)}>
      <Meter value={used} max={quota} label="Used" detail={`${minutes(used)} / ${compact(quota)} min`} height={8} />
      <div className="grid grid-cols-2 gap-3 mt-4">
        <MiniStat label="Pace" value={`${minutes(pace)} min/day`} />
        <MiniStat label="Projected for the month" value={`${minutes(projected)} min`} tone={projected > quota ? "warning" : undefined} />
      </div>
      <div className="mt-4 text-[13px] flex items-start gap-2">
        <Gauge size={16} className={over ? "text-critical" : runsOut ? "text-warning" : "text-good"} />
        <span className="text-ink-2">
          {over ? (
            <span className="text-critical font-medium">The monthly minutes are used up.</span>
          ) : used === 0 ? (
            "No usage this month yet."
          ) : runsOut ? (
            <>
              <span className="text-warning font-medium">Runs out on {dateOnly(hitAt!.toISOString())}</span>, before the month ends. Consider a bigger package.
            </>
          ) : (
            <>Within the package: about {pct(projected / quota)} of the minutes by month end.</>
          )}
        </span>
      </div>
    </Card>
  );
}

function CapacityCard({ client, lines, usage }: { client: Client; lines: number; usage: LicenseUsage }) {
  const { capacity } = useFleet();
  const need = gpusFor(lines);
  const limit = lines * INFLIGHT_PER_LINE;
  const share = capacity && capacity.total_lines ? lines / capacity.total_lines : null;
  return (
    <Card title="GPU capacity used" subtitle={`${client.package_name || "Essential"}: ${num(lines)} concurrent lines`}>
      <div className="grid grid-cols-3 gap-3">
        <MiniStat label="STT GPUs needed" value={num(need.stt)} />
        <MiniStat label="TTS GPUs needed" value={num(need.tts)} />
        <MiniStat label="Share of lines sold" value={share == null ? "–" : pct(share)} />
      </div>
      <div className="mt-4">
        <Meter
          value={usage.month_peak_inflight}
          max={limit}
          label="Most requests at once (this month)"
          detail={`${num(usage.month_peak_inflight)} of ${num(limit)} allowed`}
        />
      </div>
      <p className="text-[11px] text-ink-3 mt-3">
        The gateway allows {INFLIGHT_PER_LINE} requests in flight per line (one STT + one TTS per live call).
        {usage.month_rejected > 0 && <span className="text-warning"> {num(usage.month_rejected)} request{usage.month_rejected === 1 ? " was" : "s were"} refused at the limit this month.</span>}
      </p>
    </Card>
  );
}

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

function DailyLimitSettings({
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

function CompanySkeleton() {
  return (
    <div className="space-y-5" aria-busy="true">
      <Skeleton className="h-7 w-32" />
      <Skeleton className="h-[88px] rounded-2xl" />
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[112px] rounded-2xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="bg-panel border border-line rounded-2xl p-5">
            <LinesSkeleton rows={5} />
          </div>
        ))}
      </div>
      <div className="bg-panel border border-line rounded-2xl p-5">
        <ChartSkeleton height={230} bars={30} />
      </div>
    </div>
  );
}
