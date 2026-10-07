"use client";

// Licences & sign-in (admins). A card per company: its licence key and status,
// and its IVR Console sign-in. Opening one shows the cards that manage them
// (from settings-pages.tsx): customer sign-in, licence status & key, delete.
import { useEffect, useState } from "react";

import { signedOut, useHub } from "./hub-context";
import { ArrowLeft, ChevronRight, Key, Plus, RefreshCw, Search, Settings, UserCheck } from "./icons";
import { ConsoleAccessCard, DangerCard, SettingsSkeleton, StatusKeyCard } from "./settings-pages";
import { Badge, Button, Card, Empty, KeyValue, Segmented, Skeleton, Spinner, inputClass } from "./ui";
import { ago, dateOnly } from "@/lib/format";
import { DEFAULT_PACKAGE } from "@/lib/packages";
import type { Client, ConsoleAccount } from "@/lib/types";

export default function LicencesPage({ id }: { id?: number }) {
  const { clients, clientsLoaded, navigate } = useHub();
  if (id == null) return <LicenceGrid />;
  if (!clientsLoaded) return <SettingsSkeleton />;
  const client = clients.find((c) => c.id === id);
  if (!client) {
    return (
      <div className="space-y-4">
        <Back onClick={() => navigate({ page: "licences" })} />
        <Empty>This licence no longer exists.</Empty>
      </div>
    );
  }
  return <LicenceDetail client={client} />;
}

function Back({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="inline-flex items-center gap-1.5 text-[13px] text-ink-3 hover:text-ink transition-colors">
      <ArrowLeft size={14} /> All licences
    </button>
  );
}

/** Every company's sign-in, by licence id (undefined while loading). */
function useAccounts(): Map<number, ConsoleAccount> | undefined {
  const { toast } = useHub();
  const [accounts, setAccounts] = useState<Map<number, ConsoleAccount>>();
  useEffect(() => {
    let live = true;
    fetch("/api/console-users", { cache: "no-store" })
      .then(async (res) => {
        if (res.status === 401) signedOut();
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as ConsoleAccount[];
      })
      .then((rows) => live && setAccounts(new Map(rows.map((a) => [a.license_id, a]))))
      .catch((e) => live && (setAccounts(new Map()), toast(`Could not load the sign-ins: ${(e as Error).message}`)));
    return () => {
      live = false;
    };
  }, [toast]);
  return accounts;
}

