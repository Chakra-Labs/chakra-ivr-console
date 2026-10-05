import { cookies } from "next/headers";

import { currentViewer, forbidden, unauthorized } from "@/lib/auth";
import { byId, passwordProblem, passwordVersion } from "@/lib/console-users";
import { pool } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";
import { createSession, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/session";

// A company account changes its own password (admins' passwords live in
// ADMIN_USERS on the server). Other sessions of the account are signed out;
// this one is re-issued so the user stays signed in.
export async function POST(request: Request) {
  const viewer = await currentViewer();
  if (!viewer) return unauthorized();
  if (viewer.role !== "company") return forbidden();

  let current = "";
  let next = "";
  try {
    const body = await request.json();
    current = String(body.currentPassword ?? "");
    next = String(body.newPassword ?? "");
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  const problem = passwordProblem(next);
  if (problem) return Response.json({ error: problem }, { status: 400 });

  const user = await byId(viewer.userId);
  if (!user || !(await verifyPassword(current, user.password_hash))) {
    return Response.json({ error: "The current password is not correct." }, { status: 400 });
  }
  const { rows } = await pool!.query(
    "UPDATE console_users SET password_hash = $1, password_changed_at = now() WHERE id = $2 RETURNING password_changed_at",
    [await hashPassword(next), user.id],
  );
  const https = request.headers.get("x-forwarded-proto") === "https" || new URL(request.url).protocol === "https:";
  (await cookies()).set(
    SESSION_COOKIE,
    await createSession(user.email, { uid: user.id, pv: passwordVersion(rows[0]) }),
    { httpOnly: true, secure: https, sameSite: "strict", path: "/", maxAge: SESSION_MAX_AGE },
  );
  return Response.json({ ok: true });
}
