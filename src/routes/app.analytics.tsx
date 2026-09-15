import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useIsAdmin } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";

export const Route = createFileRoute("/app/analytics")({ component: Analytics });

function Analytics() {
  const isAdmin = useIsAdmin();
  const { org } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<{
    users: number;
    ack: number;
    req: number;
    leastAcked: { id: string; title: string; rate: number }[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAdmin) {
      void navigate({ to: "/app" });
      return;
    }
    if (!org?.organization.id) return;

    void (async () => {
      try {
        const [
          { count: users, error: err1 },
          { data: required, error: err2 },
          { data: acks, error: err3 },
        ] = await Promise.all([
          supabase
            .from("organization_members")
            .select("*", { count: "exact", head: true })
            .eq("organization_id", org.organization.id),
          supabase
            .from("procedures")
            .select("id,title,current_version_id")
            .eq("organization_id", org.organization.id)
            .eq("status", "active")
            .eq("acknowledgment_required", true),
          supabase
            .from("acknowledgments")
            .select("procedure_id,procedure_version_id,user_id")
            .eq("organization_id", org.organization.id),
        ]);

        if (err1 || err2 || err3) throw new Error("Failed to load analytics data.");

        const totalUsers = users ?? 0;
        const ackMap = new Map<string, Set<string>>();
        (acks ?? []).forEach((a) => {
          const k = `${a.procedure_id}:${a.procedure_version_id}`;
          if (!ackMap.has(k)) ackMap.set(k, new Set());
          ackMap.get(k)!.add(a.user_id);
        });
        const leastAcked = (required ?? [])
          .map((p) => ({
            id: p.id,
            title: p.title,
            rate:
              totalUsers === 0
                ? 0
                : Math.round(
                    ((ackMap.get(`${p.id}:${p.current_version_id}`)?.size ?? 0) / totalUsers) * 100,
                  ),
          }))
          .sort((a, b) => a.rate - b.rate)
          .slice(0, 8);

        const ackCount = (required ?? []).reduce(
          (sum, p) => sum + (ackMap.get(`${p.id}:${p.current_version_id}`)?.size ?? 0),
          0,
        );
        const reqCount = (required?.length ?? 0) * totalUsers;
        setData({ users: totalUsers, ack: ackCount, req: reqCount, leastAcked });
      } catch (err: any) {
        setError(err.message);
      }
    })();
  }, [isAdmin, navigate, org]);

  if (!isAdmin) return null;
  if (error) return <div className="p-10 text-sm text-destructive">{error}</div>;
  if (!data)
    return (
      <div className="p-10 text-sm text-muted-foreground font-display italic">Tallying...</div>
    );

  const overall = data.req === 0 ? 100 : Math.round((data.ack / data.req) * 100);

  return (
    <div>
      <PageHeader
        eyebrow="Folio 05"
        title="Compliance & activity"
        subtitle="A reading of how the record is being attended to."
      />
      <div className="px-6 md:px-10 py-6 max-w-4xl space-y-8">
        <div className="grid grid-cols-3 gap-px bg-border border border-border">
          <div className="bg-card p-5">
            <div className="eyebrow mb-2">Team members</div>
            <div className="font-display text-4xl num">{data.users}</div>
          </div>
          <div className="bg-card p-5">
            <div className="eyebrow mb-2">Total signatures</div>
            <div className="font-display text-4xl num">{data.ack}</div>
          </div>
          <div className="bg-card p-5">
            <div className="eyebrow mb-2">Overall compliance</div>
            <div className="font-display text-4xl num">{overall}%</div>
          </div>
        </div>

        <div>
          <div className="eyebrow mb-3">Least acknowledged · top 8</div>
          <ul className="divide-y divide-border border-t border-border-strong">
            {data.leastAcked.map((p) => (
              <li key={p.id} className="py-3 grid grid-cols-12 gap-3 items-baseline">
                <Link
                  to="/app/procedures/$id"
                  params={{ id: p.id }}
                  className="col-span-8 text-[15px] hover:underline hover:text-primary"
                >
                  {p.title}
                </Link>
                <div className="col-span-3">
                  <div className="h-1.5 bg-muted rounded-sm overflow-hidden">
                    <div className="h-full bg-primary" style={{ width: `${p.rate}%` }} />
                  </div>
                </div>
                <div className="col-span-1 text-right font-mono text-xs num">{p.rate}%</div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
