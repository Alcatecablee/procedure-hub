import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { PriorityBadge, StatusBadge } from "@/components/badges";

export const Route = createFileRoute("/app/procedures/")({
  component: ProceduresList,
});

interface Procedure {
  id: string;
  title: string;
  description: string;
  priority: "critical" | "high" | "medium" | "informational";
  status: "active" | "archived" | "replaced" | "draft";
  category_id: string | null;
  updated_at: string;
  effective_date: string | null;
  acknowledgment_required: boolean;
  version: number;
}

interface Category { id: string; name: string; slug: string }

function ProceduresList() {
  const { role, user } = useAuth();
  const navigate = useNavigate();
  const [procs, setProcs] = useState<Procedure[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [acks, setAcks] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("all");
  const [pri, setPri] = useState<string>("all");
  const [stat, setStat] = useState<string>("active");
  const [ackFilter, setAckFilter] = useState<string>("all");
  const [sort, setSort] = useState<string>("updated_desc");

  useEffect(() => {
    void (async () => {
      setLoading(true);
      const [{ data: p }, { data: c }, { data: a }] = await Promise.all([
        supabase.from("procedures").select("*").order("updated_at", { ascending: false }),
        supabase.from("categories").select("id,name,slug").order("sort_order"),
        user ? supabase.from("acknowledgments").select("procedure_id,procedure_version").eq("user_id", user.id) : Promise.resolve({ data: [] as { procedure_id: string; procedure_version: number }[] }),
      ]);
      setProcs((p ?? []) as Procedure[]);
      setCategories(c ?? []);
      setAcks(new Set((a ?? []).map((x) => `${x.procedure_id}:${x.procedure_version}`)));
      setLoading(false);
    })();
  }, [user?.id]);

  const filtered = useMemo(() => {
    let list = procs;
    if (stat !== "all") list = list.filter((p) => p.status === stat);
    if (pri !== "all") list = list.filter((p) => p.priority === pri);
    if (cat !== "all") list = list.filter((p) => p.category_id === cat);
    if (q.trim()) {
      const t = q.toLowerCase();
      list = list.filter((p) => p.title.toLowerCase().includes(t) || p.description.toLowerCase().includes(t));
    }
    if (ackFilter !== "all") {
      list = list.filter((p) => {
        const acked = acks.has(`${p.id}:${p.version}`);
        return ackFilter === "acked" ? acked : !acked && p.acknowledgment_required;
      });
    }
    const sorted = [...list];
    if (sort === "updated_desc") sorted.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    if (sort === "updated_asc") sorted.sort((a, b) => a.updated_at.localeCompare(b.updated_at));
    if (sort === "title") sorted.sort((a, b) => a.title.localeCompare(b.title));
    return sorted;
  }, [procs, q, cat, pri, stat, ackFilter, sort, acks]);

  const catName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? "—";

  return (
    <div>
      <PageHeader
        eyebrow="Folio 02 — Procedures"
        title="The procedure register"
        subtitle="Search, filter, and consult the operational record."
        actions={role === "admin" ? (
          <button
            onClick={() => void navigate({ to: "/app/procedures/new" })}
            className="bg-primary text-primary-foreground px-4 py-2 text-sm rounded-sm hover:bg-primary/90"
          >
            New procedure
          </button>
        ) : undefined}
      />

      <div className="px-6 md:px-10 py-6 max-w-6xl">
        {/* Filter rail */}
        <div className="flex flex-wrap gap-3 items-end mb-6 pb-6 border-b border-border">
          <Field label="Search">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Title or content…"
              className="w-64 bg-card border border-input px-3 py-1.5 text-sm rounded-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </Field>
          <Field label="Category">
            <Select value={cat} onChange={setCat} options={[["all", "All"], ...categories.map((c) => [c.id, c.name] as [string, string])]} />
          </Field>
          <Field label="Priority">
            <Select value={pri} onChange={setPri} options={[["all", "All"], ["critical", "Critical"], ["high", "High"], ["medium", "Medium"], ["informational", "Informational"]]} />
          </Field>
          <Field label="Status">
            <Select value={stat} onChange={setStat} options={[["active", "Active"], ["draft", "Draft"], ["archived", "Archived"], ["replaced", "Replaced"], ["all", "All"]]} />
          </Field>
          <Field label="Acknowledged">
            <Select value={ackFilter} onChange={setAckFilter} options={[["all", "All"], ["unacked", "Outstanding"], ["acked", "Signed"]]} />
          </Field>
          <Field label="Sort">
            <Select value={sort} onChange={setSort} options={[["updated_desc", "Newest"], ["updated_asc", "Oldest"], ["title", "Title A→Z"]]} />
          </Field>
        </div>

        <div className="border-t border-border-strong">
          {loading ? (
            <div className="py-10 text-sm text-muted-foreground font-display italic">Consulting the record…</div>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-sm text-muted-foreground font-display italic">No procedures match these filters.</div>
          ) : (
            <ul className="divide-y divide-border">
              {filtered.map((p, i) => {
                const acked = acks.has(`${p.id}:${p.version}`);
                return (
                  <li key={p.id} className="ledger-row">
                    <Link to="/app/procedures/$id" params={{ id: p.id }} className="block py-4 grid grid-cols-12 gap-4 items-baseline">
                      <div className="col-span-1 font-mono text-[11px] text-muted-foreground num pt-1">
                        {String(i + 1).padStart(3, "0")}
                      </div>
                      <div className="col-span-7">
                        <div className="text-[15px] leading-snug flex items-baseline gap-2">
                          <span>{p.title}</span>
                          {p.acknowledgment_required && !acked && p.status === "active" && (
                            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-priority-high">· Sign required</span>
                          )}
                        </div>
                        <div className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground mt-1">
                          {catName(p.category_id)} · v{p.version} · Updated {new Date(p.updated_at).toLocaleDateString()}
                        </div>
                      </div>
                      <div className="col-span-4 flex items-center justify-end gap-2 flex-wrap">
                        <PriorityBadge value={p.priority} />
                        <StatusBadge value={p.status} />
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="eyebrow mb-1">{label}</div>
      {children}
    </div>
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-card border border-input px-2.5 py-1.5 text-sm rounded-sm focus:outline-none focus:ring-1 focus:ring-ring"
    >
      {options.map(([v, l]) => (
        <option key={v} value={v}>{l}</option>
      ))}
    </select>
  );
}
