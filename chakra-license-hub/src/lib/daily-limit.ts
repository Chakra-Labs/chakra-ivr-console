// Daily talk time per caller. chakra-ivr-core (0.5+) reads it from the signed
// licence check (`daily_limit_seconds`, `limit_warning_seconds`,
// `agent_daily_limits`) and enforces it on every call: the caller's calls today
// are summed, a caller who is out of time is told to call back tomorrow, and a
// call is warned and then ended when the time runs out. 0 = no limit.

/** Bounds the hub accepts: a day at most, and a warning shorter than ten minutes. */
export const MAX_LIMIT_MINUTES = 1440;
export const MAX_WARNING_SECONDS = 600;

/** A whole number within [0, max], or null when the text is not one. */
export function wholeNumber(value: unknown, max: number): number | null {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  return n <= max ? n : null;
}

/** "agent = minutes" lines → a clean map; unreadable lines are dropped. */
export function parseAgentLimits(text: string): Record<string, number> {
  const limits: Record<string, number> = {};
  for (const line of text.split(/\r?\n/)) {
    const [agent, minutes] = line.split("=").map((s) => s.trim());
    const n = wholeNumber(minutes, MAX_LIMIT_MINUTES);
    if (agent && n !== null) limits[agent.slice(0, 120)] = n;
  }
  return limits;
}

export function formatAgentLimits(limits: Record<string, number> | null | undefined): string {
  return Object.entries(limits ?? {})
    .map(([agent, minutes]) => `${agent} = ${minutes}`)
    .join("\n");
}

/** "15 min per caller, warned 60 s before" / "No limit". */
export function describeLimit(minutes: number | null | undefined, warning: number | null | undefined): string {
  if (!minutes) return "No limit";
  return warning ? `${minutes} min per caller a day · warned ${warning} s before the end` : `${minutes} min per caller a day`;
}
