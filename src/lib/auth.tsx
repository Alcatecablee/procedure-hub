/**
 * Procedure Hub - Auth Context
 *
 * Loading sequence (in order, never skipped):
 *   1. Resolve Supabase session
 *   2. Resolve organization membership
 *   3. Resolve role
 *   4. Set loading = false
 *   → Protected content may render
 *
 * This prevents the race condition where loading cleared before
 * role/membership were known, causing momentary privilege escalation
 * or incorrect redirects.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type {
  MemberRole,
  MemberStatus,
  Organization,
  OrganizationMember,
  Profile,
} from "@/integrations/supabase/types";

// ─── PUBLIC TYPES ─────────────────────────────────────────────
export type { MemberRole };

export interface OrgContext {
  organization: Organization;
  member: OrganizationMember;
  role: MemberRole;
  departmentId: string | null;
  department_id: string | null;
  designation: string | null;
  onboardedAt: string | null;
  requestedDepartmentId?: string | null;
  requestedDepartmentName?: string | null;
}

/**
 * Determines whether an active organization member still needs to complete
 * self-service member onboarding based on the authoritative organization_members state.
 *
 * Rules:
 * - Owners and Admins never require member onboarding.
 * - A member requires onboarding if they are missing a designation OR if they have no
 *   assigned department AND have not yet completed self-service onboarding (recorded in
 *   organization_members.onboarded_at).
 * - This ensures members with a designation but no department (or a department but no
 *   designation) are never silently skipped.
 */
export function computeNeedsMemberOnboarding(
  resolvedOrg:
    | (Pick<OrgContext, "role" | "departmentId" | "designation"> & {
        onboardedAt?: string | null;
        member?: Pick<OrganizationMember, "onboarded_at"> | null;
      })
    | null
): boolean {
  if (!resolvedOrg) return false;
  if (resolvedOrg.role === "owner" || resolvedOrg.role === "admin") {
    return false;
  }

  const hasDesignation = Boolean(resolvedOrg.designation && resolvedOrg.designation.trim().length > 0);
  const hasDepartment = Boolean(resolvedOrg.departmentId);
  const hasCompletedSelfServiceOnboarding = Boolean(
    resolvedOrg.onboardedAt ?? resolvedOrg.member?.onboarded_at
  );

  // If both designation and department are assigned, no onboarding is needed
  if (hasDesignation && hasDepartment) {
    return false;
  }

  // If the member already completed self-service onboarding (and has a designation),
  // their department request is pending administrator approval — do not re-prompt.
  if (hasDesignation && hasCompletedSelfServiceOnboarding) {
    return false;
  }

  return true;
}

interface AuthCtx {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  org: OrgContext | null;
  /** true while any of session/membership/role are still resolving */
  loading: boolean;
  /** true after initial session check - user is definitively unauthenticated */
  unauthenticated: boolean;
  /** user has a session but no active organization membership */
  needsOnboarding: boolean;
  /** user is in an organization but has not completed member onboarding */
  needsMemberOnboarding: boolean;
  signOut: () => Promise<void>;
  /** Re-resolve membership after org creation or role change */
  refreshMembership: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | undefined>(undefined);

// ─── HELPERS ─────────────────────────────────────────────────
async function resolveProfile(userId: string): Promise<Profile | null> {
  const { data } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  return data ?? null;
}

async function resolveMembership(userId: string): Promise<OrgContext | null> {
  // Get the user's active membership (first active org).
  const { data: member } = await supabase
    .from("organization_members")
    .select("*, organizations(*)")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!member) return null;

  const memberCast = member as unknown as OrganizationMember & { organizations: Organization };
  const org = memberCast.organizations;
  if (!org || org.status === "suspended") return null;

  const requestedDeptId = !memberCast.department_id
    ? (memberCast.requested_department_id ?? null)
    : null;

  let requestedDeptName: string | null = null;
  if (requestedDeptId) {
    const { data: reqDept } = await supabase
      .from("departments")
      .select("name")
      .eq("id", requestedDeptId)
      .eq("organization_id", org.id)
      .maybeSingle();
    requestedDeptName = reqDept?.name ?? null;
  }

