import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { createOrganization } from "@/lib/organization.server";
import { getMyPendingInvitations, acceptInvitation } from "@/lib/team.server";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { isPublicEmailDomain, getEmailDomain } from "@/lib/public-domains";
export function OrgOnboarding() {
  const { session, refreshMembership } = useAuth();
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [busy, setBusy] = useState(false);
  const queryClient = useQueryClient();

  // Fetch invitations
  const { data: invitations = [], isLoading: loadingInvites, isError: isInvitesError } = useQuery({
    queryKey: ["my_invitations"],
    queryFn: async () => {
      const {
        data: { session: s },
      } = await supabase.auth.getSession();
      return await getMyPendingInvitations({
        headers: s?.access_token ? { authorization: `Bearer ${s.access_token}` } : undefined,
      });
    },
    enabled: !!session,
  });

  const acceptMut = useMutation({
    mutationFn: async (id: string) => {
      const {
        data: { session: s },
      } = await supabase.auth.getSession();
      return await acceptInvitation({
        headers: s?.access_token ? { authorization: `Bearer ${s.access_token}` } : undefined,
        data: { id },
      });
    },
    onSuccess: async () => {
      toast.success("Invitation accepted!");
      await refreshMembership();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  // Check if the current user is on a public domain
  const userEmail = session?.user?.email ?? "";
  const isPublic = isPublicEmailDomain(userEmail);
  const emailDomain = isPublic ? "" : getEmailDomain(userEmail);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      // Get a fresh token for the server function.
      const {
        data: { session: s },
      } = await supabase.auth.getSession();
      if (!s?.access_token) throw new Error("Not authenticated");

      await createOrganization({
        data: {
          name: name.trim(),
          domain: domain.trim() || emailDomain || undefined,
        },
        headers: { authorization: `Bearer ${s.access_token}` },
      });

      toast.success("Workspace created.");
      // Re-resolve membership so the app shell renders.
      await refreshMembership();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background paper-grain flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="eyebrow mb-3">Welcome to Procedure Hub</div>

        {isInvitesError ? (
          <div className="mb-10 bg-card border border-destructive/20 p-5 rounded-sm">
            <h2 className="font-display text-2xl mb-2 text-destructive">Error</h2>
            <p className="text-sm text-muted-foreground">Failed to load invitations.</p>
          </div>
        ) : loadingInvites ? (
          <div className="mb-10 bg-card border border-border p-5 rounded-sm">
            <h2 className="font-display text-2xl mb-2">Loading...</h2>
            <p className="text-sm text-muted-foreground">Checking for pending invitations.</p>
          </div>
        ) : invitations.length > 0 ? (
          <div className="mb-10 bg-card border border-border p-5 rounded-sm">
            <h2 className="font-display text-2xl mb-2">Pending Invitations</h2>
            <p className="text-sm text-muted-foreground mb-4">
              You have been invited to join the following workspaces.
            </p>
            <ul className="space-y-3">
              {invitations.map((inv) => (
                <li
                  key={inv.id}
                  className="flex items-center justify-between p-3 bg-muted/30 border border-border rounded-sm"
                >
                  <div>
                    <div className="font-medium">{inv.organizations?.name || "Unknown"}</div>
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground mt-0.5">
                      Role: {inv.role}
                    </div>
                  </div>
                  <button
                    onClick={() => acceptMut.mutate(inv.id)}
                    disabled={acceptMut.isPending || busy}
                    className="bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium hover:bg-primary/90 disabled:opacity-50"
                  >
                    Accept
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-6 border-t border-border pt-4">
              <p className="text-sm text-muted-foreground">Or create your own workspace below.</p>
            </div>
          </div>
        ) : null}

        <h1 className="font-display text-4xl mb-2">Create your workspace</h1>
        <p className="text-sm text-muted-foreground mb-8">
          Your workspace is your organization's operational record. Set up your name and we'll get
          started.
        </p>

        {isPublic ? (
          <div className="bg-destructive/10 border border-destructive/20 rounded-sm p-4 text-sm text-destructive-foreground">
            <h3 className="font-medium mb-1">Company email required</h3>
            <p className="opacity-90 leading-relaxed mb-4">
              Workspaces cannot be created using public email addresses (like{" "}
              <strong>@{getEmailDomain(userEmail)}</strong>). Please sign out and create an account
              using your work email address.
            </p>
            <button
              onClick={async () => {
                await supabase.auth.signOut();
                window.location.href = "/login";
              }}
              className="text-xs font-medium underline underline-offset-4 hover:opacity-80"
            >
              Sign out
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-5">
            <div>
              <label className="eyebrow block mb-1.5">Organization name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Lesaka Technologies"
                required
                minLength={2}
                maxLength={200}
                disabled={busy || acceptMut.isPending}
                className="w-full bg-card border border-input px-3 py-2 text-sm rounded-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
              />
            </div>

            <div>
              <label className="eyebrow block mb-1.5">
                Email domain{" "}
                <span className="text-muted-foreground font-normal normal-case tracking-normal">
                  (optional - allows team members to auto-join)
                </span>
              </label>
              <input
                type="text"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder={emailDomain || "company.com"}
                disabled={busy || acceptMut.isPending}
                className="w-full bg-card border border-input px-3 py-2 text-sm rounded-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Staff who sign up with @{domain || emailDomain || "yourdomain.com"} will
                automatically join your workspace as staff members.
              </p>
            </div>

            <button
              type="submit"
              disabled={busy || !name.trim() || acceptMut.isPending}
              className="w-full bg-primary text-primary-foreground px-4 py-2.5 text-sm font-medium rounded-sm hover:bg-primary/90 disabled:opacity-60 transition-colors"
            >
              {busy ? "Creating workspace..." : "Create workspace"}
            </button>
          </form>
        )}

        <div className="mt-8 rule pt-4 font-mono text-[10.5px] uppercase tracking-[0.12em] text-muted-foreground">
          You become the owner of this workspace.
        </div>
      </div>
    </div>
  );
}
