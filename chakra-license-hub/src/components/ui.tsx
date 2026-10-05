"use client";

// Building blocks every page uses, so cards, tiles, badges and buttons look the
// same everywhere. Colours come from the tokens in globals.css.
import React, { useEffect, useState } from "react";

import { AlertOctagon, AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle } from "./icons";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

export function Card({
  title,
  subtitle,
  action,
  children,
  className,
  padded = true,
}: {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section className={cx("bg-panel border border-line rounded-2xl min-w-0", padded && "p-5", className)}>
      {(title || action) && (
        <header className={cx("flex items-start justify-between gap-4", padded ? "mb-4" : "px-5 pt-5 mb-4")}>
          <div className="min-w-0">
            {title && <h3 className="text-[14px] font-semibold text-ink leading-tight">{title}</h3>}
            {subtitle && <p className="text-[12px] text-ink-3 mt-1">{subtitle}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  sub,
  delta,
  deltaGoodWhenUp = true,
  icon,
  tone,
  loading = false,
}: {
  label: string;
  loading?: boolean;
  value: React.ReactNode;
  sub?: React.ReactNode;
  /** Signed ratio vs a named period, e.g. 0.12 = +12%. */
  delta?: { ratio: number | null; label: string };
  deltaGoodWhenUp?: boolean;
  icon?: React.ReactNode;
  tone?: "critical" | "warning";
}) {
  // Under half a percent shows as 0%: neutral, not an arrow and a colour.
  const up = delta?.ratio != null && delta.ratio >= 0.005;
  const down = delta?.ratio != null && delta.ratio <= -0.005;
  const good = (up && deltaGoodWhenUp) || (down && !deltaGoodWhenUp);
  return (
    <div
      className={cx(
        "bg-panel border rounded-2xl p-5 min-w-0",
        tone === "critical" ? "border-critical/40" : tone === "warning" ? "border-warning/30" : "border-line",
      )}
    >
      <div className="flex items-center justify-between gap-3 mb-3">
        <span className="text-[12px] font-medium text-ink-2">{label}</span>
        {icon && <span className="text-ink-3">{icon}</span>}
      </div>
      {loading ? (
        <Skeleton className="h-7 w-28" />
      ) : (
        <div className="text-[28px] font-semibold tracking-tight text-ink leading-none">{value}</div>
      )}
      <div className="flex items-center gap-2 mt-2.5 text-[12px] min-h-[18px]">
        {loading && <Skeleton className="h-3 w-36" />}
        {!loading && delta && delta.ratio != null && Number.isFinite(delta.ratio) && (
          <span className={cx("inline-flex items-center gap-0.5 font-medium", up || down ? (good ? "text-good" : "text-critical") : "text-ink-3")}>
            {up ? <ArrowUpRight size={13} /> : down ? <ArrowDownRight size={13} /> : null}
            {`${up ? "+" : ""}${up || down ? Math.round(delta.ratio * 100) : 0}%`}
          </span>
        )}
        {!loading && delta && <span className="text-ink-3">{delta.label}</span>}
        {!loading && !delta && sub && <span className="text-ink-3 truncate">{sub}</span>}
      </div>
    </div>
  );
}

type Tone = "good" | "warning" | "serious" | "critical" | "neutral" | "info" | "accent";

const TONE: Record<Tone, string> = {
  good: "text-good bg-good/10 border-good/25",
  warning: "text-warning bg-warning/10 border-warning/25",
  serious: "text-serious bg-serious/10 border-serious/25",
  critical: "text-critical bg-critical/10 border-critical/30",
  neutral: "text-ink-2 bg-white/[0.04] border-line-strong",
  info: "text-series-1 bg-series-1/10 border-series-1/25",
  accent: "text-accent bg-accent/10 border-accent/25",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-medium whitespace-nowrap", TONE[tone], className)}>
      {children}
    </span>
  );
}

/** A status always carries an icon and a word, never colour alone. */
export function StatusPill({ status }: { status: "healthy" | "down" | "peak" | "draining" | "pending" | "failed" | "unknown" }) {
  const map = {
    healthy: { tone: "good" as Tone, icon: <CheckCircle size={12} />, label: "Healthy" },
    down: { tone: "critical" as Tone, icon: <AlertOctagon size={12} />, label: "Down" },
    peak: { tone: "warning" as Tone, icon: <AlertTriangle size={12} />, label: "At peak" },
    draining: { tone: "info" as Tone, icon: null, label: "Draining" },
    pending: { tone: "warning" as Tone, icon: null, label: "Deploying" },
    failed: { tone: "critical" as Tone, icon: <AlertOctagon size={12} />, label: "Failed" },
    unknown: { tone: "neutral" as Tone, icon: null, label: "No data" },
  }[status];
  return (
    <Badge tone={map.tone}>
      {map.icon}
      {map.label}
    </Badge>
  );
}

export function Button({
  variant = "secondary",
  size = "md",
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md" }) {
  return (
    <button
      {...rest}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent whitespace-nowrap",
        size === "sm" ? "h-7 px-2.5 text-[12px]" : "h-9 px-3.5 text-[13px]",
        variant === "primary" && "bg-accent text-accent-ink hover:bg-accent/85 font-semibold",
        variant === "secondary" && "bg-panel-3 text-ink border border-line-strong hover:bg-white/[0.08]",
        variant === "ghost" && "text-ink-2 hover:text-ink hover:bg-white/[0.05]",
        variant === "danger" && "text-critical border border-critical/30 bg-critical/10 hover:bg-critical/20",
        className,
      )}
    >
      {children}
    </button>
  );
}

export const inputClass =
  "h-9 w-full px-3 bg-panel-2 border border-line-strong rounded-lg text-[13px] text-ink placeholder:text-ink-3 focus:outline-none focus:border-accent/60 focus:ring-2 focus:ring-accent/15 transition-colors";

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex items-center gap-0.5 p-0.5 bg-panel-2 border border-line rounded-lg">
      {options.map((o) => (
        <button
          key={String(o.value)}
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            "h-7 px-2.5 rounded-md text-[12px] font-medium transition-colors",
            value === o.value ? "bg-panel-3 text-ink shadow-sm border border-line-strong" : "text-ink-3 hover:text-ink-2 border border-transparent",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Horizontal meter. The fill turns amber past `warnAt`, red past `critAt`. */
export function Meter({
  value,
  max,
  warnAt = 0.75,
  critAt = 0.9,
  label,
  detail,
  height = 6,
}: {
  value: number | null | undefined;
  max: number | null | undefined;
  warnAt?: number;
  critAt?: number;
  label?: React.ReactNode;
  detail?: React.ReactNode;
  height?: number;
}) {
  const known = value != null && max != null && max > 0;
  const ratio = known ? Math.max(0, Math.min(1, value! / max!)) : 0;
  const color = ratio >= critAt ? "var(--critical)" : ratio >= warnAt ? "var(--warning)" : "var(--accent)";
  return (
    <div className="min-w-0">
      {(label || detail) && (
        <div className="flex items-baseline justify-between gap-2 mb-1.5 text-[12px]">
          <span className="text-ink-2 truncate">{label}</span>
          <span className="text-ink-3 tabular shrink-0">{detail}</span>
        </div>
      )}
      <div className="w-full rounded-full bg-white/[0.06] overflow-hidden" style={{ height }} role="meter" aria-valuenow={known ? Math.round(ratio * 100) : undefined} aria-valuemin={0} aria-valuemax={100}>
        {known && <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${ratio * 100}%`, background: color }} />}
      </div>
    </div>
  );
}

/** Small circular usage ring for list rows. */
export function Ring({ value, max, size = 40 }: { value: number; max: number; size?: number }) {
  const stroke = 4;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const color = ratio >= 0.9 ? "var(--critical)" : ratio >= 0.75 ? "var(--warning)" : "var(--accent)";
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} title={`${Math.round(value).toLocaleString()} of ${max.toLocaleString()} min this month`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.07)" strokeWidth={stroke} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none" strokeDasharray={c} strokeDashoffset={c - ratio * c} strokeLinecap="round" className="transition-all duration-700" />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-ink tabular">
        {ratio > 0 && ratio < 0.01 ? "<1" : Math.round(ratio * 100)}%
      </span>
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="py-10 text-center text-[13px] text-ink-3">{children}</div>;
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cx("shimmer rounded-lg", className)} />;
}

/** A column chart's outline while its data loads. */
export function ChartSkeleton({ height = 220, bars = 24 }: { height?: number; bars?: number }) {
  // Fixed heights (not random) so the placeholder doesn't jump between renders.
  const shape = [38, 52, 45, 60, 72, 66, 58, 80, 74, 62, 55, 68, 84, 77, 70, 61, 57, 66, 73, 81, 69, 58, 50, 63];
  return (
    <div aria-label="Loading chart" role="status" className="flex items-end gap-[6px] px-10 pb-6" style={{ height }}>
      {Array.from({ length: bars }, (_, i) => (
        <div key={i} className="shimmer flex-1 rounded-t-[4px]" style={{ height: `${shape[i % shape.length]}%` }} />
      ))}
    </div>
  );
}

/** Text-line placeholders for lists. */
export function LinesSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="space-y-1.5">
          <Skeleton className="h-3" />
          <Skeleton className="h-1.5 w-2/3" />
        </div>
      ))}
    </div>
  );
}

export function Spinner({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={cx("spin", className)} aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** Slide-in side panel. `onClose` runs after the closing animation. */
export function Drawer({
  title,
  subtitle,
  actions,
  onClose,
  children,
  width = "max-w-[860px]",
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  width?: string;
}) {
  const [closing, setClosing] = useState(false);
  const close = () => {
    if (closing) return;
    setClosing(true);
    const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setTimeout(onClose, reduce ? 0 : 190);
  };
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", esc);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", esc);
      document.body.style.overflow = overflow;
    };
  });
  return (
    <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true">
      <div className={cx("absolute inset-0 bg-black/60 backdrop-blur-[2px]", closing ? "backdrop-out" : "backdrop-in")} onClick={close} />
      <aside
        className={cx(
          "absolute right-0 top-0 h-viewport w-full bg-canvas border-l border-line-strong shadow-2xl flex flex-col",
          width,
          closing ? "drawer-out" : "drawer-in",
        )}
      >
        <header className="px-5 md:px-6 h-16 shrink-0 flex items-center justify-between gap-3 border-b border-line">
          <div className="min-w-0">
            <div className="text-[16px] font-semibold text-ink truncate">{title}</div>
            {subtitle && <div className="text-[12px] text-ink-3 truncate">{subtitle}</div>}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {actions}
            <button onClick={close} className="w-9 h-9 rounded-lg flex items-center justify-center text-ink-3 hover:text-ink hover:bg-white/[0.05]" aria-label="Close panel">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
            </button>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto custom-scrollbar p-5 md:p-6">{children}</div>
      </aside>
    </div>
  );
}

export function ErrorBanner({ message, onClose }: { message: string; onClose?: () => void }) {
  if (!message) return null;
  return (
    <div role="alert" className="flex items-start justify-between gap-4 p-3 rounded-xl bg-critical/10 border border-critical/30 text-critical text-[13px]">
      <span className="flex items-center gap-2">
        <AlertOctagon size={15} />
        {message}
      </span>
      {onClose && (
        <button onClick={onClose} className="text-critical/80 hover:text-ink text-[12px]">
          Dismiss
        </button>
      )}
    </div>
  );
}

export function KeyValue({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2 border-b border-line last:border-0 text-[13px]">
      <span className="text-ink-3 shrink-0">{label}</span>
      <span className="text-ink text-right min-w-0 truncate">{children}</span>
    </div>
  );
}

export function MiniStat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "critical" | "warning" | "good" }) {
  return (
    <div className="rounded-xl bg-panel-2 border border-line px-3 py-2.5 min-w-0">
      <div className="text-[11px] text-ink-3 truncate">{label}</div>
      <div className={cx("text-[15px] font-semibold mt-0.5 tabular truncate", tone === "critical" ? "text-critical" : tone === "warning" ? "text-warning" : tone === "good" ? "text-good" : "text-ink")}>
        {value}
      </div>
    </div>
  );
}
