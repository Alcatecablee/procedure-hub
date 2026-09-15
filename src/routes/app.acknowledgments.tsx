import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { PriorityBadge } from "@/components/badges";
import { toast } from "sonner";

export const Route = createFileRoute("/app/acknowledgments")({ component: Acks });

interface Row {
  id: string;
  title: string;
  version: number;
  priority: "critical" | "high" | "medium" | "informational";
  updated_at: string;
  acked: boolean;
  acknowledged_at: string | null;
}

function Acks() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [{ data: procs }, { data: acks }] = await Promise.all([
          supabase
            .from("procedures")
            .select("id,title,version_number,current_version_id,priority,updated_at")
            .eq("status", "active")
            .eq("acknowledgment_required", true)
            .order("updated_at", { ascending: false }),
          user
            ? supabase
                .from("acknowledgments")
                .select("procedure_id,procedure_version_id,acknowledged_at")
                .eq("user_id", user.id)
            : Promise.resolve({ data: [] }),
        ]);
        const ackMap = new Map(
          (acks ?? []).map((a) => [
            `${a.procedure_id}:${a.procedure_version_id}`,
            a.acknowledged_at,
          ]),
        );
        setRows(
          (procs ?? []).map((p) => ({
            ...p,
            version: p.version_number,
            acked: ackMap.has(`${p.id}:${p.current_version_id}`),
            acknowledged_at: ackMap.get(`${p.id}:${p.current_version_id}`) ?? null,
          })),
        );
      } catch (err) {
        toast.error("Failed to load acknowledgments.");
        setError("Failed to load acknowledgments. Please try again later.");
      } finally {
        setLoading(false);
      }
    })();
  }, [user?.id]);

  return (
    <div>
      <PageHeader
        eyebrow="Folio 03"
        title="Your acknowledgments"
        subtitle="Procedures you have signed, and those still outstanding."
      />
      <div className="px-6 md:px-10 py-6 max-w-4xl" aria-live="polite">
        {loading ? (
          <div className="py-10 text-sm text-muted-foreground font-display italic">Loading...</div>
        ) : error ? (
          <div className="py-10 text-sm text-destructive">{error}</div>
        ) : rows.length === 0 ? (
          <div className="py-10 text-sm text-muted-foreground font-display italic">
            Nothing requires acknowledgment.
          </div>
        ) : (
          <ul className="divide-y divide-border border-t border-border-strong">
            {rows.map((r) => (
              <li key={r.id} className="ledger-row">
                <Link
                  to="/app/procedures/$id"
                  params={{ id: r.id }}
                  className="block py-4 grid grid-cols-12 gap-4 items-baseline"
                >
                  <div className="col-span-7">
                    <div className="text-[15px]">{r.title}</div>
                    <div className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground mt-1">
                      v{r.version} ·{" "}
                      {r.acked
                        ? `Signed ${new Date(r.acknowledged_at!).toLocaleDateString()}`
                        : "Outstanding"}
                    </div>
                  </div>
                  <div className="col-span-5 flex items-center justify-end gap-2">
                    <PriorityBadge value={r.priority} />
                    <span
                      className={`font-mono text-[10.5px] uppercase tracking-[0.12em] ${r.acked ? "text-status-active" : "text-priority-high"}`}
                    >
                      {r.acked ? "✓ Signed" : "Sign required"}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
