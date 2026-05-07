import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { PriorityBadge } from "@/components/badges";
import { toast } from "sonner";

export const Route = createFileRoute("/app/import")({ component: ImportPage });

interface Draft { title: string; description: string; category: string; priority: "critical"|"high"|"medium"|"informational"; source_reference?: string }

function ImportPage() {
  const { role, user } = useAuth();
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [platform, setPlatform] = useState("teams");
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [cats, setCats] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    if (role && role !== "admin") void navigate({ to: "/app" });
    void supabase.from("categories").select("id,name").order("sort_order").then(({ data }) => setCats(data ?? []));
  }, [role, navigate]);

  const upload = async (f: File) => setText(await f.text());

  const extract = async () => {
    if (!text.trim()) return toast.error("Paste an export first.");
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("extract-procedures", { body: { raw_text: text } });
      if (error) throw error;
      const list = (data?.procedures ?? []) as Draft[];
      setDrafts(list);
      if (list.length === 0) toast.info("No operational procedures detected.");
      else toast.success(`Extracted ${list.length} draft procedure${list.length === 1 ? "" : "s"}.`);
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  };

  const updateDraft = (i: number, patch: Partial<Draft>) => setDrafts(drafts.map((d, idx) => idx === i ? { ...d, ...patch } : d));
  const removeDraft = (i: number) => setDrafts(drafts.filter((_, idx) => idx !== i));

  const publish = async () => {
    if (drafts.length === 0) return;
    setBusy(true);
    const catBySlug = new Map(cats.map((c) => [c.name, c.id]));
    const rows = drafts.map((d) => ({
      title: d.title.slice(0, 200),
      description: d.description,
      category_id: catBySlug.get(d.category) ?? null,
      priority: d.priority,
      status: "draft" as const,
      source_platform: platform as "teams"|"slack"|"whatsapp"|"discord"|"email"|"manual"|"other",
      source_reference: d.source_reference ?? null,
      created_by: user!.id, updated_by: user!.id,
    }));
    const { error } = await supabase.from("procedures").insert(rows);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`${rows.length} drafts created. Review and publish individually.`);
    void navigate({ to: "/app/procedures" });
  };

  return (
    <div>
      <PageHeader eyebrow="Folio 04 — Import" title="Extract procedures from a chat export" subtitle="Paste an export from Teams, Slack, or WhatsApp. The system will isolate operational instructions and discard chat noise." />
      <div className="px-6 md:px-10 py-6 max-w-4xl space-y-6">
        <div className="grid md:grid-cols-4 gap-4 items-end">
          <div className="md:col-span-1"><div className="eyebrow mb-1.5">Source</div><select value={platform} onChange={(e) => setPlatform(e.target.value)} className="w-full bg-card border border-input px-2.5 py-2 text-sm rounded-sm">{["teams","slack","whatsapp","discord","email","other"].map((p) => <option key={p}>{p}</option>)}</select></div>
          <div className="md:col-span-3"><div className="eyebrow mb-1.5">Upload .txt (optional)</div><input type="file" accept=".txt,text/plain" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} className="text-sm" /></div>
        </div>
        <div><div className="eyebrow mb-1.5">Paste export</div><textarea rows={12} value={text} onChange={(e) => setText(e.target.value)} className="w-full bg-card border border-input px-3 py-2 text-sm rounded-sm font-mono" placeholder="Paste the raw chat export here…" /></div>
        <div className="flex gap-3">
          <button onClick={() => void extract()} disabled={busy} className="bg-primary text-primary-foreground px-5 py-2.5 text-sm rounded-sm hover:bg-primary/90 disabled:opacity-60">{busy ? "Extracting…" : "Extract procedures"}</button>
          {drafts.length > 0 && <button onClick={() => void publish()} disabled={busy} className="px-5 py-2.5 text-sm rounded-sm border border-border-strong hover:bg-muted">Save {drafts.length} as drafts</button>}
        </div>

        {drafts.length > 0 && (
          <div className="rule-strong pt-6">
            <div className="eyebrow mb-3">Extracted drafts · review before saving</div>
            <ul className="space-y-4">
              {drafts.map((d, i) => (
                <li key={i} className="paper-card p-4 space-y-2">
                  <div className="flex items-center gap-3">
                    <input value={d.title} onChange={(e) => updateDraft(i, { title: e.target.value })} className="flex-1 bg-transparent border-b border-border font-display text-lg pb-1 focus:outline-none focus:border-foreground" />
                    <PriorityBadge value={d.priority} />
                    <button onClick={() => removeDraft(i)} className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground hover:text-destructive">Remove</button>
                  </div>
                  <textarea value={d.description} onChange={(e) => updateDraft(i, { description: e.target.value })} rows={4} className="w-full bg-transparent border border-border px-2 py-1.5 text-sm font-serif leading-6 rounded-sm" />
                  <div className="grid grid-cols-2 gap-3">
                    <div><div className="eyebrow mb-1">Category</div><select value={d.category} onChange={(e) => updateDraft(i, { category: e.target.value })} className="w-full bg-card border border-input px-2 py-1.5 text-sm rounded-sm">{cats.map((c) => <option key={c.id}>{c.name}</option>)}</select></div>
                    <div><div className="eyebrow mb-1">Priority</div><select value={d.priority} onChange={(e) => updateDraft(i, { priority: e.target.value as Draft["priority"] })} className="w-full bg-card border border-input px-2 py-1.5 text-sm rounded-sm">{["critical","high","medium","informational"].map((p) => <option key={p}>{p}</option>)}</select></div>
                  </div>
                  {d.source_reference && <div className="text-xs text-muted-foreground italic font-serif border-l-2 border-border pl-3">"{d.source_reference}"</div>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