function LicenceGrid() {
  const { clients, clientsLoaded, navigate, rotateKey, now } = useHub();
  const accounts = useAccounts();
  const [query, setQuery] = useState("");
  const [show, setShow] = useState<"all" | "active" | "suspended" | "nosignin">("all");
  const [rotating, setRotating] = useState<number | null>(null);

  const shown = clients.filter(
    (c) =>
      (show === "all" ||
        (show === "active" && c.is_active) ||
        (show === "suspended" && !c.is_active) ||
        (show === "nosignin" && accounts !== undefined && !accounts.has(c.id))) &&
      (!query.trim() || c.company_name.toLowerCase().includes(query.trim().toLowerCase())),
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a company" aria-label="Find a company" className={`${inputClass} pl-9 w-64`} />
          </div>
          <Segmented
            label="Show"
            value={show}
            onChange={setShow}
            options={[
              { value: "all", label: `All ${clients.length}` },
              { value: "active", label: "Active" },
              { value: "suspended", label: "Suspended" },
              { value: "nosignin", label: "No sign-in" },
            ]}
          />
        </div>
        <Button variant="primary" onClick={() => navigate({ page: "new" })}>
          <Plus size={15} /> New licence
        </Button>
      </div>

      {!clientsLoaded ? (
        <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-panel border border-line rounded-2xl p-5 space-y-4">
              <Skeleton className="h-10 w-2/3" />
              <Skeleton className="h-[62px] rounded-xl" />
              <Skeleton className="h-[62px] rounded-xl" />
            </div>
          ))}
        </div>
      ) : shown.length === 0 ? (
        <Empty>{clients.length ? "No licence matches." : "No licences yet. Create one to add a company."}</Empty>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4">
          {shown.map((c) => {
            const account = accounts?.get(c.id);
            return (
              <article
                key={c.id}
                className="group bg-panel border border-line rounded-2xl p-5 flex flex-col gap-4 hover:border-line-strong hover:-translate-y-0.5 transition-[border-color,transform] duration-200 cursor-pointer"
                onClick={() => navigate({ page: "licences", id: c.id })}
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-panel-3 border border-line flex items-center justify-center shrink-0 text-ink-2">
                    <Key size={17} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-[15px] font-semibold text-ink truncate group-hover:text-accent transition-colors">{c.company_name}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge tone={c.is_active ? "good" : "critical"}>{c.is_active ? "Licence active" : "Licence suspended"}</Badge>
                    </div>
                  </div>
                  <ChevronRight size={16} className="text-ink-3 mt-1 group-hover:text-ink transition-colors" />
                </div>

                <div className="rounded-xl bg-panel-2 border border-line p-3">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="text-[11px] text-ink-3 inline-flex items-center gap-1.5">
                      <Key size={12} /> Licence key
                    </span>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={rotating === c.id}
                      onClick={async (e) => {
                        e.stopPropagation();
                        setRotating(c.id);
                        await rotateKey(c);
                        setRotating(null);
                      }}
                      title="Keys are stored hashed and shown only once. Rotate to issue a new one."
                    >
                      {rotating === c.id ? <Spinner size={12} /> : <RefreshCw size={12} />} {rotating === c.id ? "Rotating…" : "Rotate"}
                    </Button>
                  </div>
                  <div className="font-mono text-[12px] text-ink-2 truncate">{c.token_prefix ?? "chk_live_"}••••••••••••</div>
                </div>

                <div className="rounded-xl bg-panel-2 border border-line p-3">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="text-[11px] text-ink-3 inline-flex items-center gap-1.5">
                      <UserCheck size={12} /> IVR Console sign-in
                    </span>
                    {accounts === undefined ? (
                      <Skeleton className="h-4 w-16" />
                    ) : account ? (
                      <Badge tone={account.is_active ? "good" : "critical"}>{account.is_active ? "Can sign in" : "Switched off"}</Badge>
                    ) : (
                      <Badge tone="warning">Not set up</Badge>
                    )}
                  </div>
                  <div className="text-[12px] text-ink-2 truncate">
                    {accounts === undefined ? " " : account ? account.email : "The company has no sign-in yet"}
                  </div>
                </div>

                <div className="flex items-center justify-between text-[11px] text-ink-3 pt-1 border-t border-line">
                  <span className="pt-3">{account ? `Last sign-in ${account.last_login_at ? ago(account.last_login_at, now) : "never"}` : "Never signed in"}</span>
                  <span className="pt-3">Issued {dateOnly(c.created_at)}</span>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function LicenceDetail({ client }: { client: Client }) {
  const { navigate, now } = useHub();
  return (
    <div className="space-y-5">
      <Back onClick={() => navigate({ page: "licences" })} />

      <section className="bg-panel border border-line rounded-2xl p-5 flex flex-wrap items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-panel-3 border border-line flex items-center justify-center text-accent shrink-0">
          <Key size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-[20px] font-semibold text-ink truncate">{client.company_name}</h2>
          <div className="flex flex-wrap items-center gap-2 mt-1.5">
            <Badge tone={client.is_active ? "good" : "critical"}>{client.is_active ? "Licence active" : "Licence suspended"}</Badge>
            <span className="text-[12px] text-ink-3 font-mono">{client.token_prefix ?? "chk_live_"}…</span>
          </div>
        </div>
        <Button variant="ghost" onClick={() => navigate({ page: "company", id: client.id })}>
          View dashboard
        </Button>
        <Button onClick={() => navigate({ page: "settings", id: client.id })}>
          <Settings size={14} /> Company settings
        </Button>
      </section>

      <div key={client.id} className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        <div className="xl:col-span-7 space-y-4">
          <ConsoleAccessCard client={client} />
        </div>
        <div className="xl:col-span-5 space-y-4">
          <StatusKeyCard client={client} />
          <Card title="Licence details">
            <KeyValue label="Company">{client.company_name}</KeyValue>
            <KeyValue label="Package">{client.package_name || DEFAULT_PACKAGE}</KeyValue>
            <KeyValue label="Issued">{dateOnly(client.created_at)}</KeyValue>
            <KeyValue label="Last call activity">{ago(client.last_activity, now)}</KeyValue>
            <p className="text-[11px] text-ink-3 mt-3">
              The key goes in the company&apos;s app as CHAKRA_LICENSE_KEY. Package, voice and talk time are in Company settings.
            </p>
          </Card>
          <DangerCard client={client} />
        </div>
      </div>
    </div>
  );
}
