// Who may use IVR Console, and the checks every API route runs.
//
// Admins come from the server environment only:
//   ADMIN_USERS=admin@chakralabs.lk=scrypt:16384:8:1:<salt>:<hash>,other@chakralabs.lk=scrypt:...
// (make a hash with `pnpm hash-password`). No admins configured = no admin can sign in.
//
// Company accounts live in the database (lib/console-users.ts): one per licence,
// seeing only that licence. Every route decides what a company may do; the
// default is nothing (`currentAdmin` returns null for them).
import { cookies } from "next/headers";

import { byId, passwordVersion } from "./console-users";
import { pool } from "./db";
import { readSession, SESSION_COOKIE } from "./session";

export function adminUsers(): Map<string, string> {
  const users = new Map<string, string>();
  for (const entry of (process.env.ADMIN_USERS ?? "").split(",")) {
    const i = entry.indexOf("=");
    if (i <= 0) continue;
    const email = entry.slice(0, i).trim().toLowerCase();
    const hash = entry.slice(i + 1).trim();
    if (email && hash.startsWith("scrypt:")) users.set(email, hash);
  }
  return users;
}

export type Viewer =
  | { role: "admin"; email: string }
  | { role: "company"; email: string; userId: number; licenseId: number; companyName: string };

/** Who is signed in, or null. Re-checked on every request: an admin removed
 * from ADMIN_USERS, or a company account that is switched off, deleted or has
 * its password reset, is locked out at once, not when the cookie expires. */
export async function currentViewer(): Promise<Viewer | null> {
  const session = await readSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) return null;
  if (session.role !== "company") {
    return adminUsers().has(session.sub) ? { role: "admin", email: session.sub } : null;
  }
  if (!pool || typeof session.uid !== "number") return null;
  try {
    const user = await byId(session.uid);
    if (!user || !user.is_active || user.email !== session.sub || passwordVersion(user) !== session.pv) return null;
    const { rows } = await pool.query("SELECT company_name FROM licenses WHERE id = $1", [user.license_id]);
    if (!rows[0]) return null;
    return {
      role: "company",
      email: user.email,
      userId: user.id,
      licenseId: user.license_id,
      companyName: String(rows[0].company_name),
    };
  } catch (error) {
    console.error("Could not check the company session:", error);
    return null;
  }
}

/** The signed-in admin's email, or null (also for a company account). */
export async function currentAdmin(): Promise<string | null> {
  const viewer = await currentViewer();
  return viewer?.role === "admin" ? viewer.email : null;
}

export function unauthorized(): Response {
  return Response.json({ error: "not signed in" }, { status: 401 });
}

export function forbidden(): Response {
  return Response.json({ error: "Not allowed for this account" }, { status: 403 });
}
