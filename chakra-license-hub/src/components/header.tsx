"use client";

import React, { useEffect, useRef, useState } from "react";

import { useFleet } from "./fleet-context";
import { AlertOctagon, AlertTriangle, Bell, CheckCircle, ChevronRight, LogOut, Menu } from "./icons";
import { useLoading } from "@/lib/loading";
import type { ViewerInfo } from "@/lib/types";
import { cx } from "./ui";

// Kept for when search, the theme switch and Ask AI are built (removed from
// the header on request, 2026-10-03):
// import { Moon, Search, Sparkles } from "./icons";

export function Header({
  title,
  subtitle,
  viewer,
  onLogout,
  onOpenGpu,
  onMenu,
}: {
  title: string;
  subtitle?: React.ReactNode;
  viewer: ViewerInfo;
  onLogout: () => void;
  onOpenGpu: (node?: number) => void;
  onMenu: () => void;
}) {
  const loading = useLoading();
  return (
    <header className="relative h-16 px-4 md:px-8 flex items-center justify-between gap-4 border-b border-line bg-canvas/80 backdrop-blur sticky top-0 z-30">
      {/* Loading bar along the bottom edge while the admin waits on a request. */}
      <div className="absolute left-0 right-0 -bottom-px h-[2px] overflow-hidden pointer-events-none" role="progressbar" aria-hidden={!loading} aria-label="Loading">
        {loading && <div className="progress-bar" />}
      </div>
      <div className="flex items-center gap-3 min-w-0">
        <button onClick={onMenu} className="md:hidden p-2 -ml-2 text-ink-2 hover:text-ink" aria-label="Open menu">
          <Menu size={18} />
        </button>
        <div className="min-w-0">
          <h1 className="text-[17px] font-semibold text-ink truncate leading-tight">{title}</h1>
          {subtitle && <p className="text-[12px] text-ink-3 truncate">{subtitle}</p>}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {/*
        <div className="relative group">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3" size={16} />
          <input type="text" placeholder="Search Anything..." className="pl-10 pr-4 h-9 bg-panel border border-line rounded-full text-[13px] w-[280px]" />
        </div>
        <button className="w-9 h-9 rounded-full bg-panel border border-line flex items-center justify-center text-ink-2">
          <Moon size={16} />
        </button>
        <button className="h-9 px-4 ml-2 rounded-full bg-accent text-accent-ink flex items-center gap-2 font-medium text-[13px]">
          <Sparkles size={14} />
          Ask AI
        </button>
        */}
        {/* GPU alerts are Chakra Labs' own, not a company's. */}
        {viewer.role === "admin" && <NotificationBell onOpenGpu={onOpenGpu} />}
        <div className="hidden sm:flex items-center gap-2.5 pl-3 ml-1 border-l border-line">
          <div className="w-8 h-8 rounded-full bg-panel-3 border border-line-strong flex items-center justify-center text-[12px] font-semibold text-ink-2 uppercase">
            {viewer.role === "company" ? viewer.companyName[0] : viewer.email[0]}
          </div>
          <div className="hidden lg:block leading-tight">
            <div className="text-[12px] font-medium text-ink">{viewer.role === "company" ? viewer.companyName : "Administrator"}</div>
            <div className="text-[11px] text-ink-3">{viewer.email}</div>
          </div>
        </div>
        <button
          onClick={onLogout}
          title="Sign out"
          aria-label="Sign out"
          className="w-9 h-9 rounded-lg flex items-center justify-center text-ink-3 hover:text-critical hover:bg-critical/10 transition-colors"
        >
          <LogOut size={16} />
        </button>
      </div>
    </header>
  );
}

function NotificationBell({ onOpenGpu }: { onOpenGpu: (node?: number) => void }) {
  const { alerts, loaded, error } = useFleet();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const down = alerts.filter((a) => a.assessment.level === "down");
  const peak = alerts.filter((a) => a.assessment.level === "peak");

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const label = down.length
    ? `${down.length} GPU${down.length > 1 ? "s" : ""} down`
    : peak.length
      ? `${peak.length} GPU${peak.length > 1 ? "s" : ""} at peak`
      : "Notifications";

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={label}
        aria-expanded={open}
        title={label}
        className={cx(
          "relative h-9 rounded-lg flex items-center justify-center gap-1.5 transition-colors border whitespace-nowrap shrink-0",
          down.length
            ? "px-3 bg-critical/15 border-critical/50 text-critical hover:bg-critical/25 pulse-critical"
            : peak.length
              ? "px-3 bg-warning/10 border-warning/40 text-warning hover:bg-warning/20"
              : "w-9 border-transparent text-ink-2 hover:text-ink hover:bg-white/[0.05]",
        )}
      >
        <Bell size={16} />
        {down.length > 0 && <span className="text-[12px] font-semibold">{down.length} down</span>}
        {!down.length && peak.length > 0 && <span className="text-[12px] font-semibold">{peak.length}</span>}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-[340px] max-w-[calc(100vw-2rem)] rounded-xl border border-line-strong bg-panel-2 shadow-2xl z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-line flex items-center justify-between">
            <span className="text-[13px] font-semibold text-ink">GPU alerts</span>
            <span className="text-[11px] text-ink-3">checked every 30 s</span>
          </div>
          <div className="max-h-[360px] overflow-y-auto custom-scrollbar">
            {!loaded ? (
              <div className="px-4 py-6 text-[13px] text-ink-3">Checking the GPUs…</div>
            ) : error && !alerts.length ? (
              <div className="px-4 py-6 text-[13px] text-warning">Cannot reach the fleet controller: {error}</div>
            ) : alerts.length === 0 ? (
              <div className="px-4 py-6 text-[13px] text-ink-2 flex items-center gap-2">
                <CheckCircle size={16} className="text-good" /> All GPUs are healthy.
              </div>
            ) : (
              alerts.map(({ node, assessment }) => (
                <button
                  key={node.id}
                  onClick={() => {
                    setOpen(false);
                    onOpenGpu(node.id);
                  }}
                  className={cx(
                    "w-full text-left px-4 py-3 border-b border-line last:border-0 hover:bg-white/[0.03] flex gap-3",
                    assessment.level === "down" && "bg-critical/[0.06]",
                  )}
                >
                  <span className={cx("mt-0.5", assessment.level === "down" ? "text-critical" : "text-warning")}>
                    {assessment.level === "down" ? <AlertOctagon size={16} /> : <AlertTriangle size={16} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-[13px] font-medium text-ink">
                      {node.name}
                      <span className="text-[10px] font-mono text-ink-3">{node.role.toUpperCase()}</span>
                      <span className={cx("text-[11px] font-semibold", assessment.level === "down" ? "text-critical" : "text-warning")}>
                        {assessment.level === "down" ? "DOWN" : "AT PEAK"}
                      </span>
                    </span>
                    <span className="block text-[12px] text-ink-2 mt-0.5">{assessment.reasons.join(" · ")}</span>
                    <span className="block text-[11px] text-ink-3 font-mono mt-0.5">
                      {node.host}
                      {node.state === "draining" && " · draining (not taking calls)"}
                    </span>
                  </span>
                  <ChevronRight size={14} className="text-ink-3 mt-1" />
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
