// Company accounts: one sign-in per licence, so a customer can open IVR Console
// and see only its own company. Created and reset by an admin (who shares the
// credentials with the company); the company can change its own password.
//
// Passwords are scrypt hashes (lib/password.ts), the same as admins'. Admins
// themselves stay in ADMIN_USERS (lib/auth.ts), never in this table.
import { MAX_PASSWORD, MIN_PASSWORD } from "./account-rules";
import { pool } from "./db";

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS console_users (
    id                  SERIAL PRIMARY KEY,
    license_id          INTEGER NOT NULL UNIQUE REFERENCES licenses(id) ON DELETE CASCADE,
    email               TEXT NOT NULL UNIQUE,
    password_hash       TEXT NOT NULL,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    password_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at       TIMESTAMPTZ
)`;

let ready: Promise<void> | null = null;

/** Create the table on first use (init_db.py also does, at deploy). */
export function ensureTable(): Promise<void> {
  if (!pool) return Promise.reject(new Error("DATABASE_URL is not configured"));
  ready ??= pool.query(SCHEMA).then(
    () => undefined,
    (e) => {
      ready = null;
      throw e;
    },
  );
  return ready;
}

export type ConsoleUser = {
  id: number;
  license_id: number;
  email: string;
  password_hash: string;
  is_active: boolean;
  created_at: Date;
  password_changed_at: Date;
  last_login_at: Date | null;
};

/** What the hub shows about an account (never the hash). */
export type ConsoleUserView = {
  license_id: number;
  email: string;
  is_active: boolean;
  created_at: string;
  password_changed_at: string;
  last_login_at: string | null;
};

export function view(u: ConsoleUser): ConsoleUserView {
  return {
    license_id: u.license_id,
    email: u.email,
    is_active: u.is_active,
    created_at: u.created_at.toISOString(),
    password_changed_at: u.password_changed_at.toISOString(),
    last_login_at: u.last_login_at ? u.last_login_at.toISOString() : null,
  };
}

/** The password stamp a session carries (milliseconds), see lib/session.ts. */
export function passwordVersion(u: Pick<ConsoleUser, "password_changed_at">): number {
  return u.password_changed_at.getTime();
}

export async function byEmail(email: string): Promise<ConsoleUser | null> {
  await ensureTable();
  const { rows } = await pool!.query("SELECT * FROM console_users WHERE email = $1", [email]);
  return (rows[0] as ConsoleUser) ?? null;
}

export async function byId(id: number): Promise<ConsoleUser | null> {
  await ensureTable();
  const { rows } = await pool!.query("SELECT * FROM console_users WHERE id = $1", [id]);
  return (rows[0] as ConsoleUser) ?? null;
}

export async function byLicense(licenseId: number): Promise<ConsoleUser | null> {
  await ensureTable();
  const { rows } = await pool!.query("SELECT * FROM console_users WHERE license_id = $1", [licenseId]);
  return (rows[0] as ConsoleUser) ?? null;
}


/** Why a new password is refused, or null when it is acceptable. */
export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD) return `The password needs at least ${MIN_PASSWORD} characters.`;
  if (password.length > MAX_PASSWORD) return "The password is too long.";
  return null;
}

/** A normalised email, or null when it does not look like one. */
export function cleanEmail(value: unknown): string | null {
  const email = String(value ?? "").trim().toLowerCase();
  return email.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}
