import crypto from "crypto";

import { currentAdmin, unauthorized } from "@/lib/auth";
import { hasCallUsage, OFF_GATEWAY, pool, TIME_ZONE, usageSchema } from "@/lib/db";
import { MAX_LIMIT_MINUTES, MAX_WARNING_SECONDS, wholeNumber } from "@/lib/daily-limit";
import { isPipeline } from "@/lib/pipelines";

// Client API keys. Stored as SHA-256 hashes (see chakra-license-server
// migrations/001_hash_tokens.sql): the full key is returned exactly once — when
// it is created or rotated — and never again, by any route.

// Mock data only when explicitly asked for (local UI work). It used to switch on
// by itself whenever DATABASE_URL was missing.
const MOCK = process.env.LICENSE_HUB_MOCK === "1";
let mockLicenses: Record<string, unknown>[] = [
  { id: 1, company_name: "AgroCorp Sri Lanka", token_prefix: "chk_live_agroco", is_active: true, month_minutes: 142, package_name: "Essential" },
  { id: 2, company_name: "Island Tours Pvt Ltd", token_prefix: "chk_live_tour45", is_active: false, month_minutes: 1050, package_name: "Standard" },
];

const PUBLIC_COLUMNS =
  "id, company_name, token_prefix, is_active, used_minutes, package_name, pipelines, agent_pipelines, " +
  "daily_limit_minutes, limit_warning_seconds, agent_daily_limits, created_at";

function newKey() {
  const token = `chk_live_${crypto.randomBytes(32).toString("hex")}`;
  return {
    token,
    hash: crypto.createHash("sha256").update(token).digest("hex"),
    prefix: token.slice(0, 16),
  };
}

function noDatabase(): Response {
  return Response.json({ error: "DATABASE_URL is not configured" }, { status: 500 });
}

function serverError(error: unknown, what: string): Response {
  console.error(`Database error (${what}):`, error);
  return Response.json({ error: `Failed to ${what}` }, { status: 500 });
}

/** The validated daily-limit fields of a PUT body, or null when any is out of range. */
function dailyLimitBody(body: { dailyLimitMinutes?: unknown; limitWarningSeconds?: unknown; agentDailyLimits?: unknown }) {
  const minutes = wholeNumber(body.dailyLimitMinutes, MAX_LIMIT_MINUTES);
  const warning = wholeNumber(body.limitWarningSeconds, MAX_WARNING_SECONDS);
  if (minutes === null || warning === null) return null;
  const agents: Record<string, number> = {};
  if (body.agentDailyLimits && typeof body.agentDailyLimits === "object") {
    for (const [agent, value] of Object.entries(body.agentDailyLimits as Record<string, unknown>)) {
      const n = wholeNumber(value, MAX_LIMIT_MINUTES);
      if (agent.trim() && n !== null) agents[agent.trim().slice(0, 120)] = n;
    }
  }
  return { daily_limit_minutes: minutes, limit_warning_seconds: warning, agent_daily_limits: agents };
}

