import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth, useIsAdmin, useIsManager } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { PriorityBadge, StatusBadge } from "@/components/badges";
import {
  getProcedure,
  acknowledgeProcedure,
  getProcedureAuditLogs,
  updateProcedure,
  archiveProcedure,
} from "@/lib/procedures.server";
import { supabase } from "@/integrations/supabase/client";
import { marked } from "marked";
import { toast } from "sonner";

export const Route = createFileRoute("/app/procedures/$id/")({
  component: ProcedureDetail,
});

function ProcedureDetail() {
  const { id } = Route.useParams();
  const { org } = useAuth();
  const isAdmin = useIsAdmin();
  const isManager = useIsManager();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
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

  const { data: logsData } = useQuery({
    queryKey: ["procedureLogs", id, org?.organization.id],
    queryFn: async () => {
      if (!org?.organization.id) return null;
      const {
        data: { session },
      } = await supabase.auth.getSession();
      return await getProcedureAuditLogs({
        headers: session?.access_token
          ? { authorization: "Bearer " + session.access_token }
          : undefined,
        data: { organizationId: org.organization.id, id },
      } as any);
    },
    enabled: !!org?.organization.id,
  });

  const archiveMutation = useMutation({
    mutationFn: async () => {
      if (!org?.organization.id) throw new Error("No org");
      const {
        data: { session },
      } = await supabase.auth.getSession();
      return await archiveProcedure({
        headers: session?.access_token
          ? { authorization: "Bearer " + session.access_token }
          : undefined,
        data: { organizationId: org.organization.id, id },
      } as any);
    },
    onSuccess: () => {
      toast.success("Procedure archived");
      queryClient.invalidateQueries({ queryKey: ["procedure", id] });
      queryClient.invalidateQueries({ queryKey: ["procedures"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const ackMutation = useMutation({
    mutationFn: async (versionId: string) => {
      if (!org?.organization.id) throw new Error("No org");
      const {
        data: { session },
      } = await supabase.auth.getSession();
      return await acknowledgeProcedure({
        headers: session?.access_token
          ? { authorization: "Bearer " + session.access_token }
          : undefined,
        data: { organizationId: org.organization.id, procedureId: id, versionId },
      } as any);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["procedure", id] });
      queryClient.invalidateQueries({ queryKey: ["procedures"] });
      toast.success("Procedure acknowledged successfully.");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const publishDraftMutation = useMutation({
    mutationFn: async () => {
      if (!org?.organization.id) throw new Error("No org");
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const procedure = data?.procedure;
      if (!procedure) throw new Error("No procedure");
      return await updateProcedure({
        headers: session?.access_token
          ? { authorization: "Bearer " + session.access_token }
          : undefined,
        data: {
          id,
          organizationId: org.organization.id,
          title: procedure.title,
          summary: procedure.summary,
          description: procedure.description,
          priority: procedure.priority,
          categoryId: procedure.category_id || undefined,
          acknowledgmentRequired: procedure.acknowledgment_required,
          publish: true,
          expectedVersion: procedure.version_number,
        },
      } as any);
    },
    onSuccess: (res) => {
      if (!res) return;
      toast.success("Draft published to active registry!");
      queryClient.invalidateQueries({ queryKey: ["procedure", id] });
      queryClient.invalidateQueries({ queryKey: ["procedures"] });
      queryClient.invalidateQueries({ queryKey: ["procedureLogs", id] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (isLoading) {
    return (
      <div className="p-10 font-display italic text-muted-foreground">Retrieving document...</div>
    );
  }

  if (!data || !data.procedure) {
    return <div className="p-10 text-destructive">Procedure not found.</div>;
  }

  const { procedure: p, versions, acknowledgedVersions } = data;
  const currentVer = versions.find((v: any) => v.id === p.current_version_id);
  const isAcked = currentVer ? acknowledgedVersions.includes(currentVer.id) : false;
  const needsAck = p.acknowledgment_required && p.status === "active" && currentVer && !isAcked;

  return (
    <div>
      <PageHeader
        eyebrow={`Folio 02 - ${p.categories?.name || "Uncategorized"}`}
        title={p.title}
        subtitle={p.summary || "No summary provided."}
        actions={
          isManager ? (
            <div className="flex gap-2">
              <button
                onClick={() => void navigate({ to: `/app/procedures/${p.id}/edit` })}
                className="bg-card text-foreground border border-input px-4 py-2 text-sm rounded-md shadow-sm hover:bg-accent transition-all duration-200"
                aria-label={`Edit procedure: ${p.title}`}
              >
                Edit procedure
              </button>
              {p.status !== "archived" && p.status !== "replaced" && (
                <button
                  onClick={() => {
                    if (window.confirm("Are you sure you want to archive this procedure?")) {
                      archiveMutation.mutate();
                    }
                  }}
                  disabled={archiveMutation.isPending}
                  className="bg-card text-destructive border border-destructive/20 px-4 py-2 text-sm rounded-md shadow-sm hover:bg-destructive/10 disabled:opacity-50 transition-all duration-200"
                  aria-label={`Archive procedure: ${p.title}`}
                >
                  Archive
                </button>
              )}
            </div>
          ) : undefined
        }
      />

      <div className="px-6 md:px-10 pt-8 md:pt-12 pb-16 max-w-4xl">
        <div className="flex gap-4 mb-8">
          <StatusBadge value={p.status} />
          <PriorityBadge value={p.priority} />
          <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground flex items-center">
            v{p.version_number}
          </div>
        </div>

        {isManager && p.status === "draft" && (
          <div className="mb-8 p-8 border border-accent/50 bg-accent/10 rounded-xl shadow-sm flex items-start justify-between gap-6">
            <div>
              <h3 className="font-display font-medium mb-1">Draft Procedure</h3>
              <p className="text-sm text-foreground/80 max-w-xl">
                This procedure is currently a draft and is not visible to general staff. Publish it
                to the active registry to make it official.
              </p>
            </div>
            <button
              onClick={() => {
                if (
                  window.confirm(
                    "Are you sure you want to publish this draft to the active registry? This will make it visible to all staff.",
                  )
                ) {
                  publishDraftMutation.mutate();
                }
              }}
              disabled={publishDraftMutation.isPending}
              className="shrink-0 bg-primary text-primary-foreground px-5 py-2.5 text-sm rounded-lg shadow-sm hover:bg-primary/90 transition-all hover:scale-[1.02] disabled:opacity-50"
              aria-label={`Publish draft procedure: ${p.title}`}
            >
              {publishDraftMutation.isPending ? "Publishing..." : "Publish to active registry"}
            </button>
          </div>
        )}

        {needsAck && (
          <div className="mb-8 p-8 border border-priority-high/30 bg-priority-high/5 rounded-xl shadow-sm flex items-start justify-between gap-6">
            <div>
              <h3 className="font-display font-medium text-priority-high mb-1">
                Acknowledgment Required
              </h3>
              <p className="text-sm text-foreground/80 leading-relaxed max-w-xl">
                Please review the contents of this procedure carefully. You are required to formally
                acknowledge that you have read and understood the current version.
              </p>
            </div>
            <button
              onClick={() => ackMutation.mutate(currentVer.id)}
              disabled={ackMutation.isPending}
              className="shrink-0 bg-priority-high text-white px-5 py-2.5 text-sm rounded-lg shadow-sm hover:bg-priority-high/90 transition-all hover:scale-[1.02] disabled:opacity-50"
              aria-label={`Acknowledge procedure: ${p.title}`}
            >
              {ackMutation.isPending ? "Signing..." : "Acknowledge"}
            </button>
          </div>
        )}

        {isAcked && currentVer && (
          <div className="mb-8 p-4 border border-border bg-card rounded-xl shadow-sm flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-priority-medium" />
            <p className="text-sm text-muted-foreground font-mono">
              You have acknowledged v{currentVer.version_number}.
            </p>
          </div>
        )}

        <div className="prose prose-base md:prose-lg prose-neutral dark:prose-invert max-w-none mb-16 prose-headings:font-display prose-headings:font-medium prose-p:leading-relaxed prose-a:text-primary prose-a:no-underline hover:prose-a:underline prose-strong:text-foreground">
          <div dangerouslySetInnerHTML={{ __html: marked.parse(p.description || "No content.") }} />
        </div>

        <div className="pt-10">
          <h2 className="font-display text-lg mb-6">Version History</h2>
          <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
          <ul className="divide-y divide-border">
            {versions.map((v: any) => (
              <li key={v.id} className="px-6 py-4 flex justify-between items-center text-sm hover:bg-muted/30 transition-colors">
                <div>
                  <span className="font-medium mr-3">v{v.version_number}</span>
                  <span className="text-muted-foreground">
                    {new Date(v.created_at).toLocaleDateString()}
                  </span>
                </div>
                {v.id === p.current_version_id && (
                  <span className="text-[10px] uppercase tracking-widest bg-accent px-2 py-0.5 rounded-sm">
                    Current
                  </span>
                )}
              </li>
            ))}
          </ul>
          </div>
        </div>
        <div className="pt-10 mt-12 border-t border-border">
          <h2 className="font-display text-lg mb-6">Audit History</h2>
          {logsData && logsData.length > 0 ? (
            <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
            <ul className="divide-y divide-border text-sm">
              {logsData.map((log: any) => (
                <li key={log.id} className="px-6 py-4 flex flex-col gap-1 hover:bg-muted/30 transition-colors">
                  <div className="flex justify-between text-muted-foreground">
                    <span className="font-mono text-xs uppercase tracking-wider">
                      {{
                        procedure_created: "Draft Created",
                        procedure_updated: "Draft Updated",
                        procedure_published: "Published",
                        procedure_acknowledged: "Acknowledged",
                        procedure_archived: "Archived",
                      }[log.event_type as string] || log.event_type.replace(/_/g, " ")}
                    </span>
                    <span className="text-xs">{new Date(log.created_at).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between items-baseline">
                    <span>
                      <span className="font-medium text-foreground">
                        {log.profiles?.full_name || log.profiles?.email || "Unknown User"}
                      </span>
                      <span className="text-muted-foreground"> performed action</span>
                    </span>
                    <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                      {log.metadata?.version
                        ? "v" + log.metadata.version
                        : log.metadata?.procedure_id
                          ? "publish"
                          : "id " + log.id.slice(0, 8)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No audit logs found.</p>
          )}
        </div>
      </div>
    </div>
  );
}
