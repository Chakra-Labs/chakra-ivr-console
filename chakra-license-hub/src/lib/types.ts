// Shapes the API routes return. Fleet shapes mirror chakra-gpu-fleet's
// controller (/fleet/nodes, /fleet/capacity, /fleet/metrics).

/** Who is signed in (GET /api/auth/me). */
export type ViewerInfo =
  | { role: "admin"; email: string }
  | { role: "company"; email: string; licenseId: number; companyName: string };

/** A company's IVR Console sign-in (GET /api/console-users). */
export interface ConsoleAccount {
  license_id: number;
  email: string;
  is_active: boolean;
  created_at: string;
  password_changed_at: string;
  last_login_at: string | null;
}

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
  /** Daily talk time per caller, in minutes; 0 = no limit. */
  daily_limit_minutes?: number | null;
  /** Seconds before the daily limit the caller is warned; 0 = no warning. */
  limit_warning_seconds?: number | null;
  /** Agents with their own daily limit (agent name → minutes; 0 = none). */
  agent_daily_limits?: Record<string, number> | null;
  /** The preset voice of its Gemini Live lines; null = the app's own setting. */
  gemini_voice?: string | null;
  /** The kinds of voice its lines use: "preset" (a named voice) and/or "clone"
   * (its own reference recording). What a company account sees instead of pipelines. */
  voice_modes?: ("preset" | "clone")[];
  /** A reference recording is uploaded for its Chakra Voice lines. */
  has_custom_voice?: boolean;
  /** Finished calls since the 1st of this month, on every pipeline. */
  month_calls?: number;
  created_at?: string | null;
  /** Speech minutes (STT + TTS audio) since the 1st of this month. */
  month_minutes: number;
  last_activity?: string | null;
}

/** A licence's voice settings (GET /api/voice). */
export interface VoiceState {
  modes: ("preset" | "clone")[];
  /** The chosen preset voice; "" = the app's own setting. */
  preset: string;
  custom: {
    voice_id: string;
    file_name: string | null;
    seconds: number;
    transcript: string;
    /** pending: not used on a call yet; ready: a GPU has prepared it; rejected: unusable. */
    status: "pending" | "ready" | "rejected";
    status_detail: string;
    updated_by: string | null;
    updated_at: string;
  } | null;
}

/** How a licence's calls are greeted (GET /api/greeting). */
export interface GreetingState {
  /** "recorded": a recorded opening plays at once; "auto": generated; "": the app decides. */
  mode: "recorded" | "auto" | "";
  recording: {
    greeting_id: string;
    file_name: string | null;
    seconds: number;
    transcript: string;
    updated_by: string | null;
    updated_at: string;
  } | null;
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
  /** All the day's minutes (speech + Gemini Live): what a company account sees. */
  minutes: number;
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
  /** Finished calls on every pipeline, and their talk time (call minutes). */
  month_calls: number;
  last_mtd_calls: number;
  last_month_calls: number;
  month_call_min: number;
  last_mtd_call_min: number;
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
  /** Cost to serve this month, USD (admins only): the managed LLM's requests,
   * and this licence's share of the GPU rent. */
  month_llm_usd?: number;
  month_gpu_usd?: number;
}

/** What the fleet has cost this month, USD (admins only). */
export interface CostSummary {
  llm_usd: number;
  /** The part of `llm_usd` the provider stated itself (the rest is tokens x list price). */
  llm_reported_usd: number;
  /** GPU rent since the month began, the part of it no licence used, and the fleet's rate now. */
  gpu_rent_usd: number;
  gpu_idle_usd: number;
  gpu_hourly_usd: number;
  /** A provider's remaining credit, where it has an API for one. */
  balance: { provider: string; usd: number } | null;
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
  cost?: CostSummary | null;
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
