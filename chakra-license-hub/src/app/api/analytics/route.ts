import type { NextRequest } from "next/server";

import { currentViewer, unauthorized } from "@/lib/auth";
import { hasCallUsage, OFF_GATEWAY, pool, TIME_ZONE, usageSchema } from "@/lib/db";
import type { Analytics, DailyPoint, HeatCell, LicenseUsage } from "@/lib/types";

// Speech usage for the dashboard and the company page, from `speech_usage`
// (one row per licence per hour, written by the speech gateway).
//
//   GET /api/analytics?days=30            every licence
//   GET /api/analytics?days=30&license=7  one licence
//
// "Minutes" are speech minutes: caller audio transcribed (STT) plus agent audio
// spoken (TTS). Calls that bypass the gateway (Gemini Live) count their call
// minutes instead, from `call_usage`, which also gives every licence's call
// count on every pipeline. Days and months follow Sri Lanka time.

const ALLOWED_DAYS = new Set([7, 30, 90]);

const f = (v: unknown) => Number(v ?? 0) || 0;

const EMPTY_USAGE: LicenseUsage = {
  license_id: 0, month_minutes: 0, month_stt_min: 0, month_tts_min: 0, month_live_min: 0, month_calls: 0,
  last_mtd_calls: 0, last_month_calls: 0, month_call_min: 0, last_mtd_call_min: 0, month_requests: 0, month_errors: 0, month_rejected: 0, month_peak_inflight: 0,
  last_mtd_minutes: 0, last_mtd_requests: 0, last_mtd_errors: 0, last_month_minutes: 0, last_month_requests: 0,
  last_activity: null,
};

