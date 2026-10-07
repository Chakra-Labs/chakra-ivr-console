"use client";

import { useState } from "react";

import { useHub } from "./hub-context";
import { Box, Edit2, Trash2 } from "./icons";
import { Button, Card, Empty, inputClass } from "./ui";
import { num } from "@/lib/format";
import { gpusFor, type Package } from "@/lib/packages";

// Package edits here last until the page reloads: the list is defined in
// src/lib/packages.ts and must match chakra-gpu-fleet/fleet/packages.yaml.
export default function PackagesPage() {
  const { packages, setPackages, clients } = useHub();
  const [form, setForm] = useState({ name: "", max: "", lines: "" });
  const [editing, setEditing] = useState<Package | null>(null);

  const add = () => {
    if (!form.name.trim() || !form.max) return;
    setPackages((ps) => [
      ...ps,
      { id: Math.random().toString(36).slice(2, 11), name: form.name.trim(), maxMinutes: Number(form.max), lines: Number(form.lines) || 7 },
    ]);
    setForm({ name: "", max: "", lines: "" });
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
      <Card className="xl:col-span-4" title="Add a package" subtitle="Changes here last until the page reloads; permanent packages live in the code and the fleet's packages.yaml.">
        <div className="space-y-3">
          <input className={inputClass} placeholder="Name, e.g. Premium" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-label="Package name" />
          <input className={inputClass} type="number" placeholder="Monthly minutes, e.g. 50000" value={form.max} onChange={(e) => setForm({ ...form, max: e.target.value })} aria-label="Monthly minutes" />
          <input className={inputClass} type="number" placeholder="Calls at once, e.g. 28" value={form.lines} onChange={(e) => setForm({ ...form, lines: e.target.value })} aria-label="Concurrent lines" />
          <Button variant="primary" className="w-full" onClick={add}>Add package</Button>
        </div>
      </Card>

      <Card className="xl:col-span-8" title="Packages">
        {packages.length === 0 ? (
          <Empty>No packages.</Empty>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {packages.map((p) => {
              const need = gpusFor(p.lines);
              const users = clients.filter((c) => c.package_name === p.name).length;
              return editing?.id === p.id ? (
                <div key={p.id} className="p-4 rounded-xl bg-panel-2 border border-accent/40 space-y-2">
                  <input className={inputClass} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} aria-label="Name" />
                  <input className={inputClass} type="number" value={editing.maxMinutes} onChange={(e) => setEditing({ ...editing, maxMinutes: Number(e.target.value) })} aria-label="Monthly minutes" />
                  <input className={inputClass} type="number" value={editing.lines} onChange={(e) => setEditing({ ...editing, lines: Number(e.target.value) })} aria-label="Lines" />
                  <div className="flex gap-2">
                    <Button size="sm" variant="primary" onClick={() => { setPackages((ps) => ps.map((x) => (x.id === p.id ? editing : x))); setEditing(null); }}>Save</Button>
                    <Button size="sm" onClick={() => setEditing(null)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <div key={p.id} className="group p-4 rounded-xl bg-panel-2 border border-line hover:border-line-strong transition-colors">
                  <div className="flex items-start justify-between">
                    <div className="w-9 h-9 rounded-lg bg-panel-3 border border-line flex items-center justify-center text-ink-2"><Box size={16} /></div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                      <button onClick={() => setEditing(p)} className="p-1.5 rounded-md text-ink-3 hover:text-accent hover:bg-accent/10" aria-label={`Edit ${p.name}`}><Edit2 size={13} /></button>
                      <button onClick={() => setPackages((ps) => ps.filter((x) => x.id !== p.id))} className="p-1.5 rounded-md text-ink-3 hover:text-critical hover:bg-critical/10" aria-label={`Delete ${p.name}`}><Trash2 size={13} /></button>
                    </div>
                  </div>
                  <div className="mt-3 text-[15px] font-semibold text-ink">{p.name}</div>
                  {p.special && <div className="text-[10px] uppercase tracking-wide text-accent mt-0.5">Special offer</div>}
                  <div className="text-[12px] text-ink-2 tabular mt-1">
                    {p.calls ? `Up to ${num(p.calls)} calls · ` : ""}{num(p.maxMinutes)} min / month
                  </div>
                  {p.priceLkr ? <div className="text-[13px] text-ink font-medium tabular mt-1.5">LKR {num(p.priceLkr)} <span className="text-[11px] text-ink-3 font-normal">/ month</span></div> : null}
                  <div className="text-[11px] text-ink-3 tabular mt-2">
                    {p.lines} calls at once · {need.stt} STT + {need.tts} TTS GPUs · {users} compan{users === 1 ? "y" : "ies"}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
