// One Postgres pool for every API route (licences, analytics). The admin
// database also holds the fleet's tables (speech_usage, fleet_*), written by the
// speech gateway in chakra-gpu-fleet.
import { Pool } from "pg";

const globalForPool = globalThis as unknown as { chakraPool?: Pool | null };

export const pool: Pool | null =
  globalForPool.chakraPool ??
  (globalForPool.chakraPool = process.env.DATABASE_URL
    ? new Pool({ connectionString: process.env.DATABASE_URL, max: 5 })
    : null);

// Day and month boundaries follow Sri Lanka time, not UTC.
export const TIME_ZONE = "Asia/Colombo";

export type UsageSchema = {
  /** `speech_usage` exists (the gateway creates it on first start). */
  table: boolean;
  /** It has the error/peak columns (gateway from 2026-10-03 on). */
  extended: boolean;
};

let known: UsageSchema | null = null;

export async function usageSchema(): Promise<UsageSchema> {
  if (known?.extended || !pool) return known ?? { table: false, extended: false };
  const { rows } = await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'speech_usage'",
  );
  const cols = new Set(rows.map((r) => r.column_name as string));
  const schema = { table: cols.size > 0, extended: cols.has("peak_inflight") };
  // Cache only the final state, so a gateway upgrade is picked up without a restart.
  if (schema.extended) known = schema;
  return schema;
}

let callUsageKnown = false;

/** `call_usage` exists (the license server creates it on start, 2026-10-03 on). */
export async function hasCallUsage(): Promise<boolean> {
  if (callUsageKnown || !pool) return callUsageKnown;
  const { rows } = await pool.query("SELECT to_regclass('call_usage') IS NOT NULL AS ok");
  callUsageKnown = Boolean(rows[0]?.ok);
  return callUsageKnown;
}

// Calls that never reach the speech gateway (Gemini Live: speech runs at the
// client's provider) are metered only as call seconds in `call_usage`, which
// chakra-ivr-core reports after every call. Their call minutes are added to the
// licence's speech minutes; Chakra Voice calls are already in `speech_usage`.
export const OFF_GATEWAY = "pipeline <> 'chakra'";
