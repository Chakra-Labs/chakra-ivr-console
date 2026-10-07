// Subscription packages: the October 2026 price sheet. Names and line counts
// must match chakra-gpu-fleet/fleet/packages.yaml: the fleet sizes its GPUs from
// each licence's package (1 STT GPU per 14 lines, 1 TTS GPU per 7 lines).
//
// `maxMinutes` is the package's monthly minute allowance and `calls` the calls
// it includes; usage resets on the 1st of each month (Sri Lanka time). `lines`
// is calls at once. `priceLkr` (per month) is shown to admins only.

export interface Package {
  id: string;
  name: string;
  maxMinutes: number;
  lines: number;
  calls?: number;
  priceLkr?: number;
  /** A special offer, not on the public sheet. */
  special?: boolean;
}

export const DEFAULT_PACKAGE = "Starter";

export const DEFAULT_PACKAGES: Package[] = [
  { id: "1", name: "Starter", calls: 15000, lines: 7, maxMinutes: 75000, priceLkr: 418700 },
  // 10 lines = 1 STT + 2 TTS GPUs.
  { id: "2", name: "Govimithuru Special Starter", calls: 17000, lines: 10, maxMinutes: 50000, priceLkr: 360000, special: true },
  { id: "3", name: "Growth", calls: 25000, lines: 14, maxMinutes: 125000, priceLkr: 694000 },
  { id: "4", name: "Professional", calls: 40000, lines: 14, maxMinutes: 200000, priceLkr: 1066400 },
  { id: "5", name: "Business", calls: 75000, lines: 21, maxMinutes: 375000, priceLkr: 1882500 },
  { id: "6", name: "Business Pro", calls: 100000, lines: 28, maxMinutes: 500000, priceLkr: 2398000 },
  { id: "7", name: "Enterprise", calls: 200000, lines: 98, maxMinutes: 2000000, priceLkr: 4499000 },
  { id: "8", name: "Enterprise Plus", calls: 500000, lines: 217, maxMinutes: 5000000, priceLkr: 9999000 },
  { id: "9", name: "Enterprise Scale", calls: 1000000, lines: 392, maxMinutes: 10000000, priceLkr: 14999000 },
];

// Names from the earlier price sheet that no package uses now (same as
// packages.yaml). Its other names mean different packages on this sheet.
const ALIASES: Record<string, string> = {
  essential: "Starter",
  standard: "Growth",
  "business plus": "Business",
  national: "Enterprise Plus",
  "national plus": "Enterprise Scale",
};

// What one GPU carries, from the 28 Sep 2026 two-A4000 benchmark.
export const LINES_PER_GPU = { stt: 14, tts: 7 } as const;
// In-flight requests the gateway allows per line (INFLIGHT_PER_LINE).
export const INFLIGHT_PER_LINE = 2;
export const DEFAULT_LINES = 7;

export function findPackage(packages: Package[], name?: string | null): Package | undefined {
  if (!name) return undefined;
  const wanted = name.trim().toLowerCase();
  const target = (ALIASES[wanted] ?? wanted).toLowerCase();
  return packages.find((p) => p.name.toLowerCase() === target);
}

export function packageQuota(packages: Package[], name?: string | null): number {
  return findPackage(packages, name)?.maxMinutes ?? 75000;
}

export function packageLines(packages: Package[], name?: string | null): number {
  return findPackage(packages, name)?.lines ?? DEFAULT_LINES;
}

export function gpusFor(lines: number) {
  return {
    stt: lines ? Math.ceil(lines / LINES_PER_GPU.stt) : 0,
    tts: lines ? Math.ceil(lines / LINES_PER_GPU.tts) : 0,
  };
}