export async function GET() {
  if (!(await currentAdmin())) return unauthorized();
  if (MOCK) return Response.json(mockLicenses);
  if (!pool) return noDatabase();
  try {
    // Usage comes from the speech gateway's meter (speech_usage), plus call_usage
    // for calls that bypass the gateway, this month in Sri Lanka time.
    // `used_minutes` is the old license server's counter.
    if (!(await usageSchema()).table) {
      const result = await pool.query(`SELECT ${PUBLIC_COLUMNS} FROM licenses ORDER BY created_at DESC`);
      return Response.json(result.rows.map((r) => ({ ...r, month_minutes: 0, last_activity: null })));
    }
    // Plus the call minutes of calls that bypass the gateway (see OFF_GATEWAY).
    const calls = await hasCallUsage();
    const result = await pool.query(
      `SELECT ${PUBLIC_COLUMNS.split(", ").map((c) => `l.${c}`).join(", ")},
              (COALESCE(u.month_minutes, 0) + COALESCE(c.month_minutes, 0))::float8 AS month_minutes,
              GREATEST(a.last_activity, c.last_activity) AS last_activity
       FROM licenses l
       LEFT JOIN (
         SELECT license_id, SUM(stt_seconds + tts_seconds) / 60 AS month_minutes
         FROM speech_usage
         WHERE hour >= date_trunc('month', now() AT TIME ZONE $1) AT TIME ZONE $1
         GROUP BY license_id
       ) u ON u.license_id = l.id
       LEFT JOIN (SELECT license_id, MAX(hour) AS last_activity FROM speech_usage GROUP BY license_id) a
         ON a.license_id = l.id
       LEFT JOIN (
         ${
           calls
             ? `SELECT license_id,
                  SUM(call_seconds) FILTER (WHERE hour >= date_trunc('month', now() AT TIME ZONE $1) AT TIME ZONE $1) / 60 AS month_minutes,
                  MAX(hour) AS last_activity
                FROM call_usage WHERE ${OFF_GATEWAY} GROUP BY license_id`
             : "SELECT NULL::int AS license_id, NULL::float8 AS month_minutes, NULL::timestamptz AS last_activity"
         }
       ) c ON c.license_id = l.id
       ORDER BY l.created_at DESC`,
      [TIME_ZONE],
    );
    return Response.json(result.rows);
  } catch (error) {
    return serverError(error, "fetch licenses");
  }
}

