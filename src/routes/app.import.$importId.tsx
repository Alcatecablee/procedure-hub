import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { getImport, approveImportDraft, rejectImportDraft } from "@/lib/import.server";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useIsAdmin } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { PriorityBadge } from "@/components/badges";
import { toast } from "sonner";
import { getCategories } from "@/lib/procedures.server";

export const Route = createFileRoute("/app/import/$importId")({ component: ReviewPage });

function ReviewPage() {
  const { importId } = Route.useParams();
  const { org } = useAuth();
  const isAdmin = useIsAdmin();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const { data, refetch, isLoading, isError, error } = useQuery({
    queryKey: ["import", importId],
    queryFn: async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      return getImport({
        data: { organizationId: org!.organization.id, importId },
        headers: session?.access_token
          ? { authorization: "Bearer " + session.access_token }
          : undefined,
      });
    },
    enabled: !!org,
  });

  const { data: catsData } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      return getCategories({
        data: { organizationId: org!.organization.id },
        headers: session?.access_token
          ? { authorization: "Bearer " + session.access_token }
          : undefined,
      });
    },
    enabled: !!org,
  });

  // Local state for edits
  const [edits, setEdits] = useState<Record<string, any>>({});

  useEffect(() => {
    if (!isAdmin) void navigate({ to: "/app" });
  }, [isAdmin, navigate]);

  if (isLoading || !catsData)
    return <div className="p-10 text-muted-foreground">Loading review data...</div>;
  if (isError)
    return (
      <div className="p-10 text-destructive">Error loading data: {(error as Error).message}</div>
    );
  if (!data) return null;

  const cats = catsData.categories || [];

  const handleApprove = async (draft: any) => {
    const edit = edits[draft.id] || {};
    const finalTitle = edit.title ?? draft.title;
    const finalDesc = edit.description ?? draft.description;
    const finalSummary = edit.summary ?? draft.summary ?? "";
    const finalPriority = edit.priority ?? draft.priority;

    // Resolve category id. Use edited cat id, or try to match suggested slug, or null
    let finalCatId = edit.categoryId;
    if (finalCatId === undefined) {
      if (draft.suggested_category_slug) {
        const match = cats.find(
          (c) =>
            c.slug === draft.suggested_category_slug ||
            c.name.toLowerCase().replace(/\s+/g, "-") === draft.suggested_category_slug,
        );
        finalCatId = match?.id || null;
      } else {
        finalCatId = null;
      }
    }

    setBusy((prev) => ({ ...prev, [draft.id]: true }));
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const res = await approveImportDraft({
        headers: session?.access_token
          ? { authorization: "Bearer " + session.access_token }
          : undefined,
        data: {
          organizationId: org!.organization.id,
          draftId: draft.id,
          title: finalTitle,
          summary: finalSummary,
          description: finalDesc,
          priority: finalPriority,
          categoryId: finalCatId,
          effectiveDate: edit.effectiveDate ?? draft.effective_date ?? null,
          expiryDate: edit.expiryDate ?? draft.expiry_date ?? null,
          acknowledgmentRequired: edit.ackRequired ?? false,
        },
      });
      toast.success("Draft approved. Draft procedure created.");
      void refetch();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy((prev) => ({ ...prev, [draft.id]: false }));
    }
  };

  const handleReject = async (draftId: string) => {
    if (
      !window.confirm(
        "Are you sure you want to reject this draft? It will be marked as noise and discarded.",
      )
    )
      return;
    setBusy((prev) => ({ ...prev, [draftId]: true }));
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      await rejectImportDraft({
        headers: session?.access_token
          ? { authorization: "Bearer " + session.access_token }
          : undefined,
        data: { organizationId: org!.organization.id, draftId, notes: "Rejected in review UI" },
      });
      toast.info("Draft rejected.");
      void refetch();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy((prev) => ({ ...prev, [draftId]: false }));
    }
  };

  const updateEdit = (id: string, patch: any) => {
    setEdits((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), ...patch } }));
  };

  const { importRecord, drafts } = data;

  return (
    <div>
      <PageHeader
        eyebrow="Folio 04 - Human Review"
        title="Review Extracted Procedures"
        subtitle={`Imported from ${importRecord.source_type} on ${new Date(importRecord.created_at).toLocaleDateString()}`}
      />
      <div className="px-6 md:px-10 py-6 max-w-5xl space-y-8">
        <Link to="/app/import" className="text-sm text-muted-foreground hover:text-foreground">
          ← Back to imports
        </Link>

        {drafts.length === 0 && (
          <div className="p-8 border border-border bg-card text-center text-muted-foreground">
            No candidates were extracted from this import.
          </div>
        )}

        <div className="space-y-6">
          {drafts.map((d: any) => {
            const edit = edits[d.id] || {};
            const isPending = d.status === "pending";

            // Try to resolve suggested category for display
            let catId = edit.categoryId;
            if (catId === undefined) {
              const match = cats.find(
                (c) =>
                  c.slug === d.suggested_category_slug ||
                  c.name.toLowerCase().replace(/\s+/g, "-") === d.suggested_category_slug,
              );
              catId = match?.id || "";
            }

            return (
              <div
                key={d.id}
                className={`paper-card p-5 space-y-4 ${d.status === "rejected" ? "opacity-50 grayscale" : ""}`}
              >
                {/* Header / Status */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span
                      className={`px-2 py-0.5 rounded-sm text-xs font-medium ${
                        d.status === "pending"
                          ? "bg-yellow-500/10 text-yellow-600 border border-yellow-500/20"
                          : d.status === "approved"
                            ? "bg-green-500/10 text-green-600 border border-green-500/20"
                            : "bg-red-500/10 text-red-600 border border-red-500/20"
                      }`}
                    >
                      {d.status.toUpperCase()}
                    </span>
                    <span className="text-xs text-muted-foreground font-mono tracking-wider">
                      CONF: {d.confidence}%
                    </span>
                    <span className="text-xs text-muted-foreground font-mono tracking-wider uppercase">
                      {d.classification}
                    </span>
                  </div>
                  {d.status === "approved" && d.published_procedure_id && (
                    <Link
                      to="/app/procedures/$id"
                      params={{ id: d.published_procedure_id }}
                      className="text-sm text-blue-500 hover:underline"
                    >
                      View Procedure →
                    </Link>
                  )}
                </div>

                {d.contains_sensitive && isPending && (
                  <div className="bg-red-500/10 border-l-2 border-red-500 p-3 text-sm text-red-600 font-medium">
                    ⚠️ AI flagged this draft as potentially containing passwords, credentials, or
                    PII. Review carefully before approving.
                  </div>
                )}

                <div className="grid md:grid-cols-2 gap-8">
                  {/* Left: Extracted & Editable */}
                  <div className="space-y-4">
                    <div>
                      <div className="eyebrow mb-1 flex justify-between">
                        <span>Title</span>
                        {edit.title !== undefined && <span className="text-blue-500">Edited</span>}
                      </div>
                      <input
                        disabled={!isPending}
                        value={edit.title ?? d.title}
                        onChange={(e) => updateEdit(d.id, { title: e.target.value })}
                        className="w-full bg-transparent border-b border-border font-display text-lg pb-1 focus:outline-none focus:border-foreground"
                      />
                    </div>

                    <div>
                      <div className="eyebrow mb-1 flex justify-between">
                        <span>Description</span>
                        {edit.description !== undefined && (
                          <span className="text-blue-500">Edited</span>
                        )}
                      </div>
                      <textarea
                        disabled={!isPending}
                        value={edit.description ?? d.description}
                        onChange={(e) => updateEdit(d.id, { description: e.target.value })}
                        rows={6}
                        className="w-full bg-transparent border border-border px-3 py-2 text-sm font-serif leading-6 rounded-sm focus:outline-none focus:border-foreground"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <div className="eyebrow mb-1">Category</div>
                        <select
                          disabled={!isPending}
                          value={catId}
                          onChange={(e) => updateEdit(d.id, { categoryId: e.target.value })}
                          className="w-full bg-card border border-input px-2 py-1.5 text-sm rounded-sm"
                        >
                          <option value="">Uncategorized</option>
                          {cats.map((c: any) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <div className="eyebrow mb-1">Priority</div>
                        <select
                          disabled={!isPending}
                          value={edit.priority ?? d.priority}
                          onChange={(e) => updateEdit(d.id, { priority: e.target.value })}
                          className="w-full bg-card border border-input px-2 py-1.5 text-sm rounded-sm"
                        >
                          {["critical", "high", "medium", "informational"].map((p) => (
                            <option key={p} value={p}>
                              {p}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="pt-2">
                      <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          disabled={!isPending}
                          checked={edit.ackRequired ?? false}
                          onChange={(e) => updateEdit(d.id, { ackRequired: e.target.checked })}
                          className="rounded border-input text-primary focus:ring-primary"
                        />
                        Require staff acknowledgment
                      </label>
                    </div>
                  </div>

                  {/* Right: Source Evidence */}
                  <div className="space-y-4 bg-muted/30 p-4 rounded-sm border border-border">
                    <div className="eyebrow text-muted-foreground">Source Evidence</div>
                    {d.source_evidence ? (
                      <blockquote className="border-l-2 border-border pl-4 text-sm text-ink-soft italic font-serif">
                        &quot;{d.source_evidence}&quot;
                      </blockquote>
                    ) : (
                      <div className="text-sm text-muted-foreground italic">
                        No specific quote extracted.
                      </div>
                    )}
                    <div className="pt-4 border-t border-border/50 text-xs text-muted-foreground space-y-1">
                      <div>
                        <span className="font-medium">Model:</span> {d.model_name} (
                        {d.model_version})
                      </div>
                      <div>
                        <span className="font-medium">Source:</span> {importRecord.source_type}
                      </div>
                    </div>

                    {isPending && (
                      <div className="pt-6 flex gap-3">
                        <button
                          onClick={() => handleApprove(d)}
                          disabled={busy[d.id]}
                          className="flex-1 bg-primary text-primary-foreground px-4 py-2 text-sm rounded-sm hover:bg-primary/90 disabled:opacity-50"
                          aria-label={`Approve draft: ${d.title}`}
                        >
                          {busy[d.id] ? "Processing..." : "Approve as Draft"}
                        </button>
                        <button
                          onClick={() => handleReject(d.id)}
                          disabled={busy[d.id]}
                          className="px-4 py-2 text-sm text-destructive hover:bg-destructive/10 rounded-sm disabled:opacity-50"
                          aria-label={`Reject draft: ${d.title}`}
                        >
                          Reject Noise
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
