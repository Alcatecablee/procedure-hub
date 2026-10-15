import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { getOperationalCompliance } from "@/lib/compliance.server";
import { useEffect } from "react";
import { Info } from "lucide-react";

export const Route = createFileRoute("/app/compliance")({ component: Compliance });

function Compliance() {
  const { user, org } = useAuth();
  const navigate = useNavigate();

  const isManagerOrAbove = org && ["owner", "admin", "manager"].includes(org.role);

  useEffect(() => {
    if (org && !isManagerOrAbove) {
      void navigate({ to: "/app" });
    }
  }, [org, isManagerOrAbove, navigate]);

  interface OperationalComplianceResult {
    overall: {
      totalRequired: number;
      acknowledged: number;
      outstanding: number;
      requiresReack: number;
      compliancePct: number | null;
    };
    byProcedure: any[];
    byDepartment: any[];
    byMember?: any[];
    roster?: any[];
    meta?: {
      profileLookupFailed?: boolean;
    };
  }

  const { data, isLoading, isError } = useQuery<OperationalComplianceResult>({
    queryKey: ["operational-compliance", org?.organization.id, org?.departmentId],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      return (await getOperationalCompliance({ headers: { Authorization: `Bearer ${session?.access_token}` } })) as any;
    },
    enabled: Boolean(user && isManagerOrAbove),
  });

  if (!isManagerOrAbove) return null;
  if (isLoading) return <div className="p-8">Loading compliance analytics...</div>;
  if (isError) return <div className="p-8 text-red-500">Failed to load compliance analytics.</div>;
  if (!data) return null;

  return (
    <div className="max-w-6xl mx-auto pb-12">
      <PageHeader
        eyebrow="Management"
        title="Operational Compliance"
        subtitle={org?.role === "manager" ? "Compliance overview for your department." : "Organization-wide compliance overview."}
      />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-card border border-border p-6 rounded-sm">
          <div className="text-sm font-medium text-muted-foreground mb-1">Overall Compliance</div>
          <div className="text-3xl font-bold">
            {data.overall.compliancePct !== null ? `${data.overall.compliancePct}%` : "N/A"}
          </div>
          <div className="text-xs text-muted-foreground mt-2">
            Based on current procedure versions
          </div>
        </div>
        
        <div className="bg-card border border-border p-6 rounded-sm">
          <div className="text-sm font-medium text-muted-foreground mb-1">Acknowledged</div>
          <div className="text-3xl font-bold text-green-600 dark:text-green-400">
            {data.overall.acknowledged}
          </div>
          <div className="text-xs text-muted-foreground mt-2">
            Up to date
          </div>
        </div>

        <div className="bg-card border border-border p-6 rounded-sm">
          <div className="text-sm font-medium text-muted-foreground mb-1">Requires Re-Ack</div>
          <div className="text-3xl font-bold text-amber-600 dark:text-amber-400">
            {data.overall.requiresReack}
          </div>
          <div className="text-xs text-muted-foreground mt-2">
            Updated procedures
          </div>
        </div>

        <div className="bg-card border border-border p-6 rounded-sm">
          <div className="text-sm font-medium text-muted-foreground mb-1">Outstanding</div>
          <div className="text-3xl font-bold text-red-600 dark:text-red-400">
            {data.overall.outstanding}
          </div>
          <div className="text-xs text-muted-foreground mt-2">
            Never acknowledged
          </div>
        </div>
      </div>

      {data.overall.totalRequired === 0 && data.byProcedure.length > 0 && (
        <div className="mb-8 p-4 bg-muted/40 border border-border rounded-sm flex items-start gap-3 text-sm">
          <Info className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="font-medium text-foreground">No team members currently in scope</div>
            <p className="text-muted-foreground text-xs leading-relaxed">
              Active procedures are currently scoped to specific departments that have no assigned team members. To generate acknowledgment obligations, assign team members to departments in{" "}
              <Link to="/app/team" className="underline hover:text-foreground">
                Team
              </Link>{" "}
              or edit the procedure to be Organization-Wide (all departments).
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <section>
          <h3 className="text-lg font-semibold mb-4">By Procedure</h3>
          <div className="bg-card border border-border rounded-sm overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  <th className="px-4 py-3 font-medium">Procedure</th>
                  <th className="px-4 py-3 font-medium text-right">Compliance</th>
                  <th className="px-4 py-3 font-medium text-right">Out</th>
                  <th className="px-4 py-3 font-medium text-right">ReAck</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.byProcedure.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                      No active procedures
                    </td>
                  </tr>
                ) : (
                  data.byProcedure.map((p: any) => (
                    <tr key={p.procedure_id} className="hover:bg-muted/30">
                      <td className="px-4 py-3 font-medium truncate max-w-[200px]">{p.title}</td>
                      <td className="px-4 py-3 text-right">
                        {p.total === 0 ? (
                          <span className="text-xs text-muted-foreground" title="0 team members assigned to this procedure's department">
                            N/A (0 in scope)
                          </span>
                        ) : p.compliancePct !== null ? (
                          `${p.compliancePct}%`
                        ) : (
                          'N/A'
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-red-600">{p.outstanding > 0 ? p.outstanding : '-'}</td>
                      <td className="px-4 py-3 text-right text-amber-600">{p.requires_reack > 0 ? p.requires_reack : '-'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {(org?.role === "owner" || org?.role === "admin") && (
          <section>
            <h3 className="text-lg font-semibold mb-4">By Department</h3>
            <div className="bg-card border border-border rounded-sm overflow-hidden">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/50 border-b border-border">
                  <tr>
                    <th className="px-4 py-3 font-medium">Department</th>
                    <th className="px-4 py-3 font-medium text-right">Compliance</th>
                    <th className="px-4 py-3 font-medium text-right">Out</th>
                    <th className="px-4 py-3 font-medium text-right">ReAck</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.byDepartment.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                        No departments found
                      </td>
                    </tr>
                  ) : (
                    data.byDepartment.map((d: any) => (
                      <tr key={d.department_id} className="hover:bg-muted/30">
                        <td className="px-4 py-3 font-medium">{d.department_name || (d.department_id === 'unassigned' ? 'Unassigned' : d.department_id)}</td>
                        <td className="px-4 py-3 text-right">
                          {d.total === 0 ? (
                            <span className="text-xs text-muted-foreground" title="0 team members assigned to this department">
                              N/A (0 in scope)
                            </span>
                          ) : d.compliancePct !== null ? (
                            `${d.compliancePct}%`
                          ) : (
                            'N/A'
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-red-600">{d.outstanding > 0 ? d.outstanding : '-'}</td>
                        <td className="px-4 py-3 text-right text-amber-600">{d.requires_reack > 0 ? d.requires_reack : '-'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>

      {/* Team Member Acknowledgments Roster */}
      <section className="mt-10">
        <div className="flex items-baseline justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-foreground">Member Acknowledgments</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Individual procedure acknowledgment obligations across all active team members.
            </p>
          </div>
          <span className="font-mono text-xs text-muted-foreground">
            {data.roster?.length || 0} required record{(data.roster?.length || 0) === 1 ? "" : "s"}
          </span>
        </div>

        {data.meta?.profileLookupFailed && (
          <div className="mb-4 px-3.5 py-2.5 bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-300 rounded-sm text-xs">
            Member profile resolution is currently degraded; display names or emails may temporarily show fallback identifiers. Compliance records and acknowledgment states remain fully tracked.
          </div>
        )}

        <div className="bg-card border border-border rounded-sm overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm min-w-[720px]">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  <th className="px-4 py-3 font-medium">Team Member</th>
                  <th className="px-4 py-3 font-medium">Role</th>
                  <th className="px-4 py-3 font-medium">Department</th>
                  <th className="px-4 py-3 font-medium">Procedure</th>
                  <th className="px-4 py-3 font-medium text-center">Status</th>
                  <th className="px-4 py-3 font-medium text-right">Last Acknowledgment</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {!data.roster || data.roster.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                      No acknowledgment obligations recorded
                    </td>
                  </tr>
                ) : (
                  data.roster.map((row: any) => {
                    const isAcked = row.compliance_status === "ACKNOWLEDGED";
                    const isReack = row.compliance_status === "REQUIRES_REACK";
                    const isOut = row.compliance_status === "OUTSTANDING";

                    return (
                      <tr
                        key={`${row.user_id}:${row.procedure_id}`}
                        className="hover:bg-muted/30 transition-colors"
                      >
                        <td className="px-4 py-3 font-medium">
                          <div className="text-foreground">{row.member_name}</div>
                          {row.member_email && row.member_email !== row.member_name && (
                            <div className="text-xs text-muted-foreground font-mono">
                              {row.member_email}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                            {row.member_role}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">
                          {row.department_name}
                        </td>
                        <td className="px-4 py-3 font-medium">
                          <Link
                            to="/app/procedures/$id"
                            params={{ id: row.procedure_id }}
                            className="hover:underline text-foreground"
                          >
                            {row.procedure_title}
                          </Link>
                          <span className="font-mono text-[10.5px] text-muted-foreground ml-1.5">
                            v{row.current_version_number}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {isAcked ? (
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium font-mono uppercase tracking-wider bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                              Acknowledged
                            </span>
                          ) : isReack ? (
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium font-mono uppercase tracking-wider bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                              Re-Ack Req
                            </span>
                          ) : isOut ? (
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium font-mono uppercase tracking-wider bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20">
                              Outstanding
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium font-mono uppercase tracking-wider bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border border-zinc-500/20">
                              {row.compliance_status || "Unknown"}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {isAcked && row.latest_ack_date ? (
                            <div>
                              <div
                                className="font-mono text-xs text-foreground"
                                title={`${new Date(row.latest_ack_date).toISOString()} (UTC)`}
                              >
                                {new Date(row.latest_ack_date).toLocaleString(undefined, {
                                  year: "numeric",
                                  month: "short",
                                  day: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                  timeZoneName: "short",
                                })}
                              </div>
                              <div className="text-[11px] text-emerald-600 dark:text-emerald-400 font-sans mt-0.5 font-medium">
                                Current version (v{row.current_version_number})
                              </div>
                            </div>
                          ) : isReack && row.latest_ack_date ? (
                            <div>
                              <div
                                className="font-mono text-xs text-foreground"
                                title={`${new Date(row.latest_ack_date).toISOString()} (UTC)`}
                              >
                                {new Date(row.latest_ack_date).toLocaleString(undefined, {
                                  year: "numeric",
                                  month: "short",
                                  day: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                  timeZoneName: "short",
                                })}
                              </div>
                              <div className="text-[11px] text-amber-600 dark:text-amber-400 font-sans font-medium mt-0.5">
                                {row.latest_ack_version_number
                                  ? `v${row.latest_ack_version_number} (Superseded)`
                                  : "Superseded (Older version)"}
                              </div>
                              <div className="text-[10px] text-muted-foreground font-sans">
                                Current v{row.current_version_number} unacknowledged
                              </div>
                            </div>
                          ) : isOut ? (
                            <span className="text-muted-foreground text-xs italic">
                              Never acknowledged
                            </span>
                          ) : (
                            <span className="font-mono text-xs text-muted-foreground">-</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