export async function POST(request: Request) {
  if (!(await currentAdmin())) return unauthorized();
  let companyName = "";
  let packageName = "";
  try {
    const body = await request.json();
    companyName = String(body.companyName ?? "").trim().slice(0, 200);
    packageName = String(body.packageName ?? "").trim().slice(0, 80);
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  if (!companyName) return Response.json({ error: "Company Name is required" }, { status: 400 });

  const key = newKey();
  if (MOCK) {
    const row = { id: Date.now(), company_name: companyName, token_prefix: key.prefix, is_active: true, used_minutes: 0, package_name: packageName || "Essential" };
    mockLicenses = [row, ...mockLicenses];
    return Response.json({ ...row, token: key.token });
  }
  if (!pool) return noDatabase();
  try {
    const result = await pool.query(
      `INSERT INTO licenses (token_hash, token_prefix, company_name, is_active, used_minutes, package_name, created_at)
       VALUES ($1, $2, $3, TRUE, 0, $4, NOW()) RETURNING ${PUBLIC_COLUMNS}`,
      [key.hash, key.prefix, companyName, packageName || "Essential"],
    );
    // The only response that ever carries the full key.
    return Response.json({ ...result.rows[0], token: key.token });
  } catch (error) {
    return serverError(error, "create license");
  }
}

export async function PUT(request: Request) {
  if (!(await currentAdmin())) return unauthorized();
  let body: {
    id?: unknown;
    action?: unknown;
    companyName?: unknown;
    isActive?: unknown;
    packageName?: unknown;
    pipelines?: unknown;
    agentPipelines?: unknown;
    dailyLimitMinutes?: unknown;
    limitWarningSeconds?: unknown;
    agentDailyLimits?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  const id = Number(body.id);
  if (!Number.isInteger(id)) return Response.json({ error: "ID is required" }, { status: 400 });

  if (MOCK) {
    const row = mockLicenses.find((l) => l.id === id);
    if (!row) return Response.json({ error: "Not found" }, { status: 404 });
    if (body.action === "edit" && body.companyName) row.company_name = String(body.companyName);
    else if (body.action === "toggle_status") row.is_active = Boolean(body.isActive);
    else if (body.action === "pipelines") {
      row.pipelines = Array.isArray(body.pipelines) ? body.pipelines.filter(isPipeline) : [];
      row.agent_pipelines = body.agentPipelines ?? {};
    } else if (body.action === "daily_limit") {
      const limit = dailyLimitBody(body);
      if (!limit) return Response.json({ error: "Invalid daily limit" }, { status: 400 });
      Object.assign(row, limit);
    } else if (body.action === "rotate") {
      const key = newKey();
      row.token_prefix = key.prefix;
      return Response.json({ ...row, token: key.token });
    }
    return Response.json(row);
  }
  if (!pool) return noDatabase();

  try {
    let result;
    if (body.action === "edit" && typeof body.companyName === "string" && body.companyName.trim()) {
      result = await pool.query(
        `UPDATE licenses SET company_name = $1 WHERE id = $2 RETURNING ${PUBLIC_COLUMNS}`,
        [body.companyName.trim().slice(0, 200), id],
      );
    } else if (body.action === "toggle_status") {
      result = await pool.query(
        `UPDATE licenses SET is_active = $1 WHERE id = $2 RETURNING ${PUBLIC_COLUMNS}`,
        [Boolean(body.isActive), id],
      );
    } else if (body.action === "package" && typeof body.packageName === "string") {
      result = await pool.query(
        `UPDATE licenses SET package_name = $1 WHERE id = $2 RETURNING ${PUBLIC_COLUMNS}`,
        [body.packageName.trim().slice(0, 80), id],
      );
    } else if (body.action === "pipelines") {
      // What chakra-ivr-core runs for this licence: read from the signed licence
      // check, so it takes effect at the client's next start (and within its
      // 10-minute re-check for calls already running).
      const pipelines = Array.isArray(body.pipelines) ? [...new Set(body.pipelines.filter(isPipeline))] : [];
      const pins: Record<string, string> = {};
      if (body.agentPipelines && typeof body.agentPipelines === "object") {
        for (const [agent, pipeline] of Object.entries(body.agentPipelines as Record<string, unknown>)) {
          if (agent.trim() && isPipeline(pipeline)) pins[agent.trim().slice(0, 120)] = pipeline;
        }
      }
      result = await pool.query(
        `UPDATE licenses SET pipelines = $1, agent_pipelines = $2::jsonb WHERE id = $3 RETURNING ${PUBLIC_COLUMNS}`,
        [pipelines, JSON.stringify(pins), id],
      );
    } else if (body.action === "daily_limit") {
      // Daily talk time per caller, read by chakra-ivr-core 0.5+ from the signed
      // licence check: applies within the client's 10-minute re-check.
      const limit = dailyLimitBody(body);
      if (!limit) return Response.json({ error: "Invalid daily limit" }, { status: 400 });
      result = await pool.query(
        `UPDATE licenses SET daily_limit_minutes = $1, limit_warning_seconds = $2, agent_daily_limits = $3::jsonb
         WHERE id = $4 RETURNING ${PUBLIC_COLUMNS}`,
        [limit.daily_limit_minutes, limit.limit_warning_seconds, JSON.stringify(limit.agent_daily_limits), id],
      );
    } else if (body.action === "rotate") {
      // A lost key can't be shown again (only its hash is kept): issue a new one.
      // The old key stops working immediately here, and at the speech gateway
      // within its key-cache time (60 s).
      const key = newKey();
      result = await pool.query(
        `UPDATE licenses SET token_hash = $1, token_prefix = $2, token = NULL WHERE id = $3 RETURNING ${PUBLIC_COLUMNS}`,
        [key.hash, key.prefix, id],
      );
      if (result.rowCount === 0) return Response.json({ error: "Not found" }, { status: 404 });
      return Response.json({ ...result.rows[0], token: key.token });
    } else {
      return Response.json({ error: "Invalid action" }, { status: 400 });
    }
    if (result.rowCount === 0) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json(result.rows[0]);
  } catch (error) {
    return serverError(error, "update license");
  }
}

export async function DELETE(request: Request) {
  if (!(await currentAdmin())) return unauthorized();
  let id: number;
  try {
    id = Number((await request.json()).id);
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  if (!Number.isInteger(id)) return Response.json({ error: "ID is required" }, { status: 400 });
  if (MOCK) {
    mockLicenses = mockLicenses.filter((l) => l.id !== id);
    return Response.json({ success: true });
  }
  if (!pool) return noDatabase();
  try {
    await pool.query("DELETE FROM licenses WHERE id = $1", [id]);
    return Response.json({ success: true });
  } catch (error) {
    return serverError(error, "delete license");
  }
}
