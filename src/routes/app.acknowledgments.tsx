import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { getStaffCompliance } from "@/lib/compliance.server";

export const Route = createFileRoute("/app/acknowledgments")({ component: Acks });

function Acks() {
  const { user } = useAuth();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["staff-compliance", user?.id],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      return getStaffCompliance({ headers: { Authorization: `Bearer ${session?.access_token}` } });
    },
    enabled: !!user,
  });

  if (isLoading) return <div className="p-8">Loading compliance...</div>;
  if (isError) return <div className="p-8 text-red-500">Failed to load compliance data.</div>;
  if (!data) return null;

  return (
    <div className="max-w-5xl mx-auto pb-12">
      <PageHeader
        eyebrow="My Compliance"
        title="Acknowledgments"
        subtitle="Review and acknowledge your required procedures."
      />

      {data.totalRequired === 0 ? (
        <div className="bg-card border border-border p-8 rounded-sm text-center">
          <p className="text-muted-foreground">No required procedures</p>
        </div>
      ) : (
        <div className="space-y-8">
          
          {data.outstanding.length > 0 && (
            <section>
              <h3 className="text-lg font-semibold mb-4 text-red-600 dark:text-red-400">Action Required: Outstanding</h3>
              <div className="bg-card border border-red-200 dark:border-red-900 rounded-sm overflow-hidden">
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted/50 border-b border-border">
                    <tr>
                      <th className="px-4 py-3 font-medium">Procedure</th>
                      <th className="px-4 py-3 font-medium">Version</th>
                      <th className="px-4 py-3 font-medium text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.outstanding.map((row) => (
                      <tr key={row.procedure_id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 font-medium">
                          <Link to="/app/procedures/$id" params={{ id: row.procedure_id }} className="hover:underline">
                            {row.procedure_title}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">v{row.current_version_number}</td>
                        <td className="px-4 py-3 text-right">
                          <Link to="/app/procedures/$id" params={{ id: row.procedure_id }} className="text-primary hover:underline">
                            Review & Acknowledge
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {data.requiresReack.length > 0 && (
            <section>
              <h3 className="text-lg font-semibold mb-4 text-amber-600 dark:text-amber-400">Action Required: Updated Procedures</h3>
              <div className="bg-card border border-amber-200 dark:border-amber-900 rounded-sm overflow-hidden">
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted/50 border-b border-border">
                    <tr>
                      <th className="px-4 py-3 font-medium">Procedure</th>
                      <th className="px-4 py-3 font-medium">Previous Ack</th>
                      <th className="px-4 py-3 font-medium">Current Version</th>
                      <th className="px-4 py-3 font-medium text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.requiresReack.map((row) => (
                      <tr key={row.procedure_id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 font-medium">
                          <Link to="/app/procedures/$id" params={{ id: row.procedure_id }} className="hover:underline">
                            {row.procedure_title}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {row.latest_ack_date ? new Date(row.latest_ack_date).toLocaleDateString() : 'N/A'}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">v{row.current_version_number}</td>
                        <td className="px-4 py-3 text-right">
                          <Link to="/app/procedures/$id" params={{ id: row.procedure_id }} className="text-primary hover:underline">
                            Review Changes
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {data.acknowledged.length > 0 && (
            <section>
              <h3 className="text-lg font-semibold mb-4 text-green-600 dark:text-green-400">Up to Date</h3>
              <div className="bg-card border border-green-200 dark:border-green-900/50 rounded-sm overflow-hidden opacity-80">
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted/50 border-b border-border">
                    <tr>
                      <th className="px-4 py-3 font-medium">Procedure</th>
                      <th className="px-4 py-3 font-medium">Version</th>
                      <th className="px-4 py-3 font-medium text-right">Acknowledged On</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.acknowledged.map((row) => (
                      <tr key={row.procedure_id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 font-medium">
                          <Link to="/app/procedures/$id" params={{ id: row.procedure_id }} className="hover:underline">
                            {row.procedure_title}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">v{row.current_version_number}</td>
                        <td className="px-4 py-3 text-right text-muted-foreground">
                          {row.latest_ack_date ? new Date(row.latest_ack_date).toLocaleDateString() : 'N/A'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

        </div>
      )}
    </div>
  );
}
