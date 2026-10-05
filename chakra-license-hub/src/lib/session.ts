// Signed sessions (admins and company accounts):
// `<base64url(payload)>.<base64url(HMAC-SHA256)>` in an HttpOnly cookie. Web Crypto only, so the same code runs in proxy.ts and in
// route handlers. The signing key is SESSION_SECRET (32+ characters).

export const SESSION_COOKIE = "chakra_admin_session";
export const SESSION_MAX_AGE = 12 * 60 * 60; // seconds

/** `sub` is the email. A company account's session also carries its account id
 * (`uid`) and the time its password was last set (`pv`): a reset changes `pv`,
 * which signs out every session made with the old password. */
export type Session = { sub: string; exp: number; role?: "company"; uid?: number; pv?: number };

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

let keyPromise: Promise<CryptoKey> | null = null;

function signingKey(): Promise<CryptoKey> {
  const secret = process.env.SESSION_SECRET ?? "";
  if (secret.length < 32) {
    throw new Error("SESSION_SECRET must be set to at least 32 characters");
  }
  keyPromise ??= crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  return keyPromise;
}

export async function createSession(email: string, company?: { uid: number; pv: number }): Promise<string> {
  const payload: Session = {
    sub: email,
    exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE,
    ...(company ? { role: "company" as const, uid: company.uid, pv: company.pv } : {}),
  };
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await signingKey(), enc.encode(body)));
  return `${body}.${b64url(sig)}`;
}

/** The session in a cookie value, or null if missing, forged, malformed or expired. */
export async function readSession(token: string | undefined | null): Promise<Session | null> {
  if (!token || token.length > 2048) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  try {
    // verify() compares in constant time.
    const ok = await crypto.subtle.verify("HMAC", await signingKey(), fromB64url(sig), enc.encode(body));
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(body))) as Session;
    if (typeof payload.sub !== "string" || typeof payload.exp !== "number") return null;
    return payload.exp > Date.now() / 1000 ? payload : null;
  } catch {
    return null;
  }
}
