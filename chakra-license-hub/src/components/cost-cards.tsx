"use client";

import { Card, Empty, MiniStat } from "./ui";
import { minutes, money, num } from "@/lib/format";
import type { Client, CostSummary, LicenseUsage } from "@/lib/types";

// What Chakra Labs pays to serve each company this month (admins only):
//   LLM  — the managed LLM's requests, priced as each one is made: the
//          provider's own figure where it states one, tokens x list price
//          otherwise (see chakra-gpu-fleet fleet/llm.py).
//   GPU  — each hour's GPU rent, split by the companies' share of that hour's
//          speech seconds. Hours nobody used are "idle", owed by no company.
// Gemini Live calls run on the company's own Google key and cost us nothing here.

const llm = (u: LicenseUsage) => u.month_llm_usd ?? 0;
const gpu = (u: LicenseUsage) => u.month_gpu_usd ?? 0;

const HOW = "LLM: what the provider charged for this company's requests. GPU: each hour's rent, split by share of that hour's speech.";

export function CompanyCostCard({ usage, cost }: { usage: LicenseUsage; cost: CostSummary | null | undefined }) {
  if (!cost) return null;
  const total = llm(usage) + gpu(usage);
  return (
    <Card title="Cost to serve" subtitle="What this company's calls cost Chakra Labs this month (USD)">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <MiniStat label="Total" value={money(total, 2)} />
        <MiniStat label="LLM" value={money(llm(usage), 2)} />
        <MiniStat label="GPU share" value={money(gpu(usage), 2)} />
        <MiniStat label="Per call" value={usage.month_calls ? money(total / usage.month_calls, 3) : "–"} />
        <MiniStat label="Per call minute" value={usage.month_call_min ? money(total / usage.month_call_min, 3) : "–"} />
      </div>
      <p className="text-[11px] text-ink-3 mt-3">
        {HOW} Gemini Live calls use the company&apos;s own Google key and are not included.
        {!cost.gpu_hourly_usd && " No GPU has an hourly price set yet, so the GPU share is zero."}
      </p>
    </Card>
  );
}

export function CostTable({
  clients,
  licenses,
  cost,
  onOpen,
}: {
  clients: Client[];
  licenses: LicenseUsage[];
  cost: CostSummary | null | undefined;
  onOpen: (id: number) => void;
}) {
  if (!cost) return null;
  const names = new Map(clients.map((c) => [c.id, c.company_name]));
  const rows = licenses
    .filter((u) => llm(u) + gpu(u) > 0)
    .sort((a, b) => llm(b) + gpu(b) - (llm(a) + gpu(a)));
  const spent = cost.llm_usd + cost.gpu_rent_usd;
  return (
    <Card title="Cost per company" subtitle="What each company's calls cost Chakra Labs this month (USD)">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <MiniStat label="Spent this month" value={money(spent, 2)} />
        <MiniStat label="LLM" value={money(cost.llm_usd, 2)} />
        <MiniStat label="GPU rent so far" value={money(cost.gpu_rent_usd, 2)} />
        <MiniStat label="GPU rent nobody used" value={money(cost.gpu_idle_usd, 2)} tone={cost.gpu_rent_usd > 0 && cost.gpu_idle_usd / cost.gpu_rent_usd > 0.9 ? "warning" : undefined} />
      </div>
      {rows.length === 0 ? (
        <Empty>No company has cost anything this month yet.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[11px] text-ink-3">
                <th className="pb-2 font-medium">Company</th>
                <th className="pb-2 font-medium text-right">Calls</th>
                <th className="pb-2 font-medium text-right">Call minutes</th>
                <th className="pb-2 font-medium text-right">LLM</th>
                <th className="pb-2 font-medium text-right">GPU share</th>
                <th className="pb-2 font-medium text-right">Total</th>
                <th className="pb-2 font-medium text-right">Per call minute</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {rows.map((u) => {
                const total = llm(u) + gpu(u);
                return (
                  <tr key={u.license_id} className="border-t border-line hover:bg-panel-2 cursor-pointer" onClick={() => onOpen(u.license_id)}>
                    <td className="py-2 text-ink truncate">{names.get(u.license_id) ?? `Licence #${u.license_id}`}</td>
                    <td className="py-2 text-right text-ink-2">{num(u.month_calls)}</td>
                    <td className="py-2 text-right text-ink-2">{minutes(u.month_call_min)}</td>
                    <td className="py-2 text-right text-ink-2">{money(llm(u), 2)}</td>
                    <td className="py-2 text-right text-ink-2">{money(gpu(u), 2)}</td>
                    <td className="py-2 text-right text-ink font-medium">{money(total, 2)}</td>
                    <td className="py-2 text-right text-ink-2">{u.month_call_min ? money(total / u.month_call_min, 3) : "–"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-ink-3 mt-3">
        {HOW} GPUs are rented by the hour whether or not a call is on them: {money(cost.gpu_hourly_usd, 2)} an hour for the fleet now.
        {cost.llm_usd > 0 && ` ${Math.round((cost.llm_reported_usd / cost.llm_usd) * 100)}% of the LLM figure is the provider's own; the rest is tokens at list price.`}
        {cost.balance && ` ${cost.balance.provider} balance: ${money(cost.balance.usd, 2)}.`}
      </p>
    </Card>
  );
}
