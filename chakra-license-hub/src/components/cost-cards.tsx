"use client";

import { Card, Empty, MiniStat } from "./ui";
import { compact, minutes, money, num, pct } from "@/lib/format";
import { usesChakraVoice } from "@/lib/pipelines";
import type { Client, CostSummary, LicenseUsage } from "@/lib/types";

// What the managed LLM has cost Chakra Labs for each company this month
// (admins only). The gateway prices every request as it is made: the provider's
// own figure where its reply states one (Hyperstack), tokens x list price
// otherwise (Gemini) — see chakra-gpu-fleet fleet/llm.py. Gemini Live calls run
// on the company's own Google key and never reach the gateway.

const usd = (u: LicenseUsage) => u.month_llm_usd ?? 0;
const tokensIn = (u: LicenseUsage) => u.month_llm_in ?? 0;
const cachedShare = (u: LicenseUsage) => (tokensIn(u) > 0 ? (u.month_llm_cached ?? 0) / tokensIn(u) : null);

const HOW = "Priced as each request is made: the provider's own figure where it gives one, otherwise tokens at the model's rates (cached input at the cached rate).";

export function CompanyCostCard({ usage, cost }: { usage: LicenseUsage; cost: CostSummary | null | undefined }) {
  if (!cost) return null;
  const total = usd(usage);
  const share = cachedShare(usage);
  return (
    <Card title="LLM cost" subtitle="What this company's calls have cost in LLM usage this month (USD)">
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        <MiniStat label="Cost" value={money(total, 2)} />
        <MiniStat label="Model" value={usage.month_llm_model || "–"} />
        <MiniStat label="Per call" value={usage.month_calls ? money(total / usage.month_calls, 4) : "–"} />
        <MiniStat label="Per call minute" value={usage.month_call_min ? money(total / usage.month_call_min, 4) : "–"} />
        <MiniStat label="Requests" value={num(usage.month_llm_requests ?? 0)} />
        <MiniStat label="Input tokens" value={compact(tokensIn(usage))} />
        <MiniStat label="Output tokens" value={compact(usage.month_llm_out ?? 0)} />
      </div>
      <p className="text-[11px] text-ink-3 mt-3">
        {HOW}
        {share != null && ` ${pct(share)} of the input came from the prompt cache.`} Gemini Live calls use the company&apos;s own Google key and are not included.
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
  const onChakra = new Set(clients.filter(usesChakraVoice).map((c) => c.id));
  // Companies on Chakra Voice, plus any other that has run up a cost this month
  // (one moved to Gemini Live part-way through): money spent is never hidden.
  const rows = licenses
    .filter((u) => (u.month_llm_requests ?? 0) > 0 && (onChakra.has(u.license_id) || usd(u) > 0))
    .sort((a, b) => usd(b) - usd(a));
  const requests = rows.reduce((a, u) => a + (u.month_llm_requests ?? 0), 0);
  const input = rows.reduce((a, u) => a + tokensIn(u), 0);
  const cached = rows.reduce((a, u) => a + (u.month_llm_cached ?? 0), 0);
  return (
    <Card title="LLM cost per company" subtitle="What each company's calls have cost in LLM usage this month (USD)">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <MiniStat label="LLM cost this month" value={money(cost.llm_usd, 2)} />
        <MiniStat label="Requests" value={num(requests)} />
        <MiniStat label="Input from the prompt cache" value={input > 0 ? pct(cached / input) : "–"} />
        <MiniStat label={cost.balance ? `${cost.balance.provider} balance` : "Provider balance"} value={cost.balance ? money(cost.balance.usd, 2) : "–"} />
      </div>
      {rows.length === 0 ? (
        <Empty>No company on Chakra Voice has used the LLM this month.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[11px] text-ink-3">
                <th className="pb-2 font-medium">Company</th>
                <th className="pb-2 font-medium">Model</th>
                <th className="pb-2 font-medium text-right">Calls</th>
                <th className="pb-2 font-medium text-right">Call minutes</th>
                <th className="pb-2 font-medium text-right">Requests</th>
                <th className="pb-2 font-medium text-right">Input tokens</th>
                <th className="pb-2 font-medium text-right">Cached</th>
                <th className="pb-2 font-medium text-right">Output tokens</th>
                <th className="pb-2 font-medium text-right">Cost</th>
                <th className="pb-2 font-medium text-right">Per call minute</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {rows.map((u) => {
                const share = cachedShare(u);
                return (
                  <tr key={u.license_id} className="border-t border-line hover:bg-panel-2 cursor-pointer" onClick={() => onOpen(u.license_id)}>
                    <td className="py-2 text-ink truncate">{names.get(u.license_id) ?? `Licence #${u.license_id}`}</td>
                    <td className="py-2 text-ink-2 truncate">{u.month_llm_model || "–"}</td>
                    <td className="py-2 text-right text-ink-2">{num(u.month_calls)}</td>
                    <td className="py-2 text-right text-ink-2">{minutes(u.month_call_min)}</td>
                    <td className="py-2 text-right text-ink-2">{num(u.month_llm_requests ?? 0)}</td>
                    <td className="py-2 text-right text-ink-2">{compact(tokensIn(u))}</td>
                    <td className="py-2 text-right text-ink-2">{share == null ? "–" : pct(share)}</td>
                    <td className="py-2 text-right text-ink-2">{compact(u.month_llm_out ?? 0)}</td>
                    <td className="py-2 text-right text-ink font-medium">{money(usd(u), 2)}</td>
                    <td className="py-2 text-right text-ink-2">{u.month_call_min ? money(usd(u) / u.month_call_min, 4) : "–"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-ink-3 mt-3">
        {HOW}
        {cost.llm_usd > 0 && ` ${pct(cost.llm_reported_usd / cost.llm_usd)} of this month's figure is the provider's own.`}
        {cost.unpriced_requests > 0 && ` ${num(cost.unpriced_requests)} request${cost.unpriced_requests === 1 ? " was" : "s were"} made before cost was recorded, or on a model with no price set, and count as zero.`}
        {" "}Only companies on Chakra Voice are listed; Gemini Live runs on the company's own Google key.
      </p>
    </Card>
  );
}
