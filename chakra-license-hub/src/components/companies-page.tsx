"use client";

import { useState } from "react";

import { useHub } from "./hub-context";
import { Building, ChevronRight, Clock, Mic, Plus, Search } from "./icons";
import { Badge, Button, Empty, Meter, MiniStat, Segmented, Skeleton, inputClass } from "./ui";
import { ago, compact, dateOnly, minutes, num, pct } from "@/lib/format";
import { DEFAULT_PACKAGE, findPackage, packageLines, packageQuota } from "@/lib/packages";
import { pipelineLabel } from "@/lib/pipelines";
import type { Client } from "@/lib/types";

/** "Chakra Voice", or "Chakra Voice +1 line" when a line runs another pipeline. */
function voiceAi(c: Client): string {
  const main = c.pipelines?.[0];
  const others = Object.values(c.agent_pipelines ?? {}).filter((p) => p !== main).length;
  return `${pipelineLabel(main)}${others ? ` +${others} line${others === 1 ? "" : "s"}` : ""}`;
}

/** The voice callers hear, in a few words. */
function voiceSummary(c: Client): string {
  const parts: string[] = [];
  if (c.voice_modes?.includes("clone")) parts.push(c.has_custom_voice ? "Custom voice" : "Standard voice");
  if (c.voice_modes?.includes("preset")) parts.push(c.gemini_voice ?? "App default");
  return parts.join(" · ") || "Standard voice";
}

export default function CompaniesPage() {
  const { clients, clientsLoaded, packages, navigate, now } = useHub();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "suspended">("all");

  const shown = clients.filter(
    (c) =>
      (status === "all" || (status === "active" ? c.is_active : !c.is_active)) &&
      (!query.trim() || c.company_name.toLowerCase().includes(query.trim().toLowerCase())),
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a company"
              aria-label="Find a company"
              className={`${inputClass} pl-9 w-64`}
            />
          </div>
          <Segmented
            label="Status"
            value={status}
            onChange={setStatus}
            options={[
              { value: "all", label: `All ${clients.length}` },
              { value: "active", label: "Active" },
              { value: "suspended", label: "Suspended" },
            ]}
          />
        </div>
        <Button variant="primary" onClick={() => navigate({ page: "new" })}>
          <Plus size={15} /> New licence
        </Button>
      </div>

      {!clientsLoaded ? (
        <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <CompanyCardSkeleton key={i} />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <Empty>{clients.length ? "No company matches." : "No companies yet. Create a licence to add one."}</Empty>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4">
          {shown.map((c) => {
            const quota = packageQuota(packages, c.package_name);
            const included = findPackage(packages, c.package_name)?.calls;
            return (
              <article
                key={c.id}
                className="group bg-panel border border-line rounded-2xl p-5 flex flex-col gap-4 hover:border-line-strong hover:-translate-y-0.5 transition-[border-color,transform] duration-200 cursor-pointer"
                // Shared with the company page's header card: the browser morphs one into the other.
                style={{ viewTransitionName: `company-${c.id}` }}
                onClick={() => navigate({ page: "company", id: c.id })}
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-panel-3 border border-line flex items-center justify-center shrink-0 text-ink-2">
                    <Building size={17} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-[15px] font-semibold text-ink truncate group-hover:text-accent transition-colors">{c.company_name}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge tone="accent">{c.package_name || DEFAULT_PACKAGE}</Badge>
                      <Badge tone={c.is_active ? "good" : "critical"}>{c.is_active ? "Active" : "Suspended"}</Badge>
                    </div>
                  </div>
                  <ChevronRight size={16} className="text-ink-3 mt-1 group-hover:text-ink transition-colors" />
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <MiniStat label="Calls this month" value={included ? `${compact(c.month_calls ?? 0)} / ${compact(included)}` : num(c.month_calls ?? 0)} />
                  <MiniStat label="Calls at once" value={packageLines(packages, c.package_name)} />
                  <MiniStat label="Voice AI" value={<span className="text-[13px]">{voiceAi(c)}</span>} />
                </div>

                <Meter
                  value={c.month_minutes}
                  max={quota}
                  label="Minutes this month"
                  detail={`${minutes(c.month_minutes)} / ${compact(quota)} min · ${pct(c.month_minutes / quota)}`}
                />

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-2">
                  <span className="inline-flex items-center gap-1.5">
                    <Mic size={12} className="text-ink-3" /> {voiceSummary(c)}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Clock size={12} className="text-ink-3" />
                    {c.daily_limit_minutes ? `${c.daily_limit_minutes} min per caller a day` : "No daily talk-time limit"}
                  </span>
                </div>

                <div className="flex items-center justify-between text-[11px] text-ink-3 pt-1 border-t border-line">
                  <span className="pt-3">Last activity {ago(c.last_activity, now)}</span>
                  <span className="pt-3">Since {dateOnly(c.created_at)}</span>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CompanyCardSkeleton() {
  return (
    <div className="bg-panel border border-line rounded-2xl p-5 space-y-4" aria-hidden="true">
      <div className="flex items-center gap-3">
        <Skeleton className="w-10 h-10 rounded-xl" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3.5 w-1/2" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </div>
      <Skeleton className="h-[62px] rounded-xl" />
      <div className="space-y-2">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-1.5 w-full" />
      </div>
      <Skeleton className="h-3 w-2/3" />
    </div>
  );
}
