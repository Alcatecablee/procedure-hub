import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/page-header";
import { useAuth, useIsAdmin } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  getTeamMembers,
  getPendingInvitations,
  createInvitation,
  resendInvitation,
  cancelInvitation,
  updateMemberRole,
  removeMember,
} from "@/lib/team.server";

export const Route = createFileRoute("/app/department")({ component: Department });

function Department() {
  const { membership } = useAuth();
  const navigate = useNavigate();
    const isManager = useIsManager();
  const isAdmin = useIsAdmin();
  useEffect(() => {
    if (!isManager || isAdmin) void navigate({ to: "/app" });
  }, [isManager, isAdmin, navigate]);
  useEffect(() => {
    if (!isAdmin) void navigate({ to: "/app" });
  }, [isAdmin, navigate]);
  const queryClient = useQueryClient();

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "manager" | "staff" | "viewer">("staff");
  const [inviteDesignation, setInviteDesignation] = useState("");
  const [inviteDepartment, setInviteDepartment] = useState("");
  const [isInviting, setIsInviting] = useState(false);

  const [editingMember, setEditingMember] = useState<any>(null);
  const [editRole, setEditRole] = useState<string>("");
  const [editDesignation, setEditDesignation] = useState<string>("");
  const [editDepartment, setEditDepartment] = useState<string>("");

  const getHeaders = async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.access_token ? { authorization: "Bearer " + session.access_token } : undefined;
  };

  const { data: members = [], isLoading: loadingMembers, isError: isMembersError, error: membersError } = useQuery({
    queryKey: ["team", "members"],
    queryFn: async () => {
      const headers = await getHeaders();
      return await getTeamMembers({ headers });
    },
    enabled: isAdmin,
  });

  const { data: invitations = [], isLoading: loadingInvitations, isError: isInvitationsError, error: invitationsError } = useQuery({
    queryKey: ["team", "invitations"],
    queryFn: async () => {
      const headers = await getHeaders();
      return await getPendingInvitations({ headers });
    },
    enabled: isAdmin,
  });

  const inviteMut = useMutation({
    mutationFn: async () => {
      const headers = await getHeaders();
      return await createInvitation({
        headers,
        data: {
          email: inviteEmail,
          role: inviteRole,
          designation: inviteDesignation || undefined,
          department: inviteDepartment || undefined,
        },
      });
    },
    onSuccess: () => {
      setInviteEmail("");
      setInviteRole("staff");
      setInviteDesignation("");
      setInviteDepartment("");
      queryClient.invalidateQueries({ queryKey: ["team", "invitations"] });
      queryClient.invalidateQueries({ queryKey: ["team", "members"] });
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
      queryClient.invalidateQueries({ queryKey: ["team", "invitations"] });
      toast.success("Invitation cancelled");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team", "members"] });
      toast.success("Member updated");
      setEditingMember(null);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const removeMut = useMutation({
    mutationFn: async (id: string) => {
      const headers = await getHeaders();
      return await removeMember({ headers, data: { id } });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team", "members"] });
      toast.success("Member removed");
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (!isAdmin) return null;

  const isOwner = membership?.role === "owner";

  return (
    <div>
      <PageHeader
        eyebrow="Folio 05"
        title="Team Management"
        subtitle="Manage the members of your organization and pending invitations."
      />
      <div className="px-6 md:px-10 py-6 max-w-6xl space-y-12">
        {/* Invite Form */}
        <section>
          <div className="eyebrow mb-6">Invite Member</div>
          <form
            onSubmit={handleInvite}
            className="bg-card border border-border p-5 grid grid-cols-1 md:grid-cols-12 gap-4 items-end"
          >
            <div className="md:col-span-3">
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

            <div className="md:col-span-3">
              <label className="eyebrow block mb-1.5 text-muted-foreground">Designation</label>
              <input
                type="text"
                value={inviteDesignation}
                onChange={(e) => setInviteDesignation(e.target.value)}
                placeholder="e.g. Operations Manager"
                disabled={isInviting}
                className="w-full bg-background border border-input px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            <div className="md:col-span-3">
              <label className="eyebrow block mb-1.5 text-muted-foreground">Department</label>
              <input
                type="text"
                value={inviteDepartment}
                onChange={(e) => setInviteDepartment(e.target.value)}
                placeholder="e.g. Customer Ops"
                disabled={isInviting}
                className="w-full bg-background border border-input px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            <div className="md:col-span-2">
              <label className="eyebrow block mb-1.5 text-muted-foreground">Role</label>
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as any)}
                disabled={isInviting}
                className="w-full bg-background border border-input px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {isOwner && <option value="admin">Admin</option>}
                <option value="manager">Manager</option>
                <option value="staff">Staff</option>
                <option value="viewer">Viewer</option>
              </select>
            </div>
            <div className="md:col-span-1">
              <button
                type="submit"
                disabled={isInviting || !inviteEmail}
                className="bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50 w-full"
              >
                {isInviting ? "..." : "Invite"}
              </button>
            </div>
          </form>
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
                    <th className="px-5 py-3 font-medium">Role</th>
                    <th className="px-5 py-3 font-medium">Designation</th>
                    <th className="px-5 py-3 font-medium">Invited At</th>
                    <th className="px-5 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {isInvitationsError ? (
                    <tr>
                      <td colSpan={5} className="px-5 py-6 text-center text-destructive">
                        Failed to load pending invitations.
                      </td>
                    </tr>
                  ) : loadingInvitations ? (
                    <tr>
                      <td colSpan={5} className="px-5 py-6 text-center text-muted-foreground">
                        Loading invitations...
                      </td>
                    </tr>
                  ) : (
                    invitations.map((inv) => (
                      <tr key={inv.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-5 py-3 font-medium">{inv.profiles?.email || "Unknown"}</td>
                        <td className="px-5 py-3 uppercase tracking-wider text-[11px] text-muted-foreground">
                          {inv.role}
                        </td>
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

        {/* Active Members */}
        <section>
          <div className="eyebrow mb-6">Organization Members</div>
          <div className="border border-border bg-card overflow-hidden">
            <table className="w-full text-sm text-left">
              <thead className="bg-muted text-muted-foreground text-xs uppercase tracking-wider font-mono border-b border-border">
                <tr>
                  <th className="px-5 py-3 font-medium">Name</th>
                  <th className="px-5 py-3 font-medium">Role</th>
                  <th className="px-5 py-3 font-medium">Designation</th>
                  <th className="px-5 py-3 font-medium">Department</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                  {isMembersError ? (
                    <tr>
                      <td colSpan={6} className="px-5 py-8 text-center text-destructive">
                        Failed to load members: {(membersError as Error)?.message || "Unknown error"}
                      </td>
                    </tr>
                  ) : loadingMembers ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-muted-foreground">
                      Loading members...
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
                      <td className="px-5 py-3 text-muted-foreground">{m.department || "-"}</td>
                      <td className="px-5 py-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium uppercase tracking-wider ${m.status === "active" ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" : "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"}`}
                        >
                          {m.status}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right space-x-3">
                        <button
                          onClick={() => {
                            setEditingMember(m);
                            setEditRole(m.role);
                            setEditDesignation(m.designation || "");
                            setEditDepartment(m.department || "");
                          }}
                          className="text-primary hover:underline text-xs"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => {
                            if (window.confirm("Remove this member?")) removeMut.mutate(m.id);
                          }}
                          className="text-destructive hover:underline text-xs"
                          disabled={removeMut.isPending}
                        >
                          Remove
                        </button>
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
