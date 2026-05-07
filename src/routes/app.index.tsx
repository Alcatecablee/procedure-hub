import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { PriorityBadge, StatusBadge } from "@/components/badges";

export const Route = createFileRoute("/app/")({
  component: Dashboard,
});

interface Stats {
  active: number;
  critical: number;
  recentlyUpdated: number;
  unacknowledged: number;
  compliance: number;
}

interface ProcedureRow {
  id: string;
  title: string;
  priority: "critical" | "high" | "medium" | "informational";
  status: "active" | "archived" | "replaced" | "draft";
  updated_at: string;
  acknowledgment_required: boolean;
}

function Dashboard() {
  const { user, role } = useAuth();
  const [stats, setStats] = useState<Stats>({ active: 0, critical: 0, recentlyUpdated: 0, unacknowledged: 0, compliance: 100 });
  const [recent, setRecent] = useState<ProcedureRow[]>([]);
  const [unack, setUnack] = useState<ProcedureRow[]>([]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const load = async () => {
    const since = new Date(Date.now() - 14 * 86400_000).toISOString();
    const [{ data: active }, { data: critical }, { data: updated }, { data: all }, { data: myAcks }] = await Promise.all([
      supabase.from("procedures").select("id", { count: "exact" }).eq("status", "active"),
      supabase.from("procedures").select("id", { count: "exact" }).eq("status", "active").eq("priority", "critical"),
      supabase.from("procedures").select("id,title,priority,status,updated_at,acknowledgment_required").eq("status", "active").gte("updated_at", since).order("updated_at", { ascending: false }).limit(6),
      supabase.from("procedures").select("id,title,priority,status,updated_at,acknowledgment_required,version").eq("status", "active").eq("acknowledgment_required", true),
      supabase.from("acknowledgments").select("procedure_id,procedure_version").eq("user_id", user!.id),
    ]);

    const ackSet = new Set((myAcks ?? []).map((a) => `${a.procedure_id}:${a.procedure_version}`));
    const unacked = (all ?? []).filter((p) => !ackSet.has(`${p.id}:${p.version}`));

    const totalRequired = all?.length ?? 0;
    const compliance = totalRequired === 0 ? 100 : Math.round(((totalRequired - unacked.length) / totalRequired) * 100);

    setStats({
      active: active?.length ?? 0,
      critical: critical?.length ?? 0,
      recentlyUpdated: updated?.length ?? 0,
      unacknowledged: unacked.length,
      compliance,
    });
    setRecent(updated ?? []);
    setUnack(unacked.slice(0, 6));
  };

  return (
    <div>
      <PageHeader
        eyebrow="Folio 01 — Dashboard"
        title="The current record"
        subtitle={role === "admin" ? "An overview of active procedures, recent changes, and compliance across the team." : "An overview of what you need to read, and what has changed."}
      />

      <div className="px-6 md:px-10 pb-12 max-w-6xl">
        {/* Stat ledger */}
        <section className="grid grid-cols-2 md:grid-cols-5 gap-px bg-border border border-border mb-10">
          <Stat label="Active" value={stats.active} />
          <Stat label="Critical" value={stats.critical} tone="critical" />
          <Stat label="Updated · 14d" value={stats.recentlyUpdated} />
          <Stat label="To acknowledge" value={stats.unacknowledged} tone={stats.unacknowledged > 0 ? "warn" : undefined} />
          <Stat label="Your compliance" value={`${stats.compliance}%`} />
        </section>

        <div className="grid lg:grid-cols-2 gap-10">
          <Section title="Requires your acknowledgment" eyebrow="Section A" empty="You're up to date." rows={unack} />
          <Section title="Recently updated" eyebrow="Section B" empty="No changes in the last fourteen days." rows={recent} />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: "critical" | "warn" }) {
  return (
    <div className="bg-card p-5">
      <div className="eyebrow mb-3">{label}</div>
      <div className={`font-display text-4xl num leading-none ${tone === "critical" ? "text-priority-critical" : tone === "warn" ? "text-priority-high" : ""}`}>
        {value}
      </div>
    </div>
  );
}

function Section({ title, eyebrow, rows, empty }: { title: string; eyebrow: string; rows: ProcedureRow[]; empty: string }) {
  return (
    <section>
      <div className="flex items-baseline justify-between mb-3">
        <div>
          <div className="eyebrow">{eyebrow}</div>
          <h2 className="font-display text-xl mt-0.5">{title}</h2>
        </div>
        <Link to="/app/procedures" className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground">
          All →
        </Link>
      </div>
      <div className="border-t border-border-strong">
        {rows.length === 0 ? (
          <div className="py-8 text-sm text-muted-foreground italic font-display">{empty}</div>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li key={r.id} className="ledger-row">
                <Link to="/app/procedures/$id" params={{ id: r.id }} className="block py-3 grid grid-cols-12 gap-3 items-baseline">
                  <div className="col-span-7">
                    <div className="text-[15px] leading-snug">{r.title}</div>
                    <div className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground mt-1">
                      Updated {new Date(r.updated_at).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="col-span-5 flex items-center justify-end gap-2 flex-wrap">
                    <PriorityBadge value={r.priority} />
                    <StatusBadge value={r.status} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
