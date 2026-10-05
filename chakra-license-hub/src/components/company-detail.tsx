"use client";

import { useState } from "react";

import { ColumnChart, Heatmap } from "./charts";
import { RequestsAndErrors, monthProgress } from "./dashboard-page";
import { useFleet } from "./fleet-context";
import { useAnalytics, useHub } from "./hub-context";
import { AlertTriangle, ArrowLeft, Building, Calendar, Clock, Gauge, Settings, Zap } from "./icons";
import { Badge, Button, Card, ChartSkeleton, Empty, ErrorBanner, KeyValue, LinesSkeleton, Meter, MiniStat, Segmented, Skeleton, Stat, cx } from "./ui";
import { ago, compact, dateOnly, dateTime, dayLabel, minutes, num, pct, signedPct } from "@/lib/format";
import { INFLIGHT_PER_LINE, gpusFor, packageLines, packageQuota } from "@/lib/packages";
import { describeLimit } from "@/lib/daily-limit";
import { pipelineLabel } from "@/lib/pipelines";
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

/** One company's page. `companyView`: the company's own dashboard (a company
 * account), without the admin's navigation and Chakra Labs' GPU figures. */
export default function CompanyDetail({ id, companyView = false }: { id: number; companyView?: boolean }) {
  const { clients, clientsLoaded, packages, navigate, now } = useHub();
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const { data, error } = useAnalytics(days, id);
  const client = clients.find((c) => c.id === id);

  if (!clientsLoaded) return <CompanySkeleton />;
  if (!client) {
    return (
      <div className="space-y-4">
        {!companyView && <BackLink onClick={() => navigate({ page: "companies" })} />}
        <Empty>{companyView ? "Your licence could not be loaded." : "This company no longer exists."}</Empty>
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
      {!companyView && <BackLink onClick={() => navigate({ page: "companies" })} />}

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
        {companyView ? (
          <Button onClick={() => navigate({ page: "limits" })}>
            <Clock size={14} /> Talk-time limit
          </Button>
        ) : (
          <Button onClick={() => navigate({ page: "manage", id: client.id })}>
            <Settings size={14} /> Licence settings
          </Button>
        )}
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
            {/* The reminder time is on the talk-time page; this line stays short. */}
            {describeLimit(client.daily_limit_minutes, null)}
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
        <Card className={companyView ? "xl:col-span-12" : "xl:col-span-7"} title="Requests & errors" subtitle={`Last ${days} days`}>
          <RequestsAndErrors data={data} labels={labels} />
        </Card>
        {!companyView && (
          <div className="xl:col-span-5 space-y-4">
            <CapacityCard client={client} lines={lines} usage={u} />
          </div>
        )}
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
