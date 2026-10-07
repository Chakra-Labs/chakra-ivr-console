"use client";

import { useEffect, useState } from "react";

import { useHub } from "./hub-context";
import { Box, Edit2, Plus, Trash2, X } from "./icons";
import { Button, Empty, inputClass } from "./ui";
import { num } from "@/lib/format";
import { gpusFor, type Package } from "@/lib/packages";

// Package edits here last until the page reloads: the list is defined in
// src/lib/packages.ts and must match chakra-gpu-fleet/fleet/packages.yaml.
export default function PackagesPage() {
  const { packages, setPackages, clients } = useHub();
  // The dialog: a new package ("new"), one being edited, or closed (null).
  const [dialog, setDialog] = useState<Package | "new" | null>(null);

  const save = (p: Package) => {
    setPackages((ps) => (ps.some((x) => x.id === p.id) ? ps.map((x) => (x.id === p.id ? p : x)) : [...ps, p]));
    setDialog(null);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12px] text-ink-3">
          {packages.length} packages · a company&apos;s package sets its calls, minutes and how many calls it can take at once.
        </p>
        <Button variant="primary" onClick={() => setDialog("new")}>
          <Plus size={15} /> New package
        </Button>
      </div>

      {packages.length === 0 ? (
        <Empty>No packages.</Empty>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
          {packages.map((p) => {
            const need = gpusFor(p.lines);
            const users = clients.filter((c) => c.package_name === p.name).length;
            return (
              <article key={p.id} className="group bg-panel border border-line rounded-2xl p-5 flex flex-col hover:border-line-strong transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div className="w-10 h-10 rounded-xl bg-panel-3 border border-line flex items-center justify-center text-ink-2 shrink-0">
                    <Box size={17} />
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                    <button onClick={() => setDialog(p)} className="p-1.5 rounded-md text-ink-3 hover:text-accent hover:bg-accent/10" aria-label={`Edit ${p.name}`}>
                      <Edit2 size={14} />
                    </button>
                    <button
                      onClick={() => setPackages((ps) => ps.filter((x) => x.id !== p.id))}
                      className="p-1.5 rounded-md text-ink-3 hover:text-critical hover:bg-critical/10"
                      aria-label={`Delete ${p.name}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <h3 className="mt-4 text-[16px] font-semibold text-ink">{p.name}</h3>
                <div className="text-[10px] uppercase tracking-wide text-accent mt-0.5 h-[14px]">{p.special ? "Special offer" : ""}</div>
                <div className="mt-2 text-[20px] font-semibold text-ink tabular">
                  {p.priceLkr ? (
                    <>
                      <span className="text-[12px] text-ink-3 font-normal">LKR </span>
                      {num(p.priceLkr)}
                      <span className="text-[12px] text-ink-3 font-normal"> / month</span>
                    </>
                  ) : (
                    <span className="text-[13px] text-ink-3 font-normal">No price set</span>
                  )}
                </div>
                <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                  {[
                    { label: "Calls", value: p.calls ? num(p.calls) : "–" },
                    { label: "Minutes", value: num(p.maxMinutes) },
                    { label: "At once", value: num(p.lines) },
                  ].map((f) => (
                    <div key={f.label} className="rounded-xl bg-panel-2 border border-line px-2 py-2.5 min-w-0">
                      <dt className="text-[11px] text-ink-3">{f.label}</dt>
                      <dd className="text-[13px] font-semibold text-ink tabular truncate mt-0.5">{f.value}</dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-4 pt-3 border-t border-line flex items-center justify-between text-[11px] text-ink-3 tabular">
                  <span>
                    {need.stt} STT + {need.tts} TTS GPUs
                  </span>
                  <span>
                    {users} compan{users === 1 ? "y" : "ies"}
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {dialog && <PackageDialog initial={dialog === "new" ? null : dialog} onSave={save} onClose={() => setDialog(null)} />}
    </div>
  );
}

function PackageDialog({ initial, onSave, onClose }: { initial: Package | null; onSave: (p: Package) => void; onClose: () => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [calls, setCalls] = useState(initial?.calls ? String(initial.calls) : "");
  const [max, setMax] = useState(initial ? String(initial.maxMinutes) : "");
  const [lines, setLines] = useState(initial ? String(initial.lines) : "");
  const [price, setPrice] = useState(initial?.priceLkr ? String(initial.priceLkr) : "");
  const valid = name.trim() !== "" && Number(max) > 0 && Number(lines) > 0;
  const need = gpusFor(Number(lines) > 0 ? Number(lines) : 0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    onSave({
      ...initial,
      id: initial?.id ?? Math.random().toString(36).slice(2, 11),
      name: name.trim(),
      maxMinutes: Number(max),
      lines: Number(lines),
      calls: Number(calls) > 0 ? Number(calls) : undefined,
      priceLkr: Number(price) > 0 ? Number(price) : undefined,
    });
  };

  const field = (id: string, label: string, value: string, set: (v: string) => void, placeholder: string) => (
    <div>
      <label className="block text-[12px] text-ink-2 mb-1.5" htmlFor={id}>
        {label}
      </label>
      <input id={id} className={`${inputClass} tabular`} type="number" min={0} value={value} placeholder={placeholder} onChange={(e) => set(e.target.value)} />
    </div>
  );

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[90] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={initial ? `Edit ${initial.name}` : "New package"}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <form onSubmit={submit} className="w-full max-w-lg bg-panel-2 border border-line-strong rounded-2xl p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h2 className="text-[16px] font-semibold text-ink">{initial ? `Edit ${initial.name}` : "New package"}</h2>
            <p className="text-[12px] text-ink-3 mt-1">
              Lasts until the page reloads. Permanent packages live in the code and the fleet&apos;s packages.yaml.
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-ink-3 hover:text-ink" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-[12px] text-ink-2 mb-1.5" htmlFor="pkg-name">
              Name
            </label>
            <input id="pkg-name" className={inputClass} value={name} placeholder="e.g. Premium" onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {field("pkg-calls", "Calls included per month", calls, setCalls, "e.g. 25000")}
            {field("pkg-minutes", "Maximum minutes per month", max, setMax, "e.g. 125000")}
            {field("pkg-lines", "Calls at once", lines, setLines, "e.g. 14")}
            {field("pkg-price", "Price per month (LKR)", price, setPrice, "e.g. 694000")}
          </div>
          <p className="text-[12px] text-ink-3">
            {Number(lines) > 0 ? `${lines} calls at once needs ${need.stt} STT and ${need.tts} TTS GPUs.` : "The GPUs it needs follow from calls at once."}
          </p>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!valid}>
            {initial ? "Save package" : "Add package"}
          </Button>
        </div>
      </form>
    </div>
  );
}
