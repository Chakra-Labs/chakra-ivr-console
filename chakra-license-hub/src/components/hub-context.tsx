"use client";

// Data every page shares: licences, packages, the current route, toasts and
// the "new key" dialog. Lives in the shell (app/page.tsx).
import { createContext, useCallback, useContext, useEffect, useState, type Dispatch, type SetStateAction } from "react";

import { track } from "@/lib/loading";
import type { Package } from "@/lib/packages";
import type { Analytics, Client, ViewerInfo } from "@/lib/types";

export type Route =
  | { page: "dashboard" }
  | { page: "companies" }
  | { page: "company"; id: number }
  | { page: "new" }
  | { page: "packages" }
  | { page: "gpus"; node?: number }
  | { page: "fleet" }
  | { page: "settings"; id?: number }
  | { page: "licences"; id?: number }
  | { page: "limits" }
  | { page: "voice" }
  | { page: "account" };

export function parseRoute(hash: string): Route {
  const h = hash.replace(/^#\/?/, "");
  const company = /^company\/(\d+)$/.exec(h);
  if (company) return { page: "company", id: Number(company[1]) };
  const gpu = /^gpus\/(\d+)$/.exec(h);
  if (gpu) return { page: "gpus", node: Number(gpu[1]) };
  // "manage" is what Company settings was called: old links still open it.
  const settings = /^(?:settings|manage)\/(\d+)$/.exec(h);
  if (settings) return { page: "settings", id: Number(settings[1]) };
  const licence = /^licences\/(\d+)$/.exec(h);
  if (licence) return { page: "licences", id: Number(licence[1]) };
  if (h === "manage") return { page: "settings" };
  if (["companies", "new", "packages", "gpus", "fleet", "settings", "licences", "limits", "voice", "account"].includes(h)) return { page: h } as Route;
  return { page: "dashboard" };
}

export function routeHash(r: Route): string {
  if (r.page === "company") return `#company/${r.id}`;
  if (r.page === "gpus" && r.node != null) return `#gpus/${r.node}`;
  if ((r.page === "settings" || r.page === "licences") && r.id != null) return `#${r.page}/${r.id}`;
  return `#${r.page}`;
}

export interface Hub {
  /** Who is signed in: an admin sees everything; a company account only its licence. */
  viewer: ViewerInfo;
  clients: Client[];
  clientsLoaded: boolean;
  setClients: Dispatch<SetStateAction<Client[]>>;
  reloadClients: (quiet?: boolean) => Promise<void>;
  packages: Package[];
  setPackages: Dispatch<SetStateAction<Package[]>>;
  navigate: (r: Route) => void;
  toast: (message: string, tone?: "error" | "success") => void;
  /** Ask, rotate, and show the new key once. Resolves true when rotated. */
  rotateKey: (client: Client) => Promise<boolean>;
  /** Wall clock, refreshed every minute (for "5 min ago" labels). */
  now: number;
}

export const HubContext = createContext<Hub | null>(null);

export function useHub(): Hub {
  const ctx = useContext(HubContext);
  if (!ctx) throw new Error("useHub must be used inside the hub shell");
  return ctx;
}

/** The session expired: the shell listens for this and goes to /login. */
export function signedOut() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("chakra:signed-out"));
}

export async function licenseApi<T>(method: string, body?: unknown, quiet = false): Promise<T> {
  const res = await track(
    fetch("/api/licenses", {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    }),
    quiet,
  );
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) signedOut();
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data as T;
}

/** Speech analytics for every licence, or one (`license`). */
export function useAnalytics(days: number, license?: number) {
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (quiet = false) => {
    setLoading(true);
    try {
      const q = new URLSearchParams({ days: String(days) });
      if (license != null) q.set("license", String(license));
      const res = await track(fetch(`/api/analytics?${q}`, { cache: "no-store" }), quiet);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setData(body);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [days, license]);

  useEffect(() => {
    const first = setTimeout(() => load(), 0);
    const t = setInterval(() => load(true), 120_000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [load]);

  return { data, error, loading, reload: load };
}
