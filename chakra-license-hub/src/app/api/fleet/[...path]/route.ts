import type { NextRequest } from "next/server";

import { currentViewer, forbidden, unauthorized } from "@/lib/auth";

// The GPU Fleet tab talks to the fleet controller through this route, so the
// controller's ADMIN_API_TOKEN stays on the server and only signed-in admins
// reach it (never company accounts). Only the operations the UI uses are let through.
//
//   FLEET_CONTROLLER_URL   e.g. http://controller:8081 (the compose network)
//   FLEET_ADMIN_TOKEN      the controller's ADMIN_API_TOKEN

const ALLOWED: [string, RegExp][] = [
  ["GET", /^nodes$/],
  ["POST", /^nodes$/],
  ["POST", /^nodes\/register$/],
  ["POST", /^nodes\/\d+\/(preflight|deploy|drain|activate)$/],
  ["DELETE", /^nodes\/\d+$/],
  ["GET", /^deployments$/],
  ["GET", /^deployments\/\d+$/],
  ["GET", /^capacity$/],
  ["GET", /^usage$/],
  ["GET", /^metrics$/],
  ["GET", /^ssh-public-key$/],
];

async function forward(request: NextRequest, ctx: RouteContext<"/api/fleet/[...path]">) {
  const viewer = await currentViewer();
  if (!viewer) return unauthorized();
  // The GPU fleet is Chakra Labs' own: never shown to a company account.
  if (viewer.role !== "admin") return forbidden();

  const base = process.env.FLEET_CONTROLLER_URL?.replace(/\/+$/, "");
  const token = process.env.FLEET_ADMIN_TOKEN;
  if (!base || !token) {
    return Response.json({ error: "The fleet controller is not configured on this server." }, { status: 503 });
  }

  const { path } = await ctx.params;
  const sub = path.join("/");
  if (!ALLOWED.some(([method, re]) => method === request.method && re.test(sub))) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const res = await fetch(`${base}/fleet/${sub}${request.nextUrl.search}`, {
      method: request.method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: request.method === "POST" ? await request.text() : undefined,
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
    return new Response(await res.text(), {
      status: res.status,
      headers: { "Content-Type": res.headers.get("content-type") ?? "application/json" },
    });
  } catch (error) {
    console.error("fleet controller unreachable:", error);
    return Response.json({ error: "The fleet controller is unreachable." }, { status: 502 });
  }
}

export const GET = forward;
export const POST = forward;
export const DELETE = forward;
