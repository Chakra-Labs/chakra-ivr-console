// Shapes the API routes return. Fleet shapes mirror chakra-gpu-fleet's
// controller (/fleet/nodes, /fleet/capacity, /fleet/metrics).

export interface Client {
  id: number;
  company_name: string;
  // Only the first 16 characters are ever sent back; the full key exists only
  // in the response that created (or rotated) it.
  token_prefix?: string | null;
  is_active: boolean;
  package_name?: string | null;
  /** Voice pipelines this licence may run, first = default; empty = not assigned. */
  pipelines?: string[] | null;
  /** Agents pinned to one pipeline (agent name → pipeline). */
  agent_pipelines?: Record<string, string> | null;
  created_at?: string | null;
  /** Speech minutes (STT + TTS audio) since the 1st of this month. */
  month_minutes: number;
  last_activity?: string | null;
}

export interface DailyPoint {
  day: string; // YYYY-MM-DD, Sri Lanka time
  stt_min: number;
  tts_min: number;
  stt_requests: number;
  tts_requests: number;
  errors: number;
  rejected: number;
  /** Call minutes of calls that bypass the gateway (Gemini Live). */
  live_min: number;
  /** Finished calls on every pipeline, as chakra-ivr-core reports them. */
  calls: number;
}

export interface HeatCell {
  dow: number; // 1 = Monday … 7 = Sunday
  hour: number; // 0–23, Sri Lanka time
  minutes: number;
  requests: number;
}

export interface LicenseUsage {
  license_id: number;
  /** Speech minutes (STT + TTS) plus the call minutes of Gemini Live calls. */
  month_minutes: number;
  month_stt_min: number;
  month_tts_min: number;
  month_live_min: number;
  /** Finished calls on every pipeline. */
  month_calls: number;
  last_mtd_calls: number;
  month_requests: number;
  month_errors: number;
  month_rejected: number;
  month_peak_inflight: number;
  /** Same days of last month, for a fair comparison mid-month. */
  last_mtd_minutes: number;
  last_mtd_requests: number;
  last_mtd_errors: number;
  last_month_minutes: number;
  last_month_requests: number;
  last_activity: string | null;
}

export interface Analytics {
  available: boolean;
  extended: boolean;
  now: string;
  month_start: string;
  days_in_month: number;
  days: number;
  daily: DailyPoint[];
  heatmap: HeatCell[];
  licenses: LicenseUsage[];
}

export interface NodeHealth {
  ok: boolean;
  status?: string;
  queue_depth?: number;
  avg_gpu_ms?: number;
  vram_mb?: number;
  vram_total_mb?: number;
  gpu?: string;
  uptime_s?: number;
  model?: string;
  backend?: string | null;
  voice?: string;
  stats?: {
    submitted?: number;
    batches?: number;
    errors?: number;
    avg_batch_size?: number;
    max_batch_seen?: number;
    avg_gpu_ms?: number;
    avg_queue_ms?: number;
  };
  host?: { cpu_pct?: number | null; cpu_count?: number; ram_used_mb?: number; ram_total_mb?: number; load_1m?: number } | null;
  error?: string;
}

export interface FleetNode {
  id: number;
  name: string;
  role: "stt" | "tts";
  host: string;
  managed: boolean;
  state: string;
  image: string | null;
  last_error: string | null;
  created_at?: string;
  updated_at: string;
  health?: NodeHealth | null;
}

export interface Capacity {
  active_licenses: number;
  total_lines: number;
  required: { stt: number; tts: number };
  active: { stt: number; tts: number };
  deploying: { stt: number; tts: number };
  missing: { stt: number; tts: number };
  lines_supported: number;
  unknown_packages: string[];
  node_capacity?: { stt: number; tts: number };
}

export interface MetricPoint {
  t: string;
  checks: number;
  ok_checks: number;
  requests: number;
  errors: number;
  avg_ms: number | null;
  p95_ms: number | null;
  peak_inflight: number;
  max_queue: number;
  vram_used_mb: number | null;
  cpu_pct: number | null;
  ram_used_mb: number | null;
}

export interface NodeSummary {
  node_id: number;
  requests_5m: number | null;
  errors_5m: number | null;
  avg_ms_5m: number | null;
  p95_ms_5m: number | null;
  peak_inflight_5m: number | null;
  requests_1h: number | null;
  errors_1h: number | null;
  avg_ms_1h: number | null;
  p95_ms_1h: number | null;
  peak_inflight_1h: number | null;
  requests_24h: number | null;
  errors_24h: number | null;
  uptime_24h: number | null;
  uptime_7d: number | null;
  last_ok_at: string | null;
  last_down_at: string | null;
  last_seen_at: string | null;
}

export interface DowntimeEvent {
  node_id: number;
  started_at: string;
  ended_at: string;
  minutes: number;
  ongoing: boolean;
}

export interface FleetMetrics {
  hours: number;
  bucket_minutes: number;
  nodes: { id: number; name: string; role: "stt" | "tts"; host: string; state: string }[];
  series: Record<string, MetricPoint[]>;
  summary: Record<string, NodeSummary>;
  downtime: DowntimeEvent[];
}
