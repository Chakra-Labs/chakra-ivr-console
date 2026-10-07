"use client";

import { useMemo, useState } from "react";

import { BarList, ColumnChart, Heatmap } from "./charts";
import { useFleet } from "./fleet-context";
import { useAnalytics, useHub } from "./hub-context";
import { AlertOctagon, AlertTriangle, Building, CheckCircle, ChevronRight, Clock, Server, Zap } from "./icons";
import { Badge, Button, Card, ChartSkeleton, Empty, ErrorBanner, LinesSkeleton, Meter, MiniStat, Ring, Segmented, Skeleton, Stat, cx } from "./ui";
import { gpuPrice } from "@/lib/fleet-health";
import { compact, dayLabel, money, minutes, num, pct, signedPct } from "@/lib/format";
import { DEFAULT_PACKAGE, packageQuota } from "@/lib/packages";
import type { Analytics, LicenseUsage } from "@/lib/types";

const HOURS_PER_MONTH = 730;

function change(now: number, before: number): number | null {
  if (before === 0) return now === 0 ? 0 : null;
  return (now - before) / before;
}

export function monthProgress(a: Analytics | null) {
  if (!a) return { elapsedDays: 0, fraction: 0 };
  const elapsedDays = Math.max(1 / 24, (new Date(a.now).getTime() - new Date(a.month_start).getTime()) / 86_400_000);
  return { elapsedDays, fraction: Math.min(1, elapsedDays / a.days_in_month) };
}

