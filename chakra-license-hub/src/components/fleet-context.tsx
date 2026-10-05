"use client";

// Live fleet data shared by the header bell, the dashboard and the GPU tab:
// node health (probed by the controller on every call), sizing, and the last
// 24 h of per-node metrics. Polled while the hub is open.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { assess, type Assessment } from "@/lib/fleet-health";
import { track } from "@/lib/loading";
import type { Capacity, FleetMetrics, FleetNode } from "@/lib/types";

import { signedOut } from "./hub-context";

export async function fleetApi<T>(path: string, init?: RequestInit, quiet = false): Promise<T> {
  const res = await track(
    fetch(`/api/fleet/${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
      cache: "no-store",
    }),
    quiet,
  );
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) signedOut();
  if (!res.ok) throw new Error(body.detail ?? body.error ?? `HTTP ${res.status}`);
  return body as T;
}

export interface FleetAlert {
  node: FleetNode;
  assessment: Assessment;
}

interface FleetState {
  nodes: FleetNode[];
  capacity: Capacity | null;
  metrics: FleetMetrics | null;
  assessments: Map<number, Assessment>;
  alerts: FleetAlert[];
  error: string;
  loaded: boolean;
  updatedAt: number | null;
  refresh: () => Promise<void>;
}

const FleetContext = createContext<FleetState | null>(null);

const LIVE_MS = 30_000;
const METRICS_MS = 60_000;

/** `enabled` false (a company account) never asks the fleet: it stays empty. */
export function FleetProvider({ children, enabled = true }: { children: React.ReactNode; enabled?: boolean }) {
  const [nodes, setNodes] = useState<FleetNode[]>([]);
  const [capacity, setCapacity] = useState<Capacity | null>(null);
  const [metrics, setMetrics] = useState<FleetMetrics | null>(null);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const refreshLive = useCallback(async (quiet = false) => {
    try {
      const [n, c] = await Promise.all([
        fleetApi<FleetNode[]>("nodes?health=true", undefined, quiet),
        fleetApi<Capacity>("capacity", undefined, quiet),
      ]);
      setNodes(n);
      setCapacity(c);
      setError("");
      setUpdatedAt(Date.now());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoaded(true);
    }
  }, []);

  const refreshMetrics = useCallback(async (quiet = false) => {
    try {
      setMetrics(await fleetApi<FleetMetrics>("metrics?hours=24", undefined, quiet));
    } catch {
      // Older controllers have no /metrics; the live view still works.
    }
  }, []);

  const refresh = useCallback(async () => {
    await Promise.all([refreshLive(), refreshMetrics()]);
  }, [refreshLive, refreshMetrics]);

  useEffect(() => {
    if (!enabled) return;
    const first = setTimeout(refresh, 0);
    const live = setInterval(() => refreshLive(true), LIVE_MS);
    const met = setInterval(() => refreshMetrics(true), METRICS_MS);
    return () => {
      clearTimeout(first);
      clearInterval(live);
      clearInterval(met);
    };
  }, [enabled, refresh, refreshLive, refreshMetrics]);

  const value = useMemo<FleetState>(() => {
    const assessments = new Map<number, Assessment>();
    for (const n of nodes) assessments.set(n.id, assess(n, metrics?.summary[String(n.id)], capacity));
    const alerts = nodes
      .map((node) => ({ node, assessment: assessments.get(node.id)! }))
      .filter((a) => a.assessment.level)
      .sort((a, b) => (a.assessment.level === b.assessment.level ? 0 : a.assessment.level === "down" ? -1 : 1));
    return { nodes, capacity, metrics, assessments, alerts, error, loaded, updatedAt, refresh };
  }, [nodes, capacity, metrics, error, loaded, updatedAt, refresh]);

  return <FleetContext.Provider value={value}>{children}</FleetContext.Provider>;
}

export function useFleet(): FleetState {
  const ctx = useContext(FleetContext);
  if (!ctx) throw new Error("useFleet must be used inside <FleetProvider>");
  return ctx;
}
