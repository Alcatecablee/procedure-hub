import { createFileRoute, useNavigate, useBlocker } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { getProcedure, updateProcedure, getCategories, getDepartments } from "@/lib/procedures.server";
import { supabase } from "@/integrations/supabase/client";
import { useState, useEffect } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/procedures/$id/edit")({
  component: EditProcedure,
});

function EditProcedure() {
  const { id } = Route.useParams();
  const { org } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<"critical" | "high" | "medium" | "informational">(
    "medium",
  );
  const [categoryId, setCategoryId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [ackRequired, setAckRequired] = useState(true);
  const [effectiveDate, setEffectiveDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [expectedVersion, setExpectedVersion] = useState(0);

  const { data: procData, isLoading } = useQuery({
    queryKey: ["procedure", id, org?.organization.id],
    queryFn: async () => {
      if (!org?.organization.id) return null;
      const {
        data: { session },
      } = await supabase.auth.getSession();
      return await getProcedure({
        headers: session?.access_token
          ? { authorization: "Bearer " + session.access_token }
          : undefined,
        data: { organizationId: org.organization.id, id },
      } as any);
    },
    enabled: !!org?.organization.id,
  });

  const { data: catData } = useQuery({
    queryKey: ["categories", org?.organization.id],
    queryFn: async () => {
      if (!org?.organization.id) return { categories: [] };
      const { data: { session } } = await supabase.auth.getSession();
      return await getCategories({ 
        headers: session?.access_token ? { authorization: "Bearer " + session.access_token } : undefined,
        data: { organizationId: org.organization.id } 
      } as any);
    },
    enabled: !!org?.organization.id,
  });

  const categories = catData?.categories || [];

  useEffect(() => {
    if (procData?.procedure) {
      const p = procData.procedure;
      setTitle(p.title || "");
      setSummary(p.summary || "");
      setDescription(p.description || "");
      setPriority(p.priority);
      setCategoryId(p.category_id || "");
      setDepartmentId(p.department_id || "");
      setAckRequired(p.acknowledgment_required);
      setExpectedVersion(p.version_number);
      setEffectiveDate(p.effective_date ? p.effective_date.split("T")[0] : "");
      setExpiryDate(p.expiry_date ? p.expiry_date.split("T")[0] : "");
    }
  }, [procData]);

  const p = procData?.procedure;
  const hasUnsavedChanges = Boolean(
    p && (title !== p.title || summary !== (p.summary || "") || description !== p.description),
  );

  const updateMutation = useMutation({
    mutationFn: async (publish: boolean) => {
      if (!org?.organization.id) throw new Error("No org");
      const {
        data: { session },
      } = await supabase.auth.getSession();
      return await updateProcedure({
        headers: session?.access_token
          ? { authorization: "Bearer " + session.access_token }
          : undefined,
        data: {
          id,
          organizationId: org.organization.id,
          title,
          summary,
          description,
          priority,
          categoryId: categoryId || undefined,
          departmentId: departmentId || undefined,
          effectiveDate: effectiveDate || undefined,
          expiryDate: expiryDate || undefined,
          acknowledgmentRequired: ackRequired,
          expectedVersion,
          publish,
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["procedure", id] });
      queryClient.invalidateQueries({ queryKey: ["procedures"] });
      navigate({ to: `/app/procedures/${id}` });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  useBlocker({
    shouldBlockFn: () => {
      if (!hasUnsavedChanges || updateMutation.isSuccess) return false;
      return !window.confirm("You have unsaved changes. Are you sure you want to leave?");
    },
  });

  if (isLoading) {
    return <div className="p-10 font-display italic text-muted-foreground">Loading editor...</div>;
  }

  return (
    <div>
      <PageHeader
        eyebrow="Folio 02 - Editor"
        title="Edit Procedure"
        subtitle="Update the operational procedure."
        actions={
          <div className="flex gap-3 items-center">
            <button
              type="button"
              onClick={() => {
                if (!hasUnsavedChanges || window.confirm("You have unsaved changes. Discard them?")) {
                  navigate({ to: `/app/procedures/${id}` });
                }
              }}
              className="text-muted-foreground hover:text-foreground px-3 py-2 text-sm font-medium transition-colors"
              aria-label="Cancel"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => updateMutation.mutate(false)}
              disabled={updateMutation.isPending || !title}
              className="bg-card text-foreground border border-input px-4 py-2 text-sm rounded-md shadow-sm hover:bg-accent transition-all disabled:opacity-50"
              aria-label="Save procedure as draft"
            >
              {updateMutation.isPending ? "Saving..." : "Save draft"}
            </button>
            <button
              type="button"
              onClick={() => {
                if (
                  window.confirm(
                    "Are you sure you want to publish this update? This will make the new version active and visible to staff.",
                  )
                ) {
                  updateMutation.mutate(true);
                }
              }}
              disabled={updateMutation.isPending || !title}
              className="bg-primary text-primary-foreground px-4 py-2 text-sm rounded-md shadow-sm hover:bg-primary/90 transition-all hover:scale-[1.02] disabled:opacity-50"
              aria-label="Publish procedure to active registry"
            >
              {updateMutation.isPending ? "Publishing..." : "Publish Update"}
            </button>
          </div>
        }
      />

      <div className="px-6 md:px-10 pt-8 md:pt-12 pb-16 max-w-4xl">
        {updateMutation.isError && (
          <div className="mb-8 p-6 border border-destructive/30 bg-destructive/5 text-destructive rounded-xl shadow-sm text-sm">
            {(updateMutation.error as Error).message}
          </div>
        )}
        <form className="space-y-6" onSubmit={(e) => e.preventDefault()}>
          <div>
            <label htmlFor="title-input" className="block eyebrow mb-2">
              Title
            </label>
            <input
              id="title-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-card border border-input px-4 py-2.5 text-base rounded-md shadow-sm focus:ring-primary focus:border-primary transition-all"
              placeholder="e.g. Incident Response Plan"
              aria-required="true"
              aria-invalid={!title ? "true" : "false"}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <label className="block eyebrow mb-2">Category</label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full bg-card border border-input px-3 py-2.5 text-sm rounded-md shadow-sm focus:ring-primary focus:border-primary transition-all"
              >
                <option value="">Uncategorized</option>
                {categories.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block eyebrow mb-2">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as any)}
                className="w-full bg-card border border-input px-3 py-2.5 text-sm rounded-md shadow-sm focus:ring-primary focus:border-primary transition-all"
              >
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="informational">Informational</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block eyebrow mb-2">Summary</label>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              className="w-full bg-card border border-input px-3 py-2.5 text-sm rounded-md shadow-sm focus:ring-primary focus:border-primary transition-all"
              rows={2}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <label className="block eyebrow mb-2">Effective Date</label>
              <input
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
                className="w-full bg-card border border-input px-3 py-2.5 text-sm rounded-md shadow-sm focus:ring-primary focus:border-primary transition-all"
              />
            </div>
            <div>
              <label className="block eyebrow mb-2">Expiry Date</label>
              <input
                type="date"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
                className="w-full bg-card border border-input px-3 py-2.5 text-sm rounded-md shadow-sm focus:ring-primary focus:border-primary transition-all"
              />
            </div>
          </div>
          <div>
            <label className="block eyebrow mb-2">Content (Markdown)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-card border border-input px-4 py-3 text-sm rounded-md shadow-sm font-mono leading-relaxed focus:ring-primary focus:border-primary transition-all"
              rows={12}
            />
          </div>

          <div>
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={ackRequired}
                onChange={(e) => setAckRequired(e.target.checked)}
                className="rounded border-input text-primary focus:ring-primary h-4 w-4 transition-all"
              />
              <span className="text-sm font-medium">Require staff acknowledgment</span>
            </label>
          </div>
        </form>
      </div>
    </div>
  );
}
