"use client";

// IVR Console's shell: sidebar, header, routing (#hash), shared data.
// Signing in is enforced on the server (proxy.ts + every API route). An admin
// sees everything; a company account sees its own dashboard, talk-time limit,
// voice and account only (the API refuses it anything else, whatever this page shows).
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";

import CompaniesPage from "@/components/companies-page";
import CompanyDetail from "@/components/company-detail";
import DashboardPage from "@/components/dashboard-page";
import { FleetProvider, useFleet } from "@/components/fleet-context";
import FleetPage from "@/components/fleet-page";
import GpuPage from "@/components/gpu-page";
import { Header } from "@/components/header";
import { HubContext, licenseApi, parseRoute, routeHash, type Hub, type Route } from "@/components/hub-context";
import { Activity, Box, Building, Check, Clock, Copy, Key, LayoutDashboard, Lock, Mic, Server, Settings, X } from "@/components/icons";
import LicencesPage from "@/components/licences-page";
import CompanySettingsPage, { AccountPage, TalkTimePage, VoicePage } from "@/components/settings-pages";
import NewLicensePage from "@/components/new-license-page";
import PackagesPage from "@/components/packages-page";
import { Button, ConfirmDialog, Spinner, cx, type ConfirmOptions } from "@/components/ui";
import { DEFAULT_PACKAGE, DEFAULT_PACKAGES, type Package } from "@/lib/packages";
import type { Client, ViewerInfo } from "@/lib/types";
import { licenceChangeTiming } from "@/lib/voice-rules";

const TITLES: Record<Route["page"], { title: string; subtitle: string }> = {
  dashboard: { title: "Dashboard", subtitle: "Speech usage, customers and GPU health at a glance" },
  companies: { title: "Companies", subtitle: "Every company, its package, lines and this month's calls and minutes" },
  company: { title: "Company", subtitle: "" },
  new: { title: "New licence", subtitle: "Create an API key for a company" },
  packages: { title: "Packages", subtitle: "Calls, minutes and calls at once in each subscription package" },
  gpus: { title: "GPU performance", subtitle: "Health, traffic, latency and resources of every GPU" },
  fleet: { title: "GPU fleet", subtitle: "Add, deploy, drain and remove GPU servers" },
  settings: { title: "Company settings", subtitle: "Package, voice pipeline, voice and daily talk time, one company at a time" },
  licences: { title: "Licences & sign-in", subtitle: "Each company's licence key, status and IVR Console sign-in" },
  // Company-account pages (titled in the shell).
  limits: { title: "Talk-time limit", subtitle: "" },
  voice: { title: "Voice", subtitle: "" },
  account: { title: "Account", subtitle: "" },
};

/** Pages a company account may open; anything else shows its dashboard. */
const COMPANY_PAGES: Route["page"][] = ["dashboard", "limits", "voice", "account"];

export default function App() {
  const router = useRouter();
  const [viewer, setViewer] = useState<ViewerInfo | null>(null);

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((me) => (me ? setViewer(me) : router.replace("/login")))
      .catch(() => router.replace("/login"));
  }, [router]);

  if (!viewer) {
    return (
      <div className="min-h-viewport bg-canvas flex items-center justify-center text-ink-3" aria-busy="true">
        <Spinner size={18} />
      </div>
    );
  }
  // The GPU fleet is Chakra Labs' own: a company account never asks for it.
  return (
    <FleetProvider enabled={viewer.role === "admin"}>
      <Shell viewer={viewer} />
    </FleetProvider>
  );
}