export default function DashboardPage() {
  const { clients, clientsLoaded, packages, navigate } = useHub();
  const fleet = useFleet();
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const { data, error } = useAnalytics(days);
  const waiting = !data && !error;

  const usage = useMemo(() => new Map((data?.licenses ?? []).map((l) => [l.license_id, l])), [data]);
  const sum = (k: keyof LicenseUsage) => (data?.licenses ?? []).reduce((a, l) => a + (Number(l[k]) || 0), 0);
  // Minutes = speech minutes on the Chakra fleet + call minutes of Gemini Live calls.
  const monthMinutes = sum("month_minutes");
  const speechMinutes = sum("month_stt_min") + sum("month_tts_min");
  const liveMinutes = sum("month_live_min");
  const monthCalls = sum("month_calls");
  const monthRequests = sum("month_requests");
  const monthErrors = sum("month_errors");
  // Active = took a call (any pipeline) or used the speech fleet this month.
  const activeCompanies = (data?.licenses ?? []).filter((l) => l.month_calls > 0 || l.month_requests > 0).length;
  const lastActiveCompanies = (data?.licenses ?? []).filter((l) => l.last_mtd_calls > 0 || l.last_mtd_requests > 0).length;
  const { elapsedDays, fraction } = monthProgress(data);

  const healthyGpus = fleet.nodes.filter((n) => fleet.assessments.get(n.id)?.status === "healthy" || fleet.assessments.get(n.id)?.status === "peak").length;
  const downGpus = fleet.alerts.filter((a) => a.assessment.level === "down").length;

  const labels = (data?.daily ?? []).map((d) => dayLabel(d.day));

  const top = clients
    .map((c) => ({ c, u: usage.get(c.id) }))
    .filter((x) => (x.u?.month_minutes ?? 0) > 0)
    .sort((a, b) => (b.u!.month_minutes ?? 0) - (a.u!.month_minutes ?? 0))
    .slice(0, 6);

  const quota = clients
    .filter((c) => c.is_active)
    .map((c) => {
      const used = usage.get(c.id)?.month_minutes ?? c.month_minutes ?? 0;
      const max = packageQuota(packages, c.package_name);
      const projected = fraction > 0 ? used / fraction : used;
      return { c, used, max, ratio: used / max, projectedRatio: projected / max };
    })
    .filter((q) => q.ratio >= 0.75 || (q.projectedRatio >= 1 && q.used > 0))
    .sort((a, b) => b.ratio - a.ratio);

  const recent = [...clients].slice(0, 6);

  // GPU cost: every GPU still in the fleet is billed, draining ones too.
  const gpuRows = fleet.nodes.map((n) => ({ n, ...gpuPrice(n.health?.gpu) }));
  const hourly = gpuRows.reduce((a, r) => a + r.price, 0);
  const costSoFar = hourly * elapsedDays * 24;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
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
          <span className="text-[12px] text-ink-3 hidden sm:inline">Charts use this range · monthly figures are this calendar month (Sri Lanka time)</span>
        </div>
        {data && !data.extended && (
          <span className="text-[12px] text-ink-3">Failed-request counts start once the updated gateway is live.</span>
        )}
      </div>

      <ErrorBanner message={error} />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Stat
          label="Minutes this month"
          loading={waiting}
          value={minutes(monthMinutes)}
          sub={`${minutes(speechMinutes)} Chakra speech · ${minutes(liveMinutes)} Gemini Live`}
          delta={{ ratio: change(monthMinutes, sum("last_mtd_minutes")), label: "vs same days last month" }}
          icon={<Clock size={16} />}
        />
        <Stat
          label="Calls this month"
          loading={waiting}
          value={compact(monthCalls)}
          sub={monthRequests ? `${compact(monthRequests)} speech requests · ${pct(monthErrors / monthRequests, 1)} failed` : "No speech requests yet"}
          delta={{ ratio: change(monthCalls, sum("last_mtd_calls")), label: "vs same days last month" }}
          icon={<Zap size={16} />}
        />
        <Stat
          label="Active companies"
          loading={waiting}
          value={`${activeCompanies}`}
          sub={`${clients.filter((c) => c.is_active).length} active licences · ${clients.length} total`}
          delta={lastActiveCompanies || activeCompanies ? { ratio: change(activeCompanies, lastActiveCompanies), label: "vs last month" } : undefined}
          icon={<Building size={16} />}
        />
        <Stat
          label="GPUs healthy"
          loading={!fleet.loaded}
          value={`${healthyGpus} / ${fleet.nodes.length}`}
          sub={downGpus ? `${downGpus} down — see alerts` : fleet.error ? "Fleet controller unreachable" : "Every GPU responding"}
          icon={<Server size={16} />}
          tone={downGpus ? "critical" : undefined}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <Card className="xl:col-span-8" title="Daily usage" subtitle={`Caller audio (STT) and agent speech (TTS) on the Chakra fleet, and Gemini Live call minutes, last ${days} days`}>
          {!data ? <ChartSkeleton height={240} bars={30} /> : <ColumnChart
            labels={labels}
            tooltipLabels={(data?.daily ?? []).map((d) => d.day)}
            series={[
              { key: "stt", label: "STT", color: "var(--series-1)", values: (data?.daily ?? []).map((d) => d.stt_min) },
              { key: "tts", label: "TTS", color: "var(--series-2)", values: (data?.daily ?? []).map((d) => d.tts_min) },
              { key: "live", label: "Gemini Live", color: "var(--series-3)", values: (data?.daily ?? []).map((d) => d.live_min) },
            ]}
            format={(v) => v.toLocaleString("en-US", { maximumFractionDigits: 1 })}
            unit=" min"
            height={240}
          />}
        </Card>
        <AttentionCard />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card title="Top companies" subtitle="Minutes this month">
          {!data ? <LinesSkeleton rows={5} /> : <BarList
            items={top.map(({ c, u }) => ({
              key: c.id,
              label: c.company_name,
              sub: c.package_name ?? undefined,
              value: u!.month_minutes,
              onClick: () => navigate({ page: "company", id: c.id }),
            }))}
            format={(v) => `${minutes(v)} min`}
            empty="No usage this month yet"
          />}
        </Card>

        <Card title="Quota alerts" subtitle="Above 75% of the package, or on pace to run out this month">
          {!data ? (
            <LinesSkeleton rows={4} />
          ) : quota.length === 0 ? (
            <Empty>Every company is within its monthly minutes.</Empty>
          ) : (
            <div className="space-y-4">
              {quota.slice(0, 6).map((q) => (
                <button key={q.c.id} onClick={() => navigate({ page: "company", id: q.c.id })} className="w-full text-left group">
                  <Meter
                    value={q.used}
                    max={q.max}
                    label={
                      <span className="group-hover:text-accent transition-colors">
                        {q.c.company_name}
                        {q.ratio < 0.75 && <span className="text-warning ml-2 text-[11px]">on pace for {pct(q.projectedRatio)}</span>}
                      </span>
                    }
                    detail={`${minutes(q.used)} / ${compact(q.max)} · ${pct(q.ratio)}`}
                  />
                </button>
              ))}
            </div>
          )}
        </Card>

        <Card
          title="Recent licences"
          subtitle="Newest first · ring = this month's minutes vs package"
          action={<Button size="sm" variant="ghost" onClick={() => navigate({ page: "companies" })}>All <ChevronRight size={13} /></Button>}
        >
          {!clientsLoaded ? (
            <LinesSkeleton rows={5} />
          ) : recent.length === 0 ? (
            <Empty>No licences yet.</Empty>
          ) : (
            <ul className="space-y-1">
              {recent.map((c) => (
                <li key={c.id}>
                  <button onClick={() => navigate({ page: "company", id: c.id })} className="w-full flex items-center gap-3 p-2 -mx-2 rounded-lg hover:bg-white/[0.03] text-left">
                    <Ring value={c.month_minutes} max={packageQuota(packages, c.package_name)} size={38} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] text-ink truncate">{c.company_name}</span>
                      <span className="block text-[11px] text-ink-3">
                        {c.package_name || DEFAULT_PACKAGE} · {minutes(c.month_minutes)} min
                      </span>
                    </span>
                    <Badge tone={c.is_active ? "good" : "critical"}>{c.is_active ? "Active" : "Suspended"}</Badge>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        <Card className="xl:col-span-7" title="Requests & errors" subtitle={`STT and TTS requests per day, last ${days} days`}>
          <RequestsAndErrors data={data} labels={labels} />
        </Card>
        <Card className="xl:col-span-5" title="Busiest hours" subtitle="Minutes by day and hour, last 30 days">
          {!data ? <Skeleton className="h-[230px]" /> : <Heatmap cells={data.heatmap} format={(v) => `${minutes(v)} min`} />}
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <GpusNeededCard />

        <Card title="This month vs last month" subtitle={`First ${Math.floor(elapsedDays) + 1} days of each month`}>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[11px] text-ink-3">
                <th className="pb-2 font-medium" />
                <th className="pb-2 font-medium text-right">This month</th>
                <th className="pb-2 font-medium text-right">Last month</th>
                <th className="pb-2 font-medium text-right">Change</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {[
                { label: "Minutes", now: monthMinutes, before: sum("last_mtd_minutes"), fmt: minutes, upGood: true },
                { label: "Calls", now: monthCalls, before: sum("last_mtd_calls"), fmt: compact, upGood: true },
                { label: "Speech requests", now: monthRequests, before: sum("last_mtd_requests"), fmt: compact, upGood: true },
                { label: "Failed requests", now: monthErrors, before: sum("last_mtd_errors"), fmt: compact, upGood: false },
                { label: "Active companies", now: activeCompanies, before: lastActiveCompanies, fmt: (v: number) => String(v), upGood: true },
              ].map((r) => {
                const ch = change(r.now, r.before);
                const good = ch != null && ((ch > 0 && r.upGood) || (ch < 0 && !r.upGood));
                return (
                  <tr key={r.label} className="border-t border-line">
                    <td className="py-2.5 text-ink-2">{r.label}</td>
                    <td className="py-2.5 text-right text-ink">{r.fmt(r.now)}</td>
                    <td className="py-2.5 text-right text-ink-2">{r.fmt(r.before)}</td>
                    <td className={cx("py-2.5 text-right font-medium", ch == null || Math.abs(ch) < 0.005 ? "text-ink-3" : good ? "text-good" : "text-critical")}>
                      {ch == null ? "new" : signedPct(ch)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="text-[11px] text-ink-3 mt-3">
            All of last month: {minutes(sum("last_month_minutes"))} min · {compact(sum("last_month_requests"))} requests
          </p>
        </Card>

        <Card title="GPU cost estimate" subtitle="Every GPU in the fleet, at Hyperstack hourly prices">
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <div className="text-[11px] text-ink-3 mb-1">Per month</div>
              <div className="text-[24px] font-semibold text-ink leading-none">{money(hourly * HOURS_PER_MONTH)}</div>
              <div className="text-[11px] text-ink-3 mt-1">{money(hourly, 2)} / hour</div>
            </div>
            <div>
              <div className="text-[11px] text-ink-3 mb-1">Per speech minute</div>
              {/* Only Chakra speech runs on the GPUs; Gemini Live minutes do not. */}
              <div className="text-[24px] font-semibold text-ink leading-none">{speechMinutes > 0 ? money(costSoFar / speechMinutes, 3) : "–"}</div>
              <div className="text-[11px] text-ink-3 mt-1">this month so far</div>
            </div>
          </div>
          <ul className="space-y-1.5 text-[12px]">
            {gpuRows.length === 0 && <li className="text-ink-3">No GPUs in the fleet.</li>}
            {gpuRows.map((r) => (
              <li key={r.n.id} className="flex items-center justify-between gap-2">
                <span className="text-ink-2 truncate">
                  {r.n.name} <span className="text-ink-3">· {r.label}{r.known ? "" : " (A4000 price assumed)"}</span>
                </span>
                <span className="text-ink tabular">{money(r.price * HOURS_PER_MONTH)}/mo</span>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-ink-3 mt-3">Assumes each GPU runs the whole month. A drained GPU still costs money until it is removed and deleted.</p>
        </Card>
      </div>
    </div>
  );
}

export function RequestsAndErrors({ data, labels }: { data: Analytics | null; labels: string[] }) {
  if (!data) {
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[54px] rounded-xl" />)}
        </div>
        <ChartSkeleton height={180} bars={30} />
      </div>
    );
  }
  const daily = data.daily;
  const total = daily.reduce((a, d) => a + d.stt_requests + d.tts_requests, 0);
  const errors = daily.reduce((a, d) => a + d.errors, 0);
  const rejected = daily.reduce((a, d) => a + d.rejected, 0);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        <MiniStat label="Requests" value={compact(total)} />
        <MiniStat label="Failed" value={`${compact(errors)} · ${total ? pct(errors / total, 1) : "0%"}`} tone={errors ? "critical" : undefined} />
        <MiniStat label="Refused at line limit" value={compact(rejected)} tone={rejected ? "warning" : undefined} />
      </div>
      <ColumnChart
        labels={labels}
        tooltipLabels={daily.map((d) => d.day)}
        series={[
          { key: "stt", label: "STT requests", color: "var(--series-1)", values: daily.map((d) => d.stt_requests) },
          { key: "tts", label: "TTS requests", color: "var(--series-2)", values: daily.map((d) => d.tts_requests) },
        ]}
        format={(v) => num(v)}
        height={180}
      />
      <div>
        <div className="text-[12px] text-ink-2 mb-2">Failed requests per day</div>
        <ColumnChart
          labels={labels}
          tooltipLabels={daily.map((d) => d.day)}
          series={[{ key: "err", label: "Failed", color: "var(--critical)", values: daily.map((d) => d.errors) }]}
          format={(v) => num(v)}
          height={90}
          table={false}
        />
      </div>
    </div>
  );
}

function AttentionCard() {
  const { alerts, loaded, error } = useFleet();
  const { navigate } = useHub();
  return (
    <Card
      className={cx("xl:col-span-4", alerts.some((a) => a.assessment.level === "down") && "border-critical/40")}
      title="GPUs needing attention"
      subtitle="Down, or at peak load (busy, slow, queueing, or out of memory)"
      action={<Button size="sm" variant="ghost" onClick={() => navigate({ page: "gpus" })}>Details <ChevronRight size={13} /></Button>}
    >
      {!loaded ? (
        <LinesSkeleton rows={3} />
      ) : error && alerts.length === 0 ? (
        <div className="text-[13px] text-warning py-6">Cannot reach the fleet controller: {error}</div>
      ) : alerts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 gap-2 text-[13px] text-ink-2">
          <CheckCircle size={22} className="text-good" />
          All GPUs healthy, none at peak.
        </div>
      ) : (
        <ul className="space-y-2">
          {alerts.map(({ node, assessment }) => (
            <li
              key={node.id}
              onClick={() => navigate({ page: "gpus", node: node.id })}
              className={cx(
                "rounded-xl border p-3 cursor-pointer transition-colors",
                assessment.level === "down" ? "border-critical/40 bg-critical/[0.07] hover:bg-critical/[0.12]" : "border-warning/30 bg-warning/[0.05] hover:bg-warning/[0.1]",
              )}
            >
              <div className="flex items-center gap-2">
                <span className={assessment.level === "down" ? "text-critical" : "text-warning"}>
                  {assessment.level === "down" ? <AlertOctagon size={15} /> : <AlertTriangle size={15} />}
                </span>
                <span className="text-[13px] font-medium text-ink truncate">{node.name}</span>
                <span className="text-[10px] font-mono text-ink-3">{node.role.toUpperCase()}</span>
                <span className={cx("ml-auto text-[11px] font-bold", assessment.level === "down" ? "text-critical" : "text-warning")}>
                  {assessment.level === "down" ? "DOWN" : "AT PEAK"}
                </span>
              </div>
              <p className="text-[12px] text-ink-2 mt-1">{assessment.reasons.join(" · ")}</p>
              {node.state === "draining" && <p className="text-[11px] text-ink-3 mt-0.5">Draining: takes no calls. Remove it in GPU fleet if it is gone for good.</p>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function GpusNeededCard() {
  const { capacity, nodes, loaded } = useFleet();
  return (
    <Card title="GPUs needed vs active" subtitle="From every active licence's package lines">
      {!loaded ? (
        <LinesSkeleton rows={4} />
      ) : !capacity ? (
        <Empty>Fleet controller unreachable.</Empty>
      ) : (
        <div className="space-y-4">
          {(["stt", "tts"] as const).map((role) => {
            const need = capacity.required[role];
            const have = capacity.active[role];
            const short = capacity.missing[role];
            return (
              <div key={role}>
                <div className="flex items-baseline justify-between text-[13px] mb-1.5">
                  <span className="text-ink-2">{role.toUpperCase()} GPUs</span>
                  <span className="tabular">
                    <span className={cx("font-semibold", short ? "text-warning" : "text-ink")}>{have}</span>
                    <span className="text-ink-3"> active / {need} needed</span>
                  </span>
                </div>
                <div className="flex gap-1">
                  {Array.from({ length: Math.max(need, have, 1) }, (_, i) => (
                    <span
                      key={i}
                      className="h-2 flex-1 rounded-full"
                      style={{ background: i < have ? "var(--accent)" : "rgba(250,178,25,0.35)" }}
                    />
                  ))}
                </div>
                {short > 0 && (
                  <p className="text-[11px] text-warning mt-1.5">
                    {short} more to buy{capacity.deploying[role] ? ` (${capacity.deploying[role]} deploying)` : ""}
                  </p>
                )}
              </div>
            );
          })}
          <div className="grid grid-cols-2 gap-3 pt-1">
            <MiniStat label="Lines sold" value={num(capacity.total_lines)} />
            <MiniStat
              label="Lines the fleet carries"
              value={num(capacity.lines_supported)}
              tone={capacity.lines_supported < capacity.total_lines ? "warning" : "good"}
            />
          </div>
          <p className="text-[11px] text-ink-3">
            1 STT GPU ≈ 14 lines · 1 TTS GPU ≈ 7 lines · {nodes.filter((n) => n.state === "draining").length} draining (not counted)
          </p>
        </div>
      )}
    </Card>
  );
}
