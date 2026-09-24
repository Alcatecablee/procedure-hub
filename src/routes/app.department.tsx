// @ts-nocheck — preserved from original; remove once types.ts is fully updated
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { useAuth, useIsAdmin, useIsManager } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  getTeamMembers,
  getPendingInvitations,
  createInvitation,
  resendInvitation,
  cancelInvitation,
} from "@/lib/team.server";

export const Route = createFileRoute("/app/department")({ component: Department });

function Department() {
  const { membership } = useAuth();
  const navigate = useNavigate();
  const isManager = useIsManager();
  const isAdmin = useIsAdmin();
  const queryClient = useQueryClient();

  // Route guard: only Managers (including owner/admin who are also managers) may enter.
  // Staff are redirected. Note: this is a UX redirect only; backend enforces authorization.
  useEffect(() => {
    if (!isManager) void navigate({ to: "/app" });
  }, [isManager, navigate]);

  // Invite form state — restricted to staff-only for this page
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteDesignation, setInviteDesignation] = useState("");
  const [isInviting, setIsInviting] = useState(false);

  const getHeaders = async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.access_token ? { authorization: "Bearer " + session.access_token } : undefined;
  };

  // Queries are enabled for any manager (including admin/owner who act as manager here)
  const { data: members = [], isLoading: loadingMembers, isError: isMembersError, error: membersError } = useQuery({
    queryKey: ["department", "members"],
    queryFn: async () => {
      const headers = await getHeaders();
      return await getTeamMembers({ headers });
    },
    enabled: isManager,
  });

  const { data: invitations = [], isLoading: loadingInvitations, isError: isInvitationsError } = useQuery({
    queryKey: ["department", "invitations"],
    queryFn: async () => {
      const headers = await getHeaders();
      return await getPendingInvitations({ headers });
    },
    enabled: isManager,
  });

  const inviteMut = useMutation({
    mutationFn: async () => {
      const headers = await getHeaders();
      // role is hardcoded to "staff" — Managers can only invite staff.
      return await createInvitation({
        headers,
        data: {
          email: inviteEmail,
          role: "staff",
          designation: inviteDesignation || undefined,
          // department_id is intentionally omitted; server derives it from authenticated context.
        },
      });
    },
    onSuccess: () => {
      setInviteEmail("");
      setInviteDesignation("");
      queryClient.invalidateQueries({ queryKey: ["department", "invitations"] });
      queryClient.invalidateQueries({ queryKey: ["department", "members"] });
      toast.success("Invitation sent");
      setIsInviting(false);
    },
    onError: (e) => toast.error((e as Error).message),
    onSettled: () => setIsInviting(false),
  });

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail) return;
    setIsInviting(true);
    inviteMut.mutate();
  };

  const resendMut = useMutation({
    mutationFn: async (id: string) => {
      const headers = await getHeaders();
      return await resendInvitation({ headers, data: { id } });
    },
    onSuccess: () => toast.success("Invitation resent"),
    onError: (e) => toast.error((e as Error).message),
  });

  const cancelMut = useMutation({
    mutationFn: async (id: string) => {
      const headers = await getHeaders();
      return await cancelInvitation({ headers, data: { id } });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["department", "invitations"] });
      toast.success("Invitation cancelled");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  // Do not render until manager status is confirmed — prevents flash of unauthorized content.
  if (!isManager) return null;

  return (
    <div>
      <PageHeader
        eyebrow="Folio 05"
        title="My Department"
        subtitle="Manage staff within your assigned department."
      />
      <div className="px-6 md:px-10 py-6 max-w-6xl space-y-12">
        {/* Invite Form — role is locked to "staff"; no role selector shown */}
        <section>
          <div className="eyebrow mb-6">Invite Staff</div>
          <form
            onSubmit={handleInvite}
            className="bg-card border border-border p-5 grid grid-cols-1 md:grid-cols-12 gap-4 items-end"
          >
            <div className="md:col-span-5">
              <label className="eyebrow block mb-1.5 text-muted-foreground">Email Address</label>
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="colleague@example.com"
                required
                disabled={isInviting}
                className="w-full bg-background border border-input px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            <div className="md:col-span-5">
              <label className="eyebrow block mb-1.5 text-muted-foreground">Designation (optional)</label>
              <input
                type="text"
                value={inviteDesignation}
                onChange={(e) => setInviteDesignation(e.target.value)}
                placeholder="e.g. Call Center Agent"
                disabled={isInviting}
                className="w-full bg-background border border-input px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            <div className="md:col-span-2">
              <button
                type="submit"
                disabled={isInviting || !inviteEmail}
                className="bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50 w-full"
              >
                {isInviting ? "..." : "Invite"}
              </button>
            </div>
          </form>
          <p className="text-xs text-muted-foreground mt-2">
            Invitations are automatically assigned to your department as <span className="font-medium">staff</span>.
          </p>
        </section>

        {/* Pending Invitations */}
        {(loadingInvitations || isInvitationsError || invitations.length > 0) && (
          <section>
            <div className="eyebrow mb-6">Pending Invitations</div>
            <div className="border border-border bg-card overflow-hidden">
              <table className="w-full text-sm text-left">
                <thead className="bg-muted text-muted-foreground text-xs uppercase tracking-wider font-mono border-b border-border">
                  <tr>
                    <th className="px-5 py-3 font-medium">Email</th>
                    <th className="px-5 py-3 font-medium">Designation</th>
                    <th className="px-5 py-3 font-medium">Invited At</th>
                    <th className="px-5 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {isInvitationsError ? (
                    <tr>
                      <td colSpan={4} className="px-5 py-6 text-center text-destructive">
                        Failed to load pending invitations.
                      </td>
                    </tr>
                  ) : loadingInvitations ? (
                    <tr>
                      <td colSpan={4} className="px-5 py-6 text-center text-muted-foreground">
                        Loading invitations...
                      </td>
                    </tr>
                  ) : (
                    invitations.map((inv) => (
                      <tr key={inv.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-5 py-3 font-medium">{inv.profiles?.email || "Unknown"}</td>
                        <td className="px-5 py-3 text-muted-foreground">{inv.designation || "-"}</td>
                        <td className="px-5 py-3 text-muted-foreground">
                          {new Date(inv.created_at).toLocaleDateString()}
                        </td>
                        <td className="px-5 py-3 text-right space-x-3">
                          <button
                            onClick={() => resendMut.mutate(inv.id)}
                            className="text-primary hover:underline text-xs"
                            disabled={resendMut.isPending}
                          >
                            Resend
                          </button>
                          <button
                            onClick={() => {
                              if (window.confirm("Cancel this invitation?")) cancelMut.mutate(inv.id);
                            }}
                            className="text-destructive hover:underline text-xs"
                            disabled={cancelMut.isPending}
                          >
                            Cancel
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Department Members — read-only view. Managers cannot edit roles or departments. */}
        <section>
          <div className="eyebrow mb-6">Department Members</div>
          <div className="border border-border bg-card overflow-hidden">
            <table className="w-full text-sm text-left">
              <thead className="bg-muted text-muted-foreground text-xs uppercase tracking-wider font-mono border-b border-border">
                <tr>
                  <th className="px-5 py-3 font-medium">Name</th>
                  <th className="px-5 py-3 font-medium">Role</th>
                  <th className="px-5 py-3 font-medium">Designation</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isMembersError ? (
                  <tr>
                    <td colSpan={4} className="px-5 py-8 text-center text-destructive">
                      Failed to load members: {(membersError as Error)?.message || "Unknown error"}
                    </td>
                  </tr>
                ) : loadingMembers ? (
                  <tr>
                    <td colSpan={4} className="px-5 py-8 text-center text-muted-foreground">
                      Loading members...
                    </td>
                  </tr>
                ) : members.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-5 py-8 text-center text-muted-foreground">
                      No members in your department yet.
                    </td>
                  </tr>
                ) : (
                  members.map((m) => (
                    <tr key={m.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-5 py-3">
                        <div className="font-medium">{m.profiles?.full_name || "-"}</div>
                        <div className="text-muted-foreground text-xs">
                          {m.profiles?.email || "Unknown"}
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <span className="uppercase tracking-wider text-[11px] text-muted-foreground font-medium bg-muted px-2 py-1 rounded-sm border border-border">
                          {m.role}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">{m.designation || "-"}</td>
                      <td className="px-5 py-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium uppercase tracking-wider ${m.status === "active" ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" : "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"}`}
                        >
                          {m.status}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
