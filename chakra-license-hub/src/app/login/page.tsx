"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Lock } from "@/components/icons";
import { Button, Spinner, inputClass } from "@/components/ui";

// One sign-in for Chakra Labs admins and for company accounts: the server
// decides which (api/auth/login), and the console shows each what it may see.
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [loginError, setLoginError] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setLoginError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        router.replace("/");
        router.refresh();
        return;
      }
      const body = await res.json().catch(() => ({}));
      setLoginError(body.error ?? "Sign-in failed.");
    } catch {
      setLoginError("Cannot reach the server.");
    }
    setLoading(false);
  };

  return (
    <div className="min-h-viewport bg-canvas text-ink flex flex-col items-center justify-center px-4 py-10 relative overflow-hidden isolate">
      {/* The glow behind the card (the console's colours; no background image). */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] max-w-[160vw] bg-indigo-500/[0.15] rounded-full blur-[120px] pointer-events-none -z-10" />
      <div className="absolute -top-24 -right-24 w-[600px] h-[600px] max-w-[120vw] bg-accent/[0.10] rounded-full blur-[120px] pointer-events-none -z-10" />
      <div className="w-full max-w-[400px]">
        <div className="flex flex-col items-center mb-8">
          <Image src="/chakra-labs-logo.png" alt="Chakra Labs" width={200} height={56} className="w-auto h-12 object-contain" priority />
          <span className="text-[10px] font-semibold uppercase tracking-[0.24em] text-ink-3 mt-2">IVR Console</span>
        </div>

        <div className="relative overflow-hidden bg-panel/80 backdrop-blur-md border border-line rounded-2xl p-7 shadow-2xl">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 via-accent to-indigo-500" />
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-panel-3 border border-line flex items-center justify-center text-accent shrink-0">
              <Lock size={17} />
            </div>
            <div>
              <h1 className="text-[17px] font-semibold text-ink leading-tight">Sign in</h1>
              <p className="text-[12px] text-ink-3">With the account Chakra Labs gave you</p>
            </div>
          </div>

          {loginError && (
            <div role="alert" className="mb-5 px-3 py-2.5 rounded-lg bg-critical/10 border border-critical/30 text-critical text-[13px]">
              {loginError}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-[12px] text-ink-2 mb-1.5" htmlFor="login-email">Email</label>
              <input
                id="login-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="username"
                autoFocus
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-[12px] text-ink-2 mb-1.5" htmlFor="login-password">Password</label>
              <input
                id="login-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className={inputClass}
              />
            </div>
            <Button type="submit" variant="primary" disabled={loading} className="w-full h-10 mt-2">
              {loading && <Spinner size={14} />} {loading ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </div>

        <p className="text-center text-[11px] text-ink-3 mt-6">Chakra Labs · IVR Console</p>
      </div>
    </div>
  );
}
