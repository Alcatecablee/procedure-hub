import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useAuth, useIsAdmin } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { PriorityBadge, StatusBadge } from "@/components/badges";
import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getProcedures } from "@/lib/procedures.server";
import { supabase } from "@/integrations/supabase/client";

// We need a search dependencies interface
interface ProceduresSearch {
  q?: string;
  status?: string;
}

export const Route = createFileRoute("/app/procedures/")({
  validateSearch: (search: Record<string, unknown>): ProceduresSearch => {
    return {
      q: search.q as string | undefined,
      status: search.status as string | undefined,
    };
  },
  component: ProceduresList,
});

function ProceduresList() {
  const { user, org } = useAuth();
  const isAdmin = useIsAdmin();
  const navigate = useNavigate({ from: Route.fullPath });
  const search = Route.useSearch();

  const [q, setQ] = useState(search.q || "");
  const [stat, setStat] = useState<string>(search.status || "active");
  useEffect(() => {
    navigate({
      search: { q: q || undefined, status: stat !== "active" ? stat : undefined },
      replace: true,
    });
  }, [q, stat, navigate]);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["procedures", org?.organization.id, q, stat],
    queryFn: async () => {
      if (!org?.organization.id) return { procedures: [] };
      const {
        data: { session },
      } = await supabase.auth.getSession();
      return await getProcedures({
        headers: session?.access_token
          ? { authorization: "Bearer " + session.access_token }
          : undefined,
        data: {
          organizationId: org.organization.id,
          query: q,
          status: stat as any,
          page: 1,
          pageSize: 100,
        },
      });
    },
    enabled: !!org?.organization.id,
  });

  const procedures = data?.procedures || [];

  return (
    <div>
      <PageHeader
        eyebrow="Folio 02 - Procedures"
        title="The procedure register"
        subtitle="Search, filter, and consult the operational record."
        actions={
          isAdmin ? (
            <button
              onClick={() => void navigate({ to: "/app/procedures/new" })}
              className="bg-primary text-primary-foreground px-4 py-2 text-sm rounded-sm hover:bg-primary/90"
              aria-label="Create new procedure"
            >
              New procedure
            </button>
          ) : undefined
        }
      />

      <div className="px-6 md:px-10 py-6 max-w-6xl">
        <div className="flex flex-wrap gap-3 items-end mb-6 pb-6 border-b border-border">
          <Field label="Search">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Title or content..."
              className="w-64 bg-card border border-input px-3 py-1.5 text-sm rounded-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </Field>
          <Field label="Status">
            <Select
              value={stat}
              onChange={setStat}
              options={[
                ["active", "Active"],
                ["draft", "Draft"],
                ["archived", "Archived"],
                ["replaced", "Replaced"],
                ["all", "All"],
              ]}
            />
          </Field>
        </div>

        <div className="border-t border-border-strong" aria-live="polite">
          {isError ? (
            <div className="py-10 text-sm text-destructive font-display italic">
              Failed to load procedures: {(error as Error)?.message || "Unknown error"}
            </div>
          ) : isLoading ? (
            <div className="py-10 text-sm text-muted-foreground font-display italic">
              Consulting the record...
            </div>
          ) : procedures.length === 0 ? (
            <div className="py-10 text-sm text-muted-foreground font-display italic">
              No procedures match these filters.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {procedures.map((p: any, i: number) => {
                return (
                  <li key={p.id} className="ledger-row">
                    <Link
                      to="/app/procedures/$id"
                      params={{ id: p.id }}
                      className="block py-4 grid grid-cols-12 gap-4 items-baseline"
                    >
                      <div className="col-span-1 font-mono text-[11px] text-muted-foreground num pt-1">
                        {String(i + 1).padStart(3, "0")}
                      </div>
                      <div className="col-span-7">
                        <div className="text-[15px] leading-snug flex items-baseline gap-2">
                          <span>{p.title}</span>
                          {p.acknowledgment_required && p.status === "active" && (
                            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-priority-high">
                              · Sign required
                            </span>
                          )}
                        </div>
                        <div className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground mt-1">
                          v{p.version_number} · Updated{" "}
                          {new Date(p.updated_at).toLocaleDateString()}
                        </div>
                      </div>
                      <div className="col-span-4 flex items-center justify-end gap-2 flex-wrap">
                        <PriorityBadge value={p.priority} />
                        <StatusBadge value={p.status} />
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="eyebrow mb-1">{label}</div>
      {children}
    </div>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-card border border-input px-2.5 py-1.5 text-sm rounded-sm focus:outline-none focus:ring-1 focus:ring-ring"
    >
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}