export async function GET(request: NextRequest) {
  const viewer = await currentViewer();
  if (!viewer) return unauthorized();
  const params = request.nextUrl.searchParams;
  const days = ALLOWED_DAYS.has(Number(params.get("days"))) ? Number(params.get("days")) : 30;
  const licenseParam = params.get("license");
  // A company account only ever gets its own licence's numbers.
  const license =
    viewer.role === "company"
      ? viewer.licenseId
      : licenseParam && /^\d+$/.test(licenseParam)
        ? Number(licenseParam)
        : null;

  if (!pool) return Response.json({ error: "DATABASE_URL is not configured" }, { status: 500 });

  try {
    // Calendar facts in Sri Lanka time, computed by the database so the page
    // and the queries agree.
    const cal = (
      await pool.query(
        `SELECT now() AS now,
                date_trunc('month', now() AT TIME ZONE $1) AT TIME ZONE $1 AS month_start,
                EXTRACT(DAY FROM date_trunc('month', now() AT TIME ZONE $1) + interval '1 month - 1 day')::int AS days_in_month,
                to_char((now() AT TIME ZONE $1)::date - ($2::int - 1), 'YYYY-MM-DD') AS first_day`,
        [TIME_ZONE, days],
      )
    ).rows[0];

    const schema = await usageSchema();
    const base: Analytics = {
      available: schema.table,
      extended: schema.extended,
      now: cal.now.toISOString(),
      month_start: cal.month_start.toISOString(),
      days_in_month: cal.days_in_month,
      days,
      daily: [],
      heatmap: [],
      licenses: [],
    };
    const firstDay: string = cal.first_day;
    if (!schema.table) return Response.json({ ...base, daily: fillDays(firstDay, days, []) });

    // Columns added to speech_usage on 2026-10-03; read as 0 until the gateway
    // that writes them is running.
    const errors = schema.extended ? "stt_errors + tts_errors" : "0";
    const rejected = schema.extended ? "rejected" : "0";
    const peak = schema.extended ? "peak_inflight" : "0";

    const withCalls = await hasCallUsage();
    const [daily, heat, perLicense, lastSeen, calls, callsDaily, callsHeat] = await Promise.all([
      pool.query(
        `SELECT to_char((hour AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS day,
                SUM(stt_seconds)::float8 / 60 AS stt_min, SUM(tts_seconds)::float8 / 60 AS tts_min,
                SUM(stt_requests)::int AS stt_requests, SUM(tts_requests)::int AS tts_requests,
                SUM(${errors})::int AS errors, SUM(${rejected})::int AS rejected
         FROM speech_usage
         WHERE hour >= ($2::date)::timestamp AT TIME ZONE $1 AND ($3::int IS NULL OR license_id = $3)
         GROUP BY 1 ORDER BY 1`,
        [TIME_ZONE, firstDay, license],
      ),
      pool.query(
        `SELECT EXTRACT(ISODOW FROM hour AT TIME ZONE $1)::int AS dow,
                EXTRACT(HOUR FROM hour AT TIME ZONE $1)::int AS hour,
                SUM(stt_seconds + tts_seconds)::float8 / 60 AS minutes,
                SUM(stt_requests + tts_requests)::int AS requests
         FROM speech_usage
         WHERE hour >= now() - interval '30 days' AND ($2::int IS NULL OR license_id = $2)
         GROUP BY 1, 2`,
        [TIME_ZONE, license],
      ),
      pool.query(
        `WITH b AS (
           SELECT $1::timestamptz AS m,
                  (($1::timestamptz AT TIME ZONE $2) - interval '1 month') AT TIME ZONE $2 AS lm
         )
         SELECT license_id,
           COALESCE(SUM(stt_seconds + tts_seconds) FILTER (WHERE hour >= b.m), 0)::float8 / 60 AS month_minutes,
           COALESCE(SUM(stt_seconds) FILTER (WHERE hour >= b.m), 0)::float8 / 60 AS month_stt_min,
           COALESCE(SUM(tts_seconds) FILTER (WHERE hour >= b.m), 0)::float8 / 60 AS month_tts_min,
           COALESCE(SUM(stt_requests + tts_requests) FILTER (WHERE hour >= b.m), 0)::int AS month_requests,
           COALESCE(SUM(${errors}) FILTER (WHERE hour >= b.m), 0)::int AS month_errors,
           COALESCE(SUM(${rejected}) FILTER (WHERE hour >= b.m), 0)::int AS month_rejected,
           COALESCE(MAX(${peak}) FILTER (WHERE hour >= b.m), 0)::int AS month_peak_inflight,
           COALESCE(SUM(stt_seconds + tts_seconds) FILTER (WHERE hour >= b.lm AND hour < b.lm + (now() - b.m)), 0)::float8 / 60 AS last_mtd_minutes,
           COALESCE(SUM(stt_requests + tts_requests) FILTER (WHERE hour >= b.lm AND hour < b.lm + (now() - b.m)), 0)::int AS last_mtd_requests,
           COALESCE(SUM(${errors}) FILTER (WHERE hour >= b.lm AND hour < b.lm + (now() - b.m)), 0)::int AS last_mtd_errors,
           COALESCE(SUM(stt_seconds + tts_seconds) FILTER (WHERE hour >= b.lm AND hour < b.m), 0)::float8 / 60 AS last_month_minutes,
           COALESCE(SUM(stt_requests + tts_requests) FILTER (WHERE hour >= b.lm AND hour < b.m), 0)::int AS last_month_requests
         FROM speech_usage, b
         WHERE hour >= b.lm AND ($3::int IS NULL OR license_id = $3)
         GROUP BY license_id`,
        [cal.month_start, TIME_ZONE, license],
      ),
      pool.query(
        `SELECT license_id, MAX(hour) AS last_activity FROM speech_usage
         WHERE ($1::int IS NULL OR license_id = $1) GROUP BY license_id`,
        [license],
      ),
      // From call_usage: every finished call on every pipeline, and the call
      // minutes of the calls that bypass the gateway (see OFF_GATEWAY).
      withCalls
        ? pool.query(
            `WITH b AS (
               SELECT $1::timestamptz AS m,
                      (($1::timestamptz AT TIME ZONE $2) - interval '1 month') AT TIME ZONE $2 AS lm
             )
             SELECT license_id,
               COALESCE(SUM(call_seconds) FILTER (WHERE ${OFF_GATEWAY} AND hour >= b.m), 0)::float8 / 60 AS month_min,
               COALESCE(SUM(call_seconds) FILTER (WHERE ${OFF_GATEWAY} AND hour >= b.lm AND hour < b.lm + (now() - b.m)), 0)::float8 / 60 AS last_mtd_min,
               COALESCE(SUM(call_seconds) FILTER (WHERE ${OFF_GATEWAY} AND hour >= b.lm AND hour < b.m), 0)::float8 / 60 AS last_month_min,
               COALESCE(SUM(calls) FILTER (WHERE hour >= b.m), 0)::int AS month_calls,
               COALESCE(SUM(calls) FILTER (WHERE hour >= b.lm AND hour < b.lm + (now() - b.m)), 0)::int AS last_mtd_calls,
               COALESCE(SUM(calls) FILTER (WHERE hour >= b.lm AND hour < b.m), 0)::int AS last_month_calls,
               COALESCE(SUM(call_seconds) FILTER (WHERE hour >= b.m), 0)::float8 / 60 AS month_call_min,
               COALESCE(SUM(call_seconds) FILTER (WHERE hour >= b.lm AND hour < b.lm + (now() - b.m)), 0)::float8 / 60 AS last_mtd_call_min,
               MAX(hour) AS last_activity
             FROM call_usage, b
             WHERE ($3::int IS NULL OR license_id = $3)
             GROUP BY license_id`,
            [cal.month_start, TIME_ZONE, license],
          )
        : null,
      withCalls
        ? pool.query(
            `SELECT to_char((hour AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS day,
                    COALESCE(SUM(call_seconds) FILTER (WHERE ${OFF_GATEWAY}), 0)::float8 / 60 AS live_min,
                    SUM(calls)::int AS calls
             FROM call_usage
             WHERE hour >= ($2::date)::timestamp AT TIME ZONE $1 AND ($3::int IS NULL OR license_id = $3)
             GROUP BY 1`,
            [TIME_ZONE, firstDay, license],
          )
        : null,
      withCalls
        ? pool.query(
            `SELECT EXTRACT(ISODOW FROM hour AT TIME ZONE $1)::int AS dow,
                    EXTRACT(HOUR FROM hour AT TIME ZONE $1)::int AS hour,
                    SUM(call_seconds)::float8 / 60 AS minutes
             FROM call_usage
             WHERE ${OFF_GATEWAY} AND hour >= now() - interval '30 days' AND ($2::int IS NULL OR license_id = $2)
             GROUP BY 1, 2`,
            [TIME_ZONE, license],
          )
        : null,
    ]);

    const seen = new Map(lastSeen.rows.map((r) => [Number(r.license_id), r.last_activity as Date]));
    const callsBy = new Map<
      number,
      { month: number; lastMtd: number; lastMonth: number; calls: number; lastMtdCalls: number; lastMonthCalls: number; callMin: number; lastMtdCallMin: number }
    >();
    for (const r of calls?.rows ?? []) {
      const id = Number(r.license_id);
      callsBy.set(id, {
        month: f(r.month_min),
        lastMtd: f(r.last_mtd_min),
        lastMonth: f(r.last_month_min),
        calls: f(r.month_calls),
        lastMtdCalls: f(r.last_mtd_calls),
        lastMonthCalls: f(r.last_month_calls),
        callMin: f(r.month_call_min),
        lastMtdCallMin: f(r.last_mtd_call_min),
      });
      const at = r.last_activity as Date | null;
      if (at && (!seen.has(id) || at > seen.get(id)!)) seen.set(id, at);
    }
    const licenses: LicenseUsage[] = perLicense.rows.map((r) => ({
      license_id: Number(r.license_id),
      month_minutes: f(r.month_minutes),
      month_stt_min: f(r.month_stt_min),
      month_tts_min: f(r.month_tts_min),
      month_live_min: 0,
      month_calls: 0,
      last_mtd_calls: 0,
      last_month_calls: 0,
      month_call_min: 0,
      last_mtd_call_min: 0,
      month_requests: f(r.month_requests),
      month_errors: f(r.month_errors),
      month_rejected: f(r.month_rejected),
      month_peak_inflight: f(r.month_peak_inflight),
      last_mtd_minutes: f(r.last_mtd_minutes),
      last_mtd_requests: f(r.last_mtd_requests),
      last_mtd_errors: f(r.last_mtd_errors),
      last_month_minutes: f(r.last_month_minutes),
      last_month_requests: f(r.last_month_requests),
      last_activity: seen.get(Number(r.license_id))?.toISOString() ?? null,
    }));
    // Licences with older activity (or calls only) still get a row.
    for (const [id, at] of seen) {
      if (!licenses.some((l) => l.license_id === id)) {
        licenses.push({ ...EMPTY_USAGE, license_id: id, last_activity: at.toISOString() });
      }
    }
    for (const l of licenses) {
      const c = callsBy.get(l.license_id);
      if (!c) continue;
      l.month_live_min = c.month;
      l.month_minutes += c.month;
      l.last_mtd_minutes += c.lastMtd;
      l.last_month_minutes += c.lastMonth;
      l.month_calls = c.calls;
      l.last_mtd_calls = c.lastMtdCalls;
      l.last_month_calls = c.lastMonthCalls;
      l.month_call_min = c.callMin;
      l.last_mtd_call_min = c.lastMtdCallMin;
    }

    const callDays = new Map((callsDaily?.rows ?? []).map((r) => [r.day as string, r]));
    const heatmap = new Map<string, HeatCell>();
    for (const r of heat.rows) {
      heatmap.set(`${r.dow}-${r.hour}`, { dow: f(r.dow), hour: f(r.hour), minutes: f(r.minutes), requests: f(r.requests) });
    }
    for (const r of callsHeat?.rows ?? []) {
      const key = `${r.dow}-${r.hour}`;
      const cell = heatmap.get(key) ?? { dow: f(r.dow), hour: f(r.hour), minutes: 0, requests: 0 };
      cell.minutes += f(r.minutes);
      heatmap.set(key, cell);
    }

    const result: Analytics = {
      ...base,
      daily: fillDays(
        firstDay,
        days,
        daily.rows.map((r) => ({
          day: r.day,
          stt_min: f(r.stt_min),
          tts_min: f(r.tts_min),
          stt_requests: f(r.stt_requests),
          tts_requests: f(r.tts_requests),
          errors: f(r.errors),
          rejected: f(r.rejected),
          live_min: 0,
          calls: 0,
          minutes: 0,
        })),
      ).map((d) => {
        const c = callDays.get(d.day);
        const withCalls = c ? { ...d, live_min: f(c.live_min), calls: f(c.calls) } : d;
        return { ...withCalls, minutes: withCalls.stt_min + withCalls.tts_min + withCalls.live_min };
      }),
      heatmap: [...heatmap.values()],
      licenses,
    };
    // A company account gets totals only: which speech engines and models serve
    // its calls (STT/TTS/Gemini Live, speech requests, GPU load) is Chakra Labs'.
    return Response.json(viewer.role === "company" ? forCompany(result) : result);
  } catch (error) {
    console.error("Database error (analytics):", error);
    return Response.json({ error: "Failed to load analytics" }, { status: 500 });
  }
}

