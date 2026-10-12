import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { getOperationalCompliance } from "@/lib/compliance.server";
import { useEffect } from "react";

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
                        {p.compliancePct !== null ? `${p.compliancePct}%` : 'N/A'}
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
                          {d.compliancePct !== null ? `${d.compliancePct}%` : 'N/A'}
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
    </div>
  );
}
