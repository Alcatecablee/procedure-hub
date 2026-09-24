// @ts-nocheck
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth, useIsManager } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { toast } from "sonner";
import { ingestTeamsExport, getImports } from "@/lib/import.server";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";

export const Route = createFileRoute("/app/import/")({ component: ImportPage });

function ImportPage() {
  const { org } = useAuth();
  const isManager = useIsManager();
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [platform, setPlatform] = useState<
    "teams" | "slack" | "whatsapp" | "discord" | "email" | "other"
  >("teams");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isManager) void navigate({ to: "/app" });
  }, [isManager, navigate]);

  const {
    data: pastImports,
    refetch,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["imports", org?.organization.id],
    queryFn: async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      return getImports({
        headers: session?.access_token
          ? { authorization: "Bearer " + session.access_token }
          : undefined,
        data: { organizationId: org!.organization.id },
      });
    },
    enabled: !!org,
  });

  const upload = async (f: File) => setText(await f.text());

  const ingest = async () => {
    if (!text.trim()) return toast.error("Paste an export first.");
    if (!org) return;
    setBusy(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const res = await ingestTeamsExport({
        data: { organizationId: org.organization.id, rawText: text, sourceType: platform },
        headers: session?.access_token
          ? { authorization: "Bearer " + session.access_token }
          : undefined,
      });
      toast.success("Extraction complete. Ready for review.");
      void navigate({ to: `/app/import/${res.importId}` });
    } catch (e) {
      toast.error((e as Error).message);
      void refetch(); // refresh the list to show the failed import
    } finally {
      setBusy(false);
    }
  };

  if (!isManager) return null;
  return (
    <div>
      <PageHeader
        eyebrow="Folio 04 - Import"
        title="Ingest Operational Procedures"
        subtitle="Paste a raw chat export. The AI will isolate actionable procedures and stage them for human review."
      />
      <div className="px-6 md:px-10 py-6 max-w-4xl space-y-12">
        <div className="space-y-6">
          <div className="grid md:grid-cols-4 gap-4 items-end">
            <div className="md:col-span-1">
              <div className="eyebrow mb-1.5">Source</div>
              <select
                value={platform}
                onChange={(e) => setPlatform(e.target.value as any)}
                className="w-full bg-card border border-input px-2.5 py-2 text-sm rounded-sm"
              >
                {["teams", "slack", "whatsapp", "discord", "email", "other"].map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </div>
            <div className="md:col-span-3">
              <div className="eyebrow mb-1.5">Upload .txt (optional)</div>
              <input
                type="file"
                accept=".txt,text/plain"
                onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])}
                className="text-sm"
              />
            </div>
          </div>
          <div>
            <div className="eyebrow mb-1.5">Paste export</div>
            <textarea
              rows={10}
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="w-full bg-card border border-input px-3 py-2 text-sm rounded-sm font-mono"
              placeholder="Paste the raw chat export here..."
            />
          </div>
          <div>
            <button
              onClick={() => void ingest()}
              disabled={busy}
              className="bg-primary text-primary-foreground px-5 py-2.5 text-sm rounded-sm hover:bg-primary/90 disabled:opacity-60"
              aria-label="Extract procedures from chat export"
            >
              {busy ? "Processing... this takes about 10 seconds" : "Extract procedures"}
            </button>
          </div>
        </div>

        {isLoading && (
          <div className="rule-strong pt-6">
            <div className="eyebrow mb-4">Past Ingestion Jobs</div>
            <div className="py-8 text-sm text-muted-foreground font-display italic">
              Loading past imports...
            </div>
          </div>
        )}

        {isError && (
          <div className="rule-strong pt-6">
            <div className="eyebrow mb-4">Past Ingestion Jobs</div>
            <div className="py-8 text-sm text-destructive font-display italic">
              Failed to load past imports.
            </div>
          </div>
        )}

        {!isLoading && !isError && pastImports && pastImports.length > 0 && (
          <div className="rule-strong pt-6">
            <div className="eyebrow mb-4">Past Ingestion Jobs</div>
            <div className="border border-border rounded-sm overflow-hidden bg-card">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium">Source</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Candidates</th>
                    <th className="px-4 py-3 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {pastImports.map((imp) => (
                    <tr key={imp.id}>
                      <td className="px-4 py-3 tabular-nums">
                        {new Date(imp.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 capitalize">{imp.source_type}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            imp.status === "completed"
                              ? "bg-green-500/10 text-green-600"
                              : imp.status === "failed"
                                ? "bg-red-500/10 text-red-600"
                                : imp.status === "review"
                                  ? "bg-blue-500/10 text-blue-600"
                                  : "bg-yellow-500/10 text-yellow-600"
                          }`}
                        >
                          {imp.status}
                        </span>
                        {imp.error_message && (
                          <div
                            className="text-[10px] text-red-500 mt-1 max-w-[200px] truncate"
                            title={imp.error_message}
                          >
                            {imp.error_message}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 tabular-nums">{imp.candidate_count || 0}</td>
                      <td className="px-4 py-3">
                        <Link
                          to={`/app/import/${imp.id}`}
                          className="text-blue-500 hover:underline"
                        >
                          View details
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
