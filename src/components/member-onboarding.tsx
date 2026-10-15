import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { completeMemberOnboarding } from "@/lib/organization.server";
import { getDepartments } from "@/lib/procedures.server";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";

export function MemberOnboarding() {
  const { user, profile, org, refreshMembership, signOut } = useAuth();
  const [fullName, setFullName] = useState(
    profile?.full_name || user?.user_metadata?.full_name || user?.email?.split("@")[0] || ""
  );
  const [designation, setDesignation] = useState(org?.designation || "");
  const [departmentId, setDepartmentId] = useState(org?.departmentId || "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (profile?.full_name && !fullName) {
      setFullName(profile.full_name);
    }
  }, [profile?.full_name, fullName]);

  useEffect(() => {
    if (org?.designation && !designation) {
      setDesignation(org.designation);
    }
    if (org?.departmentId && !departmentId) {
      setDepartmentId(org.departmentId);
    }
  }, [org?.designation, org?.departmentId, designation, departmentId]);

  const { data: departments = [], isLoading: loadingDepts } = useQuery({
    queryKey: ["departments"],
    queryFn: async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      return (await getDepartments({
        headers: session?.access_token ? { authorization: "Bearer " + session.access_token } : undefined,
      })) as Array<{ id: string; name: string }>;
    },
  });

  const hasAdminAssignedDept = Boolean(org?.departmentId);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (fullName.trim().length < 2) {
      toast.error("Please enter your full name (at least 2 characters).");
      return;
    }
    if (designation.trim().length < 2) {
      toast.error("Please enter your job title / designation.");
      return;
    }
    if (!hasAdminAssignedDept && !departmentId) {
      toast.error("Please select your primary department or Global / General scope.");
      return;
    }

    setBusy(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Not authenticated");

      const isGlobal = departmentId === "__GLOBAL__";
      const chosenDept = isGlobal || !departmentId ? null : departmentId;

      const res = await completeMemberOnboarding({
        data: {
          fullName: fullName.trim(),
          designation: designation.trim(),
          requestedDepartmentId: hasAdminAssignedDept ? null : chosenDept,
          isGlobal,
        },
        headers: { authorization: `Bearer ${session.access_token}` },
      });

      if (res?.requiresAdminDepartmentApproval) {
        toast.success(
          `Profile saved! Your request to join ${res.requestedDepartmentName || "the selected department"} has been submitted for administrator approval.`
        );
      } else {
        toast.success("Profile updated! Welcome aboard.");
      }

      await supabase.auth.refreshSession();
      await refreshMembership();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const orgName = org?.organization?.name || "your organization";

  return (
    <div className="min-h-screen bg-background paper-grain flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="eyebrow mb-3">Welcome to {orgName}</div>

        <h1 className="font-display text-4xl mb-2">Complete your profile</h1>
        <p className="text-sm text-muted-foreground mb-8">
          Confirm your full name, job title, and department scope so we can configure your procedure ledger and
          compliance responsibilities.
        </p>

        <form onSubmit={submit} className="space-y-5 bg-card border border-border p-6 rounded-sm shadow-sm">
          <div>
            <label className="eyebrow block mb-1.5">Your Full Name</label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g. Zinhle Mokoena"
              required
              minLength={2}
              disabled={busy}
              className="w-full bg-background border border-input px-3 py-2 text-sm rounded-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
            />
          </div>

          <div>
            <label className="eyebrow block mb-1.5">Job Title / Designation</label>
            <input
              type="text"
              value={designation}
              onChange={(e) => setDesignation(e.target.value)}
              placeholder="e.g. Call Center Consultant, Frontline Agent"
              required
              minLength={2}
              disabled={busy}
              className="w-full bg-background border border-input px-3 py-2 text-sm rounded-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Helps colleagues and managers identify your operational duties.
            </p>
          </div>

          <div>
            <label className="eyebrow block mb-1.5">
              {hasAdminAssignedDept ? "Assigned Department" : "Requested Department"}
            </label>
            <select
              value={hasAdminAssignedDept ? (org?.departmentId || "") : departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              required={!hasAdminAssignedDept}
              disabled={busy || loadingDepts || hasAdminAssignedDept}
              className="w-full bg-background border border-input px-3 py-2 text-sm rounded-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
            >
              <option value="">Select your department...</option>
              {departments.map((dept) => (
                <option key={dept.id} value={dept.id}>
                  {dept.name}
                </option>
              ))}
              {!hasAdminAssignedDept && (
                <option value="__GLOBAL__">Global / General (Company-wide only)</option>
              )}
            </select>
            <p className="mt-1 text-xs text-muted-foreground">
              {hasAdminAssignedDept
                ? "Your department was pre-assigned by an administrator."
                : "Global company-wide procedures are available immediately. Department-scoped procedures unlock once an administrator approves your department assignment."}
            </p>
          </div>

          <button
            type="submit"
            disabled={busy || designation.trim().length < 2 || (!hasAdminAssignedDept && !departmentId)}
            className="w-full bg-primary text-primary-foreground px-4 py-2.5 text-sm font-medium rounded-sm hover:bg-primary/90 disabled:opacity-60 transition-colors mt-2"
          >
            {busy ? "Saving setup..." : "Complete Setup & View Procedures"}
          </button>
        </form>

        <div className="mt-6 flex items-center justify-between text-xs text-muted-foreground">
          <span>Signed in as {user?.email}</span>
          <button
            type="button"
            onClick={() => signOut()}
            className="underline underline-offset-4 hover:text-foreground"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

