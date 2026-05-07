import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { toast } from "sonner";

export const Route = createFileRoute("/app/procedures/new")({ component: NewProcedure });

function NewProcedure() {
  const { role, user } = useAuth();
  const navigate = useNavigate();
  const [cats, setCats] = useState<{ id: string; name: string }[]>([]);
  const [form, setForm] = useState({
    title: "", description: "", category_id: "", priority: "medium", status: "active" as const,
    source_platform: "manual", source_reference: "", effective_date: "", expiry_date: "",
    acknowledgment_required: false, effective_immediately: false,
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (role && role !== "admin") void navigate({ to: "/app/procedures" });
    void supabase.from("categories").select("id,name").order("sort_order").then(({ data }) => {
      setCats(data ?? []);
      if (data?.[0]) setForm((f) => ({ ...f, category_id: data[0].id }));
    });
  }, [role, navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { data, error } = await supabase.from("procedures").insert({
      title: form.title,
      description: form.description,
      category_id: form.category_id || null,
      priority: form.priority as "critical" | "high" | "medium" | "informational",
      status: form.status,
      source_platform: form.source_platform as "teams" | "slack" | "whatsapp" | "discord" | "email" | "manual" | "other",
      source_reference: form.source_reference || null,
      effective_date: form.effective_date || null,
      expiry_date: form.expiry_date || null,
      acknowledgment_required: form.acknowledgment_required,
      effective_immediately: form.effective_immediately,
      created_by: user!.id,
      updated_by: user!.id,
    }).select("id").single();
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Procedure created.");
    void navigate({ to: "/app/procedures/$id", params: { id: data!.id } });
  };

  return (
    <div>
      <PageHeader eyebrow="Folio 02 · New entry" title="Compose a procedure" subtitle="Add a new entry to the operational record." />
      <form onSubmit={submit} className="px-6 md:px-10 py-8 max-w-3xl space-y-5">
        <Field label="Title">
          <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full bg-card border border-input px-3 py-2 text-sm rounded-sm" />
        </Field>
        <Field label="Description">
          <textarea required rows={10} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full bg-card border border-input px-3 py-2 text-sm rounded-sm font-serif leading-7" />
        </Field>
        <div className="grid md:grid-cols-3 gap-4">
          <Field label="Category">
            <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })} className="w-full bg-card border border-input px-2.5 py-2 text-sm rounded-sm">
              {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Priority">
            <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="w-full bg-card border border-input px-2.5 py-2 text-sm rounded-sm">
              {["critical","high","medium","informational"].map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="Status">
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as "active" })} className="w-full bg-card border border-input px-2.5 py-2 text-sm rounded-sm">
              {["active","draft","archived","replaced"].map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid md:grid-cols-3 gap-4">
          <Field label="Source platform">
            <select value={form.source_platform} onChange={(e) => setForm({ ...form, source_platform: e.target.value })} className="w-full bg-card border border-input px-2.5 py-2 text-sm rounded-sm">
              {["manual","teams","slack","whatsapp","discord","email","other"].map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="Effective date">
            <input type="date" value={form.effective_date} onChange={(e) => setForm({ ...form, effective_date: e.target.value })} className="w-full bg-card border border-input px-3 py-2 text-sm rounded-sm" />
          </Field>
          <Field label="Expiry date">
            <input type="date" value={form.expiry_date} onChange={(e) => setForm({ ...form, expiry_date: e.target.value })} className="w-full bg-card border border-input px-3 py-2 text-sm rounded-sm" />
          </Field>
        </div>
        <Field label="Source reference (optional quote / link)">
          <input value={form.source_reference} onChange={(e) => setForm({ ...form, source_reference: e.target.value })} className="w-full bg-card border border-input px-3 py-2 text-sm rounded-sm" />
        </Field>
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.acknowledgment_required} onChange={(e) => setForm({ ...form, acknowledgment_required: e.target.checked })} />
            Require acknowledgment
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.effective_immediately} onChange={(e) => setForm({ ...form, effective_immediately: e.target.checked })} />
            Effective immediately
          </label>
        </div>
        <div className="rule-strong pt-5 flex gap-3">
          <button type="submit" disabled={busy} className="bg-primary text-primary-foreground px-5 py-2.5 text-sm rounded-sm hover:bg-primary/90 disabled:opacity-60">
            {busy ? "…" : "Publish"}
          </button>
          <button type="button" onClick={() => void navigate({ to: "/app/procedures" })} className="px-5 py-2.5 text-sm rounded-sm border border-border hover:bg-muted">Cancel</button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><div className="eyebrow mb-1.5">{label}</div>{children}</div>;
}
