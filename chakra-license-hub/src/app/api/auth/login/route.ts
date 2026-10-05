import { cookies } from "next/headers";
import type { NextRequest } from "next/server";

import { adminUsers } from "@/lib/auth";
import { byEmail, passwordVersion } from "@/lib/console-users";
import { pool } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";
import { createSession, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/session";

// Brute-force brake: 10 failed attempts per client IP per 15 minutes.
// In-memory, which is right for the single admin container this runs as.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;
const failures = new Map<string, { count: number; since: number }>();

function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
}

function blocked(ip: string): boolean {
  const f = failures.get(ip);
  if (!f) return false;
  if (Date.now() - f.since > WINDOW_MS) {
    failures.delete(ip);
    return false;
  }
  return f.count >= MAX_FAILURES;
}

function recordFailure(ip: string): void {
  const f = failures.get(ip);
  if (!f || Date.now() - f.since > WINDOW_MS) failures.set(ip, { count: 1, since: Date.now() });
  else f.count += 1;
  if (failures.size > 10_000) failures.clear();
}

// Hash compared against when the email is unknown, so a wrong email and a wrong
// password take the same time (no telling which emails have an account).
const decoyHash = hashPassword("decoy-password-never-valid");

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  if (blocked(ip)) {
    return Response.json({ error: "Too many attempts. Try again in 15 minutes." }, { status: 429 });
  }

  let email = "";
  let password = "";
  try {
    const body = await req.json();
    email = String(body.email ?? "").trim().toLowerCase();
    password = String(body.password ?? "");
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  // Admins first (ADMIN_USERS), then company accounts (one per licence).
  const adminHash = adminUsers().get(email);
  let company: Awaited<ReturnType<typeof byEmail>> = null;
  if (!adminHash && pool && email) {
    try {
      company = await byEmail(email);
    } catch (error) {
      console.error("Company account lookup failed:", error);
    }
  }
  const stored = adminHash ?? (company?.is_active ? company.password_hash : undefined);
  const ok = await verifyPassword(password, stored ?? (await decoyHash));
  if (!stored || !ok || password.length > 256) {
    recordFailure(ip);
    return Response.json({ error: "Invalid email or password." }, { status: 401 });
  }

  failures.delete(ip);
  const session = adminHash
    ? await createSession(email)
    : await createSession(email, { uid: company!.id, pv: passwordVersion(company!) });
  if (!adminHash) {
    pool!.query("UPDATE console_users SET last_login_at = now() WHERE id = $1", [company!.id]).catch(() => {});
  }
  // Secure whenever the browser is on HTTPS (Caddy sets X-Forwarded-Proto in
  // production); a plain-http dev server would otherwise never get it back.
  const https = req.nextUrl.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
  (await cookies()).set(SESSION_COOKIE, session, {
    httpOnly: true,
    secure: https,
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return Response.json({ email, role: adminHash ? "admin" : "company" });
}