function Shell({ viewer }: { viewer: ViewerInfo }) {
  const router = useRouter();
  const [route, setRoute] = useState<Route>({ page: "dashboard" });
  const [clients, setClients] = useState<Client[]>([]);
  const [clientsLoaded, setClientsLoaded] = useState(false);
  const [packages, setPackages] = useState<Package[]>(DEFAULT_PACKAGES);
  const [toastMsg, setToastMsg] = useState<{ text: string; tone: "error" | "success" } | null>(null);
  const [revealed, setRevealed] = useState<{ company: string; key: string } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [asking, setAsking] = useState<{ options: ConfirmOptions; answer: (yes: boolean) => void } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Routing on the URL hash, so a refresh or a shared link keeps the page.
  // Page changes run inside a view transition: the browser cross-fades the
  // page, and morphs elements that share a view-transition-name (a company or
  // licence card into its page's header card, and back).
  const routeRef = useRef<Route>({ page: "dashboard" });
  const show = useCallback((r: Route, animate: boolean) => {
    const before = routeRef.current;
    if (routeHash(before) === routeHash(r)) return;
    routeRef.current = r;
    // Opening or closing a GPU's panel stays on the same page: no page transition.
    const samePage = before.page === r.page && r.page === "gpus";
    const update = () => {
      flushSync(() => {
        setRoute(r);
        setMenuOpen(false);
      });
      if (!samePage) window.scrollTo({ top: 0 });
    };
    const doc = document as Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (animate && !samePage && !reduce && doc.startViewTransition) {
      // Into a company or a licence: slide forward. Out of one: slide back. Else cross-fade.
      const inside = (x: Route) => x.page === "company" || (x.page === "licences" && x.id != null);
      const nav = inside(r) && !inside(before) ? "forward" : inside(before) && !inside(r) ? "back" : "fade";
      document.documentElement.dataset.nav = nav;
      doc.startViewTransition(update).finished.finally(() => {
        delete document.documentElement.dataset.nav;
      });
    } else update();
  }, []);

  useEffect(() => {
    const sync = () => show(parseRoute(window.location.hash), true);
    const first = setTimeout(() => show(parseRoute(window.location.hash), false), 0);
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => {
      clearTimeout(first);
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, [show]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    const out = () => router.replace("/login");
    window.addEventListener("chakra:signed-out", out);
    return () => {
      clearInterval(t);
      window.removeEventListener("chakra:signed-out", out);
    };
  }, [router]);

  const navigate = useCallback(
    (r: Route) => {
      const hash = routeHash(r);
      if (window.location.hash !== hash) window.history.pushState(null, "", hash);
      show(r, true);
    },
    [show],
  );

  const toast = useCallback((text: string, tone: "error" | "success" = "error") => {
    setToastMsg({ text, tone });
    setTimeout(() => setToastMsg((t) => (t?.text === text ? null : t)), 3500);
  }, []);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setAsking({
          options,
          answer: (yes) => {
            setAsking(null);
            resolve(yes);
          },
        });
      }),
    [],
  );

  const reloadClients = useCallback(async (quiet = false) => {
    try {
      const rows = await licenseApi<Client[]>("GET", undefined, quiet);
      setClients(Array.isArray(rows) ? rows.map((r) => ({ ...r, month_minutes: Number(r.month_minutes) || 0 })) : []);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setClientsLoaded(true);
    }
  }, [toast]);

  useEffect(() => {
    const first = setTimeout(() => reloadClients(), 0);
    const t = setInterval(() => reloadClients(true), 120_000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [reloadClients]);

  // Keys are stored hashed, so a lost key can't be shown again: issue a new one.
  // The old key stops working (within a minute at the speech gateway).
  const rotateKey = useCallback(
    async (client: Client) => {
      const yes = await confirm({
        title: `Issue a new key for ${client.company_name}?`,
        body: "The company must put the new key in its app. The new key is shown once, right after this.",
        takes: `The current key stops working. ${licenceChangeTiming(client.voice_modes, true)}`,
        confirmLabel: "Rotate key",
        danger: true,
      });
      if (!yes) return false;
      try {
        const { token, ...row } = await licenseApi<Client & { token: string }>("PUT", { id: client.id, action: "rotate" });
        setClients((cs) => cs.map((c) => (c.id === client.id ? { ...c, ...row, month_minutes: c.month_minutes, last_activity: c.last_activity } : c)));
        setRevealed({ company: client.company_name, key: token });
        return true;
      } catch (e) {
        toast(`Could not rotate the key: ${(e as Error).message}`);
        return false;
      }
    },
    [toast, confirm],
  );

  const hub = useMemo<Hub>(
    () => ({ viewer, clients, clientsLoaded, setClients, reloadClients, packages, setPackages, navigate, toast, confirm, rotateKey, now }),
    [viewer, clients, clientsLoaded, reloadClients, packages, navigate, toast, confirm, rotateKey, now],
  );

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.replace("/login");
    router.refresh();
  };

  const isCompany = viewer.role === "company";
  const page: Route = isCompany && !COMPANY_PAGES.includes(route.page) ? { page: "dashboard" } : route;
  const company = page.page === "company" ? clients.find((c) => c.id === page.id) : undefined;
  const heading = isCompany
    ? page.page === "limits"
      ? { title: "Talk-time limit", subtitle: "How long each caller may talk per day" }
      : page.page === "voice"
        ? { title: "Voice", subtitle: "The voice your callers hear" }
      : page.page === "account"
        ? { title: "Account", subtitle: "Your licence and sign-in" }
        : { title: "Dashboard", subtitle: `${viewer.companyName}: calls, minutes and usage` }
    : page.page === "company"
      ? { title: company?.company_name ?? "Company", subtitle: company ? `${company.package_name || DEFAULT_PACKAGE} package` : "" }
      : TITLES[page.page];

  // The browser tab names the page: "Companies · Chakra Console".
  // Set again shortly after: on a fresh load Next.js writes the layout's
  // default title once the page has hydrated, over this one.
  useEffect(() => {
    const title = `${heading.title} · IVR Console`;
    document.title = title;
    const again = setTimeout(() => (document.title = title), 400);
    return () => clearTimeout(again);
  }, [heading.title]);

  return (
    <HubContext.Provider value={hub}>
      <div className="min-h-viewport bg-canvas text-ink flex">
        {/* Toast */}
        <div
          role="status"
          className={cx(
            "fixed top-5 right-5 z-[100] transition-all duration-300",
            toastMsg ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2 pointer-events-none",
          )}
        >
          {toastMsg && (
            <div
              className={cx(
                "px-4 py-3 rounded-xl border shadow-2xl text-[13px] font-medium bg-panel-2 max-w-sm",
                toastMsg.tone === "error" ? "border-critical/40 text-critical" : "border-good/40 text-good",
              )}
            >
              {toastMsg.text}
            </div>
          )}
        </div>

        <Sidebar route={page} viewer={viewer} open={menuOpen} onClose={() => setMenuOpen(false)} />

        <main className="flex-1 min-w-0 flex flex-col">
          <Header
            title={heading.title}
            subtitle={heading.subtitle}
            viewer={viewer}
            onLogout={logout}
            onOpenGpu={(node) => navigate({ page: "gpus", node })}
            onMenu={() => setMenuOpen(true)}
          />
          <div className="flex-1 px-4 md:px-8 py-6">
            {/* Keyed per page, so each page fades in when opened. */}
            <div
              key={page.page === "company" ? `company-${page.id}` : page.page === "licences" ? `licences-${page.id ?? "all"}` : page.page}
              className="max-w-[1440px] mx-auto page-in"
              style={{ viewTransitionName: "page" }}
            >
              {isCompany ? (
                <>
                  {page.page === "dashboard" && <CompanyDetail id={viewer.licenseId} companyView />}
                  {page.page === "limits" && <TalkTimePage />}
                  {page.page === "voice" && <VoicePage />}
                  {page.page === "account" && <AccountPage />}
                </>
              ) : (
                <>
                  {page.page === "dashboard" && <DashboardPage />}
                  {page.page === "companies" && <CompaniesPage />}
                  {page.page === "company" && <CompanyDetail id={page.id} />}
                  {page.page === "settings" && <CompanySettingsPage id={page.id} />}
                  {page.page === "licences" && <LicencesPage id={page.id} />}
                  {page.page === "new" && <NewLicensePage />}
                  {page.page === "packages" && <PackagesPage />}
                  {page.page === "gpus" && <GpuPage node={page.node} />}
                  {page.page === "fleet" && <FleetPage />}
                </>
              )}
            </div>
          </div>
        </main>

        {asking && <ConfirmDialog options={asking.options} onAnswer={asking.answer} />}
        {revealed && <KeyDialog company={revealed.company} keyValue={revealed.key} onClose={() => setRevealed(null)} />}
      </div>
    </HubContext.Provider>
  );
}