  return {
    organization: org,
    member: {
      id: memberCast.id,
      organization_id: memberCast.organization_id,
      user_id: memberCast.user_id,
      role: memberCast.role,
      designation: memberCast.designation ?? null,
      department_id: memberCast.department_id ?? null,
      requested_department_id: memberCast.requested_department_id ?? null,
      onboarded_at: memberCast.onboarded_at ?? null,
      status: memberCast.status,
      invited_by: memberCast.invited_by,
      joined_at: memberCast.joined_at,
      created_at: memberCast.created_at,
      updated_at: memberCast.updated_at,
    },
    role: memberCast.role,
    departmentId: memberCast.department_id ?? null,
    department_id: memberCast.department_id ?? null,
    designation: memberCast.designation ?? null,
    onboardedAt: memberCast.onboarded_at ?? null,
    requestedDepartmentId: requestedDeptId,
    requestedDepartmentName: requestedDeptName,
  };
}

// ─── PROVIDER ────────────────────────────────────────────────
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [org, setOrg] = useState<OrgContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [unauthenticated, setUnauthenticated] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [needsMemberOnboarding, setNeedsMemberOnboarding] = useState(false);

  const currentUserRef = useRef<User | null>(null);
  currentUserRef.current = user;
  const initializedRef = useRef(false);

  /** Full resolution: profile + membership. Sets loading = false at the end. */
  const resolveAll = useCallback(async (s: Session | null, showLoading = true) => {
    if (showLoading) {
      setLoading(true);
    }
    if (!s?.user) {
      setUser(null);
      setSession(null);
      setProfile(null);
      setOrg(null);
      setNeedsOnboarding(false);
      setNeedsMemberOnboarding(false);
      setUnauthenticated(true);
      setLoading(false);
      return;
    }

    setUser(s.user);
    setSession(s);
    setUnauthenticated(false);

    // Resolve in parallel - both are needed before we unblock rendering.
    const [resolvedProfile, resolvedOrg] = await Promise.all([
      resolveProfile(s.user.id),
      resolveMembership(s.user.id),
    ]);

    setProfile(resolvedProfile);
    setOrg(resolvedOrg);
    setNeedsOnboarding(!resolvedOrg);
    setNeedsMemberOnboarding(computeNeedsMemberOnboarding(resolvedOrg));

    setLoading(false);
  }, []);

  const refreshMembership = useCallback(async () => {
    if (!user) return;
    const [resolved, resolvedProf] = await Promise.all([
      resolveMembership(user.id),
      resolveProfile(user.id),
    ]);
    setOrg(resolved);
    setProfile(resolvedProf);
    setNeedsOnboarding(!resolved);
    setNeedsMemberOnboarding(computeNeedsMemberOnboarding(resolved));
  }, [user]);

  useEffect(() => {
    // Initial session check.
    void supabase.auth.getSession().then(({ data: { session: s } }) => {
      initializedRef.current = true;
      void resolveAll(s, true);
    });

    // Subscribe to auth state changes.
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      // If it's a token refresh (e.g. triggered on window focus/tab switch),
      // update the session in memory without triggering a full-screen reload.
      if (event === "TOKEN_REFRESHED" && s) {
        setSession(s);
        return;
      }

      const isSameUser = !!(s?.user && currentUserRef.current && s.user.id === currentUserRef.current.id);
      void resolveAll(s, !initializedRef.current || !isSameUser);
    });

    return () => sub.subscription.unsubscribe();
  }, [resolveAll]);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <Ctx.Provider
      value={{
        user,
        session,
        profile,
        org,
        loading,
        unauthenticated,
        needsOnboarding,
        needsMemberOnboarding,
        signOut,
        refreshMembership,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used inside AuthProvider");
  return c;
}

// ─── CONVENIENCE SELECTORS ────────────────────────────────────
/** True if user has one of the given roles in their organization. */
export function useHasRole(...roles: MemberRole[]): boolean {
  const { org } = useAuth();
  if (!org) return false;
  return roles.includes(org.role);
}

/** Shorthand: true for owner or admin. */
export function useIsAdmin(): boolean {
  return useHasRole("owner", "admin");
}

/** Shorthand: true for owner, admin, or manager. */
export function useIsManager(): boolean {
  return useHasRole("owner", "admin", "manager");
}
