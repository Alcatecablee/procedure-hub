import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PriorityBadge, StatusBadge } from "@/components/badges";
import { toast } from "sonner";

export const Route = createFileRoute("/app/procedures/$id")({
  component: ProcedureDetail,
});

interface Procedure {
  id: string;
  title: string;
  description: string;
  priority: "critical" | "high" | "medium" | "informational";
  status: "active" | "archived" | "replaced" | "draft";
  category_id: string | null;
  source_platform: string;
  source_reference: string | null;
  effective_date: string | null;
  expiry_date: string | null;
  version: number;
  acknowledgment_required: boolean;
  effective_immediately: boolean;
  supersedes_id: string | null;
  created_at: string;
  updated_at: string;
}

function ProcedureDetail() {
  const { id } = Route.useParams();
  const { user, role } = useAuth();
  const navigate = useNavigate();
  const [proc, setProc] = useState<Procedure | null>(null);
  const [categoryName, setCategoryName] = useState<string>("—");
  const [acked, setAcked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [versions, setVersions] = useState<{ version: number; created_at: string; change_note: string | null }[]>([]);
  const [ackCount, setAckCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, user?.id]);

  const load = async () => {
    setLoading(true);
    const { data: p } = await supabase.from("procedures").select("*").eq("id", id).maybeSingle();
    if (!p) { setLoading(false); return; }
    setProc(p as Procedure);
    if (p.category_id) {
      const { data: c } = await supabase.from("categories").select("name").eq("id", p.category_id).maybeSingle();
      setCategoryName(c?.name ?? "—");
    }
    if (user) {
      const { data: a } = await supabase.from("acknowledgments").select("id").eq("procedure_id", id).eq("user_id", user.id).eq("procedure_version", p.version).maybeSingle();
      setAcked(!!a);
    }
    const { data: v } = await supabase.from("procedure_versions").select("version,created_at,change_note").eq("procedure_id", id).order("version", { ascending: false });
    setVersions(v ?? []);
    if (role === "admin") {
      const { count } = await supabase.from("acknowledgments").select("*", { count: "exact", head: true }).eq("procedure_id", id).eq("procedure_version", p.version);
      setAckCount(count ?? 0);
    }
    setLoading(false);
  };

  const acknowledge = async () => {
    if (!proc || !user) return;
    setBusy(true);
    const { error } = await supabase.from("acknowledgments").insert({
      procedure_id: proc.id, user_id: user.id, procedure_version: proc.version,
    });
    if (error) toast.error(error.message);
    else { setAcked(true); toast.success("Signed."); }
    setBusy(false);
  };

  if (loading) return <div className="p-10 text-sm text-muted-foreground font-display italic">Consulting the record…</div>;
  if (!proc) return <div className="p-10">Not found.</div>;

  return (
    <div>
      <div className="border-b border-border-strong">
        <div className="px-6 md:px-10 py-10 max-w-4xl">
          <div className="flex items-center justify-between mb-4">
            <Link to="/app/procedures" className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground">
              ← Register
            </Link>
            {role === "admin" && (
              <Link
                to="/app/procedures/$id/edit"
                params={{ id: proc.id }}
                className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground"
              >
                Edit →
              </Link>
            )}
          </div>
          <div className="eyebrow mb-3">{categoryName} · v{proc.version}</div>
          <h1 className="font-display text-4xl md:text-5xl leading-[1.05] tracking-tight">{proc.title}</h1>
          <div className="mt-5 flex items-center gap-2 flex-wrap">
            <PriorityBadge value={proc.priority} />
            <StatusBadge value={proc.status} />
            {proc.acknowledgment_required && (
              <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] border border-border px-1.5 py-0.5 rounded-sm">Acknowledgment required</span>
            )}
            {proc.effective_immediately && (
              <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] border border-priority-high/40 text-priority-high px-1.5 py-0.5 rounded-sm">Effective immediately</span>
            )}
          </div>
        </div>
      </div>

      <div className="px-6 md:px-10 py-10 max-w-4xl grid lg:grid-cols-3 gap-10">
        <article className="lg:col-span-2 prose-like">
          <div className="whitespace-pre-wrap text-[15px] leading-7 text-foreground font-serif">
            {proc.description || <span className="italic text-muted-foreground">No description provided.</span>}
          </div>

          {proc.acknowledgment_required && proc.status === "active" && (
            <div className="mt-10 rule-strong pt-6">
              <div className="eyebrow mb-2">Sign the record</div>
              {acked ? (
                <div className="text-sm text-status-active font-mono uppercase tracking-[0.12em]">✓ Signed for v{proc.version}</div>
              ) : (
                <button
                  onClick={() => void acknowledge()}
                  disabled={busy}
                  className="bg-primary text-primary-foreground px-5 py-2.5 text-sm rounded-sm hover:bg-primary/90 disabled:opacity-60"
                >
                  {busy ? "…" : "Acknowledge — I have read this procedure"}
                </button>
              )}
            </div>
          )}
        </article>

        <aside className="space-y-6">
          <Meta label="Effective" value={proc.effective_date ?? "—"} />
          <Meta label="Expires" value={proc.expiry_date ?? "—"} />
          <Meta label="Source" value={proc.source_platform} />
          {proc.source_reference && <Meta label="Reference" value={proc.source_reference} multiline />}
          <Meta label="Created" value={new Date(proc.created_at).toLocaleString()} />
          <Meta label="Updated" value={new Date(proc.updated_at).toLocaleString()} />
          {role === "admin" && ackCount !== null && (
            <Meta label="Signatures · v" value={`${ackCount} for v${proc.version}`} />
          )}

          {versions.length > 1 && (
            <div>
              <div className="eyebrow mb-2">Revisions</div>
              <ul className="space-y-1.5 text-xs">
                {versions.map((v) => (
                  <li key={v.version} className="flex justify-between gap-4 border-t border-border pt-1.5">
                    <span className="font-mono">v{v.version}</span>
                    <span className="text-muted-foreground">{new Date(v.created_at).toLocaleDateString()}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function Meta({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  return (
    <div>
      <div className="eyebrow mb-1">{label}</div>
      <div className={`text-sm ${multiline ? "whitespace-pre-wrap" : ""}`}>{value}</div>
    </div>
  );
}