function Sidebar({ route, viewer, open, onClose }: { route: Route; viewer: ViewerInfo; open: boolean; onClose: () => void }) {
  const { alerts, loaded } = useFleet();
  const down = alerts.filter((a) => a.assessment.level === "down").length;
  const peak = alerts.filter((a) => a.assessment.level === "peak").length;
  const active = route.page === "company" ? "companies" : route.page;
  const isAdmin = viewer.role === "admin";

  type Group = { label: string; items: { page: Route["page"]; label: string; icon: ReactNode; badge?: ReactNode }[] };
  const companyGroups: Group[] = [
    { label: "Overview", items: [{ page: "dashboard", label: "Dashboard", icon: <LayoutDashboard size={16} /> }] },
    {
      label: "Settings",
      items: [
        { page: "limits", label: "Talk-time limit", icon: <Clock size={16} /> },
        { page: "voice", label: "Voice", icon: <Mic size={16} /> },
        { page: "account", label: "Account", icon: <Lock size={16} /> },
      ],
    },
  ];
  const adminGroups: Group[] = [
    { label: "Overview", items: [{ page: "dashboard", label: "Dashboard", icon: <LayoutDashboard size={16} /> }] },
    {
      label: "Customers",
      items: [
        { page: "companies", label: "Companies", icon: <Building size={16} /> },
        { page: "settings", label: "Company settings", icon: <Settings size={16} /> },
        { page: "licences", label: "Licences & sign-in", icon: <Key size={16} /> },
        { page: "packages", label: "Packages", icon: <Box size={16} /> },
      ],
    },
    {
      label: "GPUs",
      items: [
        {
          page: "gpus",
          label: "GPU performance",
          icon: <Activity size={16} />,
          badge: down ? (
            <span className="px-1.5 rounded bg-critical text-white text-[10px] font-bold">{down}</span>
          ) : peak ? (
            <span className="px-1.5 rounded bg-warning text-black text-[10px] font-bold">{peak}</span>
          ) : null,
        },
        { page: "fleet", label: "GPU fleet", icon: <Server size={16} /> },
      ],
    },
  ];
  const groups = isAdmin ? adminGroups : companyGroups;

  return (
    <>
      {open && <div className="fixed inset-0 bg-black/60 z-40 md:hidden" onClick={onClose} />}
      <aside
        className={cx(
          "w-[248px] shrink-0 bg-canvas border-r border-line flex flex-col h-viewport z-50",
          "fixed md:sticky top-0 transition-transform md:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="relative px-5 pt-8 pb-5 flex flex-col items-center">
          <Image src="/chakra-labs-logo.png" alt="Chakra Labs" width={170} height={48} className="w-auto h-10 object-contain" priority />
          <span className="text-[10px] font-semibold uppercase tracking-[0.24em] text-ink-3 mt-1.5">IVR Console</span>
          <button onClick={onClose} className="md:hidden absolute right-4 top-4 text-ink-3 hover:text-ink" aria-label="Close menu">
            <X size={18} />
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto custom-scrollbar px-3 pt-2 pb-5 space-y-6">
          {groups.map((g) => (
            <div key={g.label}>
              <div className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-3">{g.label}</div>
              <div className="space-y-0.5">
                {g.items.map((it) => (
                  <a
                    key={it.page}
                    href={`#${it.page}`}
                    aria-current={active === it.page ? "page" : undefined}
                    className={cx(
                      "flex items-center gap-3 h-9 px-3 rounded-lg text-[13px] font-medium transition-colors",
                      active === it.page ? "bg-panel-3 text-ink" : "text-ink-2 hover:text-ink hover:bg-white/[0.03]",
                    )}
                  >
                    <span className={active === it.page ? "text-accent" : "text-ink-3"}>{it.icon}</span>
                    <span className="flex-1">{it.label}</span>
                    {it.badge}
                  </a>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* "Ask Chakra AI" card: hidden with the header's Ask AI button until it does something.
        <div className="p-4 border-t border-line">
          <button className="w-full rounded-xl p-4 bg-panel-2 border border-line text-left">
            <Sparkles className="text-accent mb-1" size={18} />
            <span className="block font-semibold text-sm text-ink">Ask Chakra AI</span>
            <span className="block text-[10px] text-ink-3">Get insights from your licenses</span>
          </button>
        </div>
        */}

        {isAdmin && (
        <>
        <div className="px-3 pt-3">
          <a
            href="#new"
            aria-current={active === "new" ? "page" : undefined}
            className="h-10 w-full rounded-xl bg-accent text-accent-ink text-[13px] font-semibold flex items-center justify-center gap-2 hover:bg-accent/85 transition-colors"
          >
            <Key size={15} /> New licence
          </a>
        </div>
        <a href="#gpus" className="m-3 p-3 rounded-xl border border-line bg-panel-2 flex items-center gap-3 hover:border-line-strong transition-colors">
          <span
            className={cx(
              "w-2 h-2 rounded-full shrink-0",
              !loaded ? "bg-ink-3" : down ? "bg-critical pulse-critical" : peak ? "bg-warning" : "bg-good",
            )}
          />
          <span className="text-[12px] text-ink-2 leading-tight">
            {!loaded ? "Checking GPUs…" : down ? `${down} GPU${down > 1 ? "s" : ""} down` : peak ? `${peak} GPU${peak > 1 ? "s" : ""} at peak` : "All GPUs healthy"}
          </span>
        </a>
        </>
        )}
        {!isAdmin && (
          <div className="m-3 p-3 rounded-xl border border-line bg-panel-2">
            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-3">Company</div>
            <div className="text-[13px] text-ink font-medium truncate mt-0.5">{viewer.companyName}</div>
          </div>
        )}
      </aside>
    </>
  );
}

function KeyDialog({ company, keyValue, onClose }: { company: string; keyValue: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(keyValue).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[90] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="New API key">
      <div className="w-full max-w-lg bg-panel-2 border border-line-strong rounded-2xl p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-[16px] font-semibold text-ink">New API key for {company}</h2>
            <p className="text-[12px] text-ink-3 mt-1">The old key stops working within a minute.</p>
          </div>
          <button onClick={onClose} className="text-ink-3 hover:text-ink" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="font-mono text-[13px] text-ink break-all bg-canvas border border-line rounded-xl p-4 select-all">{keyValue}</div>
        <p className="text-[12px] text-warning mt-3">
          Copy it now and send it to the company securely. Keys are stored only as a hash, so this is the only time it can be shown.
        </p>
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="primary" onClick={copy}>
            {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy key</>}
          </Button>
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>
    </div>
  );
}