/** The analytics a company account may see: minutes and calls, nothing that
 * names the technology behind them. */
function forCompany(a: Analytics): Analytics {
  return {
    ...a,
    extended: false,
    daily: a.daily.map((d) => ({
      day: d.day, minutes: d.minutes, calls: d.calls,
      stt_min: 0, tts_min: 0, live_min: 0, stt_requests: 0, tts_requests: 0, errors: 0, rejected: 0,
    })),
    heatmap: a.heatmap.map((h) => ({ ...h, requests: 0 })),
    licenses: a.licenses.map((l) => ({
      ...l,
      month_stt_min: 0, month_tts_min: 0, month_live_min: 0,
      month_requests: 0, month_errors: 0, month_rejected: 0, month_peak_inflight: 0,
      last_mtd_requests: 0, last_mtd_errors: 0, last_month_requests: 0,
    })),
  };
}

/** One point per day from `first`, zero where nothing was used. */
function fillDays(first: string, days: number, rows: DailyPoint[]): DailyPoint[] {
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const [y, m, d] = first.split("-").map(Number);
  const out: DailyPoint[] = [];
  for (let i = 0; i < days; i++) {
    const day = new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10);
    out.push(byDay.get(day) ?? { day, stt_min: 0, tts_min: 0, stt_requests: 0, tts_requests: 0, errors: 0, rejected: 0, live_min: 0, calls: 0, minutes: 0 });
  }
  return out;
}
