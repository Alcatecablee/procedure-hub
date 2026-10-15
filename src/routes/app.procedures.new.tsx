import { createFileRoute, useNavigate, useBlocker } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAuth, useIsManager } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { createProcedure, getCategories, getDepartments } from "@/lib/procedures.server";
import { supabase } from "@/integrations/supabase/client";
import { useState, useEffect } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/procedures/new")({
  component: NewProcedure,
});

function NewProcedure() {
  const { org } = useAuth();
  const isManager = useIsManager();
  const navigate = useNavigate();

  useEffect(() => {
    if (org && !isManager) {
      void navigate({ to: "/app/procedures" });
    }
  }, [org, isManager, navigate]);

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
  const { data: catData, isLoading: catLoading, isError: catError } = useQuery({
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

  const hasUnsavedChanges = Boolean(title || summary || description);

  const createMutation = useMutation({
    mutationFn: async (publish: boolean) => {
      if (!org?.organization.id) throw new Error("No org");
      const {
        data: { session },
      } = await supabase.auth.getSession();
      return await createProcedure({
        headers: session?.access_token
          ? { authorization: "Bearer " + session.access_token }
          : undefined,
        data: {
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
          publish,
        },
      });
    },
    onSuccess: (data) => {
      navigate({ to: `/app/procedures/${data.procedureId}` });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  useBlocker({
    shouldBlockFn: () => {
      if (!hasUnsavedChanges || createMutation.isSuccess) return false;
      return !window.confirm("You have unsaved changes. Are you sure you want to leave?");
    },
  });

  return (
    <div>
      <PageHeader
        eyebrow="Folio 02 - Editor"
        title="New Procedure"
        subtitle="Draft a new operational procedure."
        actions={
          <div className="flex gap-3 items-center">
            <button
              type="button"
              onClick={() => {
                if (!hasUnsavedChanges || window.confirm("You have unsaved changes. Discard them?")) {
                  navigate({ to: "/app/procedures" });
                }
              }}
              className="text-muted-foreground hover:text-foreground px-3 py-2 text-sm font-medium transition-colors"
              aria-label="Cancel"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => createMutation.mutate(false)}
              disabled={createMutation.isPending || !title}
              className="bg-card text-foreground border border-input px-4 py-2 text-sm rounded-sm hover:bg-accent disabled:opacity-50"
              aria-label="Save procedure as draft"
            >
              {createMutation.isPending ? "Saving..." : "Save draft"}
            </button>
            <button
              type="button"
              onClick={() => {
                if (
                  window.confirm(
                    "Are you sure you want to publish this procedure? This will make it active and visible to staff.",
                  )
                ) {
                  createMutation.mutate(true);
                }
              }}
              disabled={createMutation.isPending || !title}
              className="bg-primary text-primary-foreground px-4 py-2 text-sm rounded-sm hover:bg-primary/90 disabled:opacity-50"
              aria-label="Publish procedure to active registry"
            >
              {createMutation.isPending ? "Publishing..." : "Publish"}
            </button>
          </div>
        }
      />

      <div className="px-6 md:px-10 py-6 max-w-4xl">
        <form className="space-y-6" onSubmit={(e) => e.preventDefault()}>
          <div>
            <label htmlFor="title-input" className="block eyebrow mb-2">
              Title
            </label>
            <input
              id="title-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-card border border-input px-3 py-2 text-sm rounded-sm text-lg font-medium"
              placeholder="E.g., Emergency Escalation Protocol"
              aria-required="true"
              aria-invalid={!title ? "true" : "false"}
            />
            {!title && (
              <p className="text-[11px] text-destructive mt-1">A procedure requires a title.</p>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <label className="block eyebrow mb-2">Category</label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full bg-card border border-input px-3 py-2 text-sm rounded-sm"
              >
                <option value="">Uncategorized</option>
                {catError ? (
                  <option disabled>Failed to load categories</option>
                ) : catLoading ? (
                  <option disabled>Loading categories...</option>
                ) : categories.map((c: any) => (
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
                className="w-full bg-card border border-input px-3 py-2 text-sm rounded-sm"
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
                className="w-full bg-card border border-input px-3 py-2 text-sm rounded-sm"
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
              className="w-full bg-card border border-input px-3 py-2 text-sm rounded-sm"
              rows={2}
            />
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className="block eyebrow mb-2">Effective Date</label>
              <input
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
                className="w-full bg-card border border-input px-3 py-2 text-sm rounded-sm"
              />
            </div>
            <div>
              <label className="block eyebrow mb-2">Expiry Date</label>
              <input
                type="date"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
                className="w-full bg-card border border-input px-3 py-2 text-sm rounded-sm"
              />
            </div>
          </div>
          <div>
            <label className="block eyebrow mb-2">Content (Markdown)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-card border border-input px-3 py-2 text-sm rounded-sm font-mono"
              rows={12}
            />
          </div>

          <div className="space-y-4 pt-2">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={ackRequired}
                onChange={(e) => setAckRequired(e.target.checked)}
                className="rounded border-input text-primary focus:ring-primary h-4 w-4"
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
