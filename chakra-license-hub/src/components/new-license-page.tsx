"use client";

import { useState } from "react";

import { licenseApi, useHub } from "./hub-context";
import { Check, ChevronRight, Copy, Key, Plus } from "./icons";
import { Button, Card, Spinner, cx, inputClass } from "./ui";
import { compact, num } from "@/lib/format";
import { DEFAULT_PACKAGE, gpusFor } from "@/lib/packages";
import type { Client } from "@/lib/types";

export default function NewLicensePage() {
  const { packages, setClients, navigate, toast } = useHub();
  const [companyName, setCompanyName] = useState("");
  const [selected, setSelected] = useState(DEFAULT_PACKAGE);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ client: Client; token: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const create = async () => {
    if (!companyName.trim()) {
      toast("Enter the company name first.");
      return;
    }
    setBusy(true);
    try {
      const { token, ...row } = await licenseApi<Client & { token: string }>("POST", { companyName: companyName.trim(), packageName: selected });
      const client = { ...row, month_minutes: 0, last_activity: null } as Client;
      setClients((cs) => [client, ...cs]);
      setCreated({ client, token });
      setCompanyName("");
    } catch (e) {
      toast(`Could not create the licence: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const pkg = packages.find((p) => p.name === selected);
  const need = gpusFor(pkg?.lines ?? 0);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 max-w-[1100px]">
      <Card className="xl:col-span-7" title="Company and package">
        <div className="space-y-5">
          <div>
            <label htmlFor="new-company" className="block text-[12px] text-ink-2 mb-1.5">Company name</label>
            <input
              id="new-company"
              className={cx(inputClass, "h-10")}
              placeholder="e.g. Govi Mithuru"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create()}
            />
          </div>
          <div>
            <div className="text-[12px] text-ink-2 mb-1.5">Package</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2" role="radiogroup" aria-label="Package">
              {packages.map((p) => (
                <button
                  key={p.id}
                  role="radio"
                  aria-checked={selected === p.name}
                  onClick={() => setSelected(p.name)}
                  className={cx(
                    "text-left px-3 py-2.5 rounded-xl border transition-colors",
                    selected === p.name ? "bg-accent/10 border-accent/50" : "bg-panel-2 border-line hover:border-line-strong",
                  )}
                >
                  <div className={cx("text-[13px] font-medium", selected === p.name ? "text-accent" : "text-ink")}>{p.name}</div>
                  <div className="text-[11px] text-ink-3 tabular">
                    {p.calls ? `${compact(p.calls)} calls · ` : ""}{p.lines} at once
                  </div>
                </button>
              ))}
            </div>
          </div>
          <Button variant="primary" className="w-full h-10" onClick={create} disabled={busy}>
            {busy ? <><Spinner size={15} /> Creating…</> : <><Plus size={15} /> Create licence and key</>}
          </Button>
        </div>
      </Card>

      <div className="xl:col-span-5 space-y-4">
        {created ? (
          <Card title={`Key for ${created.client.company_name}`} className="border-accent/40">
            <div className="font-mono text-[13px] text-ink break-all bg-canvas border border-line rounded-xl p-4 select-all">{created.token}</div>
            <p className="text-[12px] text-warning mt-3">
              Copy it now and send it to the company securely. It is stored only as a hash and cannot be shown again.
            </p>
            <div className="flex gap-2 mt-4">
              <Button
                variant="primary"
                onClick={() => {
                  navigator.clipboard.writeText(created.token).catch(() => {});
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
              >
                {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy key</>}
              </Button>
              <Button onClick={() => navigate({ page: "company", id: created.client.id })}>
                Open company <ChevronRight size={13} />
              </Button>
            </div>
          </Card>
        ) : (
          <Card title="What this package needs">
            <div className="space-y-2 text-[13px]">
              <Row label="Calls included per month" value={pkg?.calls ? num(pkg.calls) : "–"} />
              <Row label="Maximum minutes per month" value={pkg ? num(pkg.maxMinutes) : "–"} />
              <Row label="Concurrent lines" value={pkg ? num(pkg.lines) : "–"} />
              <Row label="STT GPUs" value={num(need.stt)} />
              <Row label="TTS GPUs" value={num(need.tts)} />
            </div>
            <p className="text-[11px] text-ink-3 mt-3 flex gap-1.5">
              <Key size={13} className="shrink-0" /> The fleet adds this licence&apos;s lines to what it must carry. GPU fleet shows if more GPUs are needed.
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-line pb-2 last:border-0">
      <span className="text-ink-2">{label}</span>
      <span className="text-ink tabular">{value}</span>
    </div>
  );
}
