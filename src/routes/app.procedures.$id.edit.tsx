import { createFileRoute, useNavigate, useBlocker } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth, useIsManager } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { getProcedure, updateProcedure, getCategories, getDepartments } from "@/lib/procedures.server";
import { supabase } from "@/integrations/supabase/client";
import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/procedures/$id/edit")({
  component: EditProcedure,
});

function EditProcedure() {
  const { id } = Route.useParams();
  const { org } = useAuth();
  const isManager = useIsManager();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isNavigatingAfterSave = useRef(false);

  useEffect(() => {
    if (org && !isManager) {
      void navigate({ to: `/app/procedures/${id}` });
    }
  }, [org, isManager, navigate, id]);

  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<"critical" | "high" | "medium" | "informational">(
    "medium",
  );
  const [categoryId, setCategoryId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [ackRequired, setAckRequired] = useState(true);
  const [ackAudience, setAckAudience] = useState<"staff" | "all_active_members">("staff");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [expectedVersion, setExpectedVersion] = useState(0);

  const { data: deptData } = useQuery({
    queryKey: ["departments"],
    queryFn: async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      return getDepartments({
        headers: session?.access_token
          ? { authorization: "Bearer " + session.access_token }
          : undefined,
      });
    },
  });
  const departments = deptData || [];

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
      setAckAudience(p.acknowledgment_audience || "staff");
      setExpectedVersion(p.version_number);
      setEffectiveDate(p.effective_date ? p.effective_date.split("T")[0] : "");
      setExpiryDate(p.expiry_date ? p.expiry_date.split("T")[0] : "");
    }
  }, [procData]);

  const p = procData?.procedure;
  const hasUnsavedChanges = Boolean(
    p &&
      (title !== p.title ||
        summary !== (p.summary || "") ||
        description !== p.description ||
        priority !== p.priority ||
        categoryId !== (p.category_id || "") ||
        departmentId !== (p.department_id || "") ||
        ackRequired !== p.acknowledgment_required ||
        ackAudience !== (p.acknowledgment_audience || "staff")),
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
          acknowledgmentAudience: ackAudience,
          expectedVersion,
          publish,
        },
      });
    },
    onSuccess: () => {
      isNavigatingAfterSave.current = true;
      queryClient.invalidateQueries({ queryKey: ["procedure", id] });
      queryClient.invalidateQueries({ queryKey: ["procedures"] });
      navigate({ to: `/app/procedures/${id}` });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  useBlocker({
    shouldBlockFn: () => {
      if (isNavigatingAfterSave.current) return false;
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
              <label className="block eyebrow mb-2">Assigned Department</label>
              <select
                value={departmentId}
                onChange={(e) => setDepartmentId(e.target.value)}
                className="w-full bg-card border border-input px-3 py-2.5 text-sm rounded-md shadow-sm focus:ring-primary focus:border-primary transition-all"
              >
                <option value="">Global (All Departments)</option>
                {departments.map((d: any) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
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

          <div className="space-y-4 pt-2">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={ackRequired}
                onChange={(e) => setAckRequired(e.target.checked)}
                className="rounded border-input text-primary focus:ring-primary h-4 w-4 transition-all"
              />
              <span className="text-sm font-medium">Require formal acknowledgment</span>
            </label>

            {ackRequired && (
              <div className="pl-7 max-w-md">
                <label className="block eyebrow mb-1.5">Acknowledgment Audience</label>
                <select
                  value={ackAudience}
                  onChange={(e) => setAckAudience(e.target.value as "staff" | "all_active_members")}
                  className="w-full bg-card border border-input px-3 py-2 text-sm rounded-sm"
                >
                  <option value="staff">Frontline Staff (Default for operational procedures)</option>
                  <option value="all_active_members">All Active Roles (Company-wide policies)</option>
                </select>
                <p className="text-xs text-muted-foreground mt-1">
                  {ackAudience === "staff"
                    ? "Only active frontline staff in the assigned department/scope are required to acknowledge. Management roles are excluded from the compliance denominator."
                    : "All active organization roles (including owners, admins, and managers) in scope are required to acknowledge."}
                </p>
              </div>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
