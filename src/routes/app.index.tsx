import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useIsAdmin } from "@/lib/auth";
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
  const { user, org } = useAuth();
  const isAdmin = useIsAdmin();
  const [stats, setStats] = useState<Stats>({
    active: 0,
    critical: 0,
    recentlyUpdated: 0,
    unacknowledged: 0,
    compliance: 100,
  });
  const [recent, setRecent] = useState<ProcedureRow[]>([]);
  const [unack, setUnack] = useState<ProcedureRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, org?.organization.id]);

  const load = async () => {
    if (!user || !org?.organization.id) return;
    setIsLoading(true);
    setError(null);
    try {
      const orgId = org.organization.id;
      const since = new Date(Date.now() - 14 * 86400_000).toISOString();
      const [
        { data: active, error: err1 },
        { data: critical, error: err2 },
        { data: updated, error: err3 },
        { data: compData, error: err4 },
      ] = await Promise.all([
        supabase.from("procedures").select("id").eq("status", "active").eq("organization_id", orgId),
        supabase
          .from("procedures")
          .select("id")
          .eq("status", "active")
          .eq("priority", "critical")
          .eq("organization_id", orgId),
        supabase
          .from("procedures")
          .select("id,title,priority,status,updated_at,acknowledgment_required")
          .eq("status", "active")
          .eq("organization_id", orgId)
          .gte("updated_at", since)
          .order("updated_at", { ascending: false }),
        supabase
          .from("procedure_member_compliance")
          .select(
            "procedure_id,procedure_title,procedure_priority,procedure_status,procedure_updated_at,compliance_status",
          )
          .eq("organization_id", orgId)
          .eq("user_id", user.id),
      ]);

      if (err1 || err2 || err3 || err4) throw new Error("Failed to load dashboard data.");

      const obligations = compData ?? [];
      const unackedObligations = obligations.filter(
        (r) => r.compliance_status === "OUTSTANDING" || r.compliance_status === "REQUIRES_REACK",
      );
      const ackedCount = obligations.filter((r) => r.compliance_status === "ACKNOWLEDGED").length;

      const totalRequired = obligations.length;
      const compliance =
        totalRequired === 0
          ? 100
          : Math.round((ackedCount / totalRequired) * 100);

      const unackProcedures: ProcedureRow[] = unackedObligations.map((r) => ({
        id: r.procedure_id,
        title: r.procedure_title,
        priority: (r.procedure_priority || "medium") as any,
        status: (r.procedure_status || "active") as any,
        updated_at: r.procedure_updated_at || new Date().toISOString(),
        acknowledgment_required: true,
      }));

      setStats({
        active: active?.length ?? 0,
        critical: critical?.length ?? 0,
        recentlyUpdated: updated?.length ?? 0,
        unacknowledged: unackedObligations.length,
        compliance,
      });
      setRecent((updated ?? []).slice(0, 6));
      setUnack(unackProcedures.slice(0, 6));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading)
    return (
      <div className="p-10 font-display italic text-muted-foreground">Loading dashboard...</div>
    );
  if (error) return <div className="p-10 text-destructive">{error}</div>;

  return (
    <div>
      <PageHeader
        eyebrow="Folio 01 - Dashboard"
        title="The current record"
        subtitle={
          isAdmin
            ? "An overview of active procedures, recent changes, and compliance across the team."
            : "An overview of what you need to read, and what has changed."
        }
      />

      <div className="px-6 md:px-10 pt-8 md:pt-10 pb-12 max-w-6xl">
        {/* Stat ledger */}
        <section className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-10">
          <Stat label="Active" value={stats.active} />
          <Stat label="Critical" value={stats.critical} tone="critical" />
          <Stat label="Updated · 14d" value={stats.recentlyUpdated} />
          <Stat
            label="To acknowledge"
            value={stats.unacknowledged}
            tone={stats.unacknowledged > 0 ? "warn" : undefined}
          />
          <Stat label="Your compliance" value={`${stats.compliance}%`} />
        </section>

        <div className="grid lg:grid-cols-2 gap-8">
          <Section
            title="Requires your acknowledgment"
            eyebrow="Section A"
            empty="You're up to date."
            rows={unack}
          />
          <Section
            title="Recently updated"
            eyebrow="Section B"
            empty="No changes in the last fourteen days."
            rows={recent}
          />
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "critical" | "warn";
}) {
  return (
    <div className="bg-card border border-border rounded-xl shadow-sm p-5 md:p-6 flex flex-col justify-between">
      <div className="eyebrow mb-3 text-muted-foreground">{label}</div>
      <div
        className={`font-display text-4xl num ${
          tone === "critical"
            ? "text-priority-critical"
            : tone === "warn"
              ? "text-priority-high"
              : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function Section({
  title,
  eyebrow,
  empty,
  rows,
}: {
  title: string;
  eyebrow: string;
  empty: string;
  rows: ProcedureRow[];
}) {
  return (
    <section className="flex flex-col">
      <div className="flex items-baseline justify-between mb-4 px-1">
        <h2 className="font-display text-lg">{title}</h2>
        <span className="eyebrow text-muted-foreground">{eyebrow}</span>
      </div>
      
      <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
        {rows.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground italic">
            {empty}
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((p) => (
              <li key={p.id}>
                <Link
                  to="/app/procedures/$id"
                  params={{ id: p.id }}
                  className="p-4 flex flex-col gap-2 hover:bg-muted/40 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <span className="text-[15px] font-medium leading-snug">{p.title}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      <StatusBadge value={p.status} />
                      <PriorityBadge value={p.priority} />
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Updated {new Date(p.updated_at).toLocaleDateString()}
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
