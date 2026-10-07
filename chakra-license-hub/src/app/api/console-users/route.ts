import { adminUsers, currentViewer, forbidden, unauthorized } from "@/lib/auth";
import { byEmail, byLicense, cleanEmail, ensureTable, passwordProblem, view } from "@/lib/console-users";
import { pool } from "@/lib/db";
import { hashPassword } from "@/lib/password";

// A company's IVR Console account, managed by an admin (admins only).
//
//   GET    /api/console-users?license=7   the account, or null
//   GET    /api/console-users             every account (for the licence cards)
//   PUT    { licenseId, email?, password?, isActive? }   create, or change any of these
//   DELETE { licenseId }                    remove the account
//
// Setting a password signs the company out everywhere (lib/session.ts `pv`).
// The password itself is never sent back: the admin shares what they typed.

/** Admins only: 401 without a session, 403 for a company account. */
async function refuseNonAdmin(): Promise<Response | null> {
  const viewer = await currentViewer();
  if (!viewer) return unauthorized();
  return viewer.role === "admin" ? null : forbidden();
}

function bad(error: string, status = 400): Response {
  return Response.json({ error }, { status });
}

export async function GET(request: Request) {
  const refused = await refuseNonAdmin();
  if (refused) return refused;
  if (!pool) return bad("DATABASE_URL is not configured", 500);
  const asked = new URL(request.url).searchParams.get("license");
  if (asked === null) {
    try {
      await ensureTable();
      const { rows } = await pool.query("SELECT * FROM console_users ORDER BY license_id");
      return Response.json(rows.map(view));
    } catch (error) {
      console.error("console-users GET:", error);
      return bad("Failed to load the accounts", 500);
    }
  }
  const licenseId = Number(asked);
  if (!Number.isInteger(licenseId)) return bad("license is required");
  try {
    const user = await byLicense(licenseId);
    return Response.json(user ? view(user) : null);
  } catch (error) {
    console.error("console-users GET:", error);
    return bad("Failed to load the account", 500);
  }
}

export async function PUT(request: Request) {
  const refused = await refuseNonAdmin();
  if (refused) return refused;
  if (!pool) return bad("DATABASE_URL is not configured", 500);
  let body: { licenseId?: unknown; email?: unknown; password?: unknown; isActive?: unknown };
  try {
    body = await request.json();
  } catch {
    return bad("Invalid request");
  }
  const licenseId = Number(body.licenseId);
  if (!Number.isInteger(licenseId)) return bad("licenseId is required");

  const email = body.email === undefined ? undefined : cleanEmail(body.email);
  if (email === null) return bad("Enter a valid email address.");
  if (email && adminUsers().has(email)) return bad("That email is an administrator's.");
  const password = body.password === undefined ? undefined : String(body.password);
  if (password !== undefined) {
    const problem = passwordProblem(password);
    if (problem) return bad(problem);
  }
  const isActive = body.isActive === undefined ? undefined : Boolean(body.isActive);

  try {
    await ensureTable();
    const { rows: licence } = await pool.query("SELECT id FROM licenses WHERE id = $1", [licenseId]);
    if (!licence[0]) return bad("No such licence", 404);
    if (email) {
      const taken = await byEmail(email);
      if (taken && taken.license_id !== licenseId) return bad("Another company already uses that email.");
    }

    const existing = await byLicense(licenseId);
    if (!existing) {
      if (!email || password === undefined) return bad("A new account needs an email and a password.");
      await pool.query(
        "INSERT INTO console_users (license_id, email, password_hash, is_active) VALUES ($1, $2, $3, $4)",
        [licenseId, email, await hashPassword(password), isActive ?? true],
      );
    } else {
      const sets: string[] = [];
      const values: unknown[] = [];
      if (email && email !== existing.email) {
        values.push(email);
        sets.push(`email = $${values.length}`);
        // A new sign-in name is a new credential: end sessions made with the old one.
        sets.push("password_changed_at = now()");
      }
      if (password !== undefined) {
        values.push(await hashPassword(password));
        sets.push(`password_hash = $${values.length}`);
        if (!sets.includes("password_changed_at = now()")) sets.push("password_changed_at = now()");
      }
      if (isActive !== undefined) {
        values.push(isActive);
        sets.push(`is_active = $${values.length}`);
      }
      if (sets.length) {
        values.push(licenseId);
        await pool.query(`UPDATE console_users SET ${sets.join(", ")} WHERE license_id = $${values.length}`, values);
      }
    }
    const user = await byLicense(licenseId);
    return Response.json(user ? view(user) : null);
  } catch (error) {
    console.error("console-users PUT:", error);
    return bad("Failed to save the account", 500);
  }
}

export async function DELETE(request: Request) {
  const refused = await refuseNonAdmin();
  if (refused) return refused;
  if (!pool) return bad("DATABASE_URL is not configured", 500);
  let licenseId: number;
  try {
    licenseId = Number((await request.json()).licenseId);
  } catch {
    return bad("Invalid request");
  }
  if (!Number.isInteger(licenseId)) return bad("licenseId is required");
  try {
    await ensureTable();
    await pool.query("DELETE FROM console_users WHERE license_id = $1", [licenseId]);
    return Response.json({ ok: true });
  } catch (error) {
    console.error("console-users DELETE:", error);
    return bad("Failed to remove the account", 500);
  }
}
