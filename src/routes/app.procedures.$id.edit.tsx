import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { toast } from "sonner";

export const Route = createFileRoute("/app/procedures/$id/edit")({ component: EditProcedure });

function EditProcedure() {
  const { id } = Route.useParams();
  const { role, user } = useAuth();
  const navigate = useNavigate();
  const [cats, setCats] = useState<{ id: string; name: string }[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [form, setForm] = useState<any>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (role && role !== "admin") void navigate({ to: "/app/procedures" });
    void (async () => {
      const [{ data: p }, { data: c }] = await Promise.all([
        supabase.from("procedures").select("*").eq("id", id).maybeSingle(),
        supabase.from("categories").select("id,name").order("sort_order"),
      ]);
      setCats(c ?? []);
      setForm(p);
    })();
  }, [id, role, navigate]);

  if (!form) return <div className="p-10 text-sm text-muted-foreground font-display italic">Loading…</div>;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    // snapshot previous version
    await supabase.from("procedure_versions").insert({
      procedure_id: id, version: form.version, title: form.title, description: form.description,
      priority: form.priority, status: form.status, changed_by: user!.id, change_note: note || null,
    });
    const { error } = await supabase.from("procedures").update({
      title: form.title, description: form.description, category_id: form.category_id,
      priority: form.priority, status: form.status, source_platform: form.source_platform,
      source_reference: form.source_reference, effective_date: form.effective_date,
      expiry_date: form.expiry_date, acknowledgment_required: form.acknowledgment_required,
      effective_immediately: form.effective_immediately, updated_by: user!.id,
      version: form.version + 1,
    }).eq("id", id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Saved as v" + (form.version + 1));
    void navigate({ to: "/app/procedures/$id", params: { id } });
  };

  return (
    <div>
      <PageHeader eyebrow={`v${form.version} → v${form.version + 1}`} title="Revise procedure" subtitle="Saving creates a new version. Previous version is preserved in revisions." />
      <form onSubmit={save} className="px-6 md:px-10 py-8 max-w-3xl space-y-5">
        <Lbl label="Title"><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full bg-card border border-input px-3 py-2 text-sm rounded-sm" /></Lbl>
        <Lbl label="Description"><textarea rows={10} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full bg-card border border-input px-3 py-2 text-sm rounded-sm font-serif leading-7" /></Lbl>
        <div className="grid md:grid-cols-3 gap-4">
          <Lbl label="Category"><select value={form.category_id ?? ""} onChange={(e) => setForm({ ...form, category_id: e.target.value })} className="w-full bg-card border border-input px-2.5 py-2 text-sm rounded-sm">{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Lbl>
          <Lbl label="Priority"><select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="w-full bg-card border border-input px-2.5 py-2 text-sm rounded-sm">{["critical","high","medium","informational"].map((p) => <option key={p}>{p}</option>)}</select></Lbl>
          <Lbl label="Status"><select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="w-full bg-card border border-input px-2.5 py-2 text-sm rounded-sm">{["active","draft","archived","replaced"].map((p) => <option key={p}>{p}</option>)}</select></Lbl>
        </div>
        <Lbl label="Change note (optional)"><input value={note} onChange={(e) => setNote(e.target.value)} className="w-full bg-card border border-input px-3 py-2 text-sm rounded-sm" /></Lbl>
        <div className="rule-strong pt-5 flex gap-3">
          <button type="submit" disabled={busy} className="bg-primary text-primary-foreground px-5 py-2.5 text-sm rounded-sm hover:bg-primary/90 disabled:opacity-60">{busy ? "…" : "Save revision"}</button>
          <button type="button" onClick={() => void navigate({ to: "/app/procedures/$id", params: { id } })} className="px-5 py-2.5 text-sm rounded-sm border border-border hover:bg-muted">Cancel</button>
        </div>
      </form>
    </div>
  );
}

function Lbl({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><div className="eyebrow mb-1.5">{label}</div>{children}</div>;
}
