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
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
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

  return {
    organization: org,
    member: {
      id: memberCast.id,
      organization_id: memberCast.organization_id,
      user_id: memberCast.user_id,
      role: memberCast.role,
      designation: memberCast.designation ?? null,
      department_id: memberCast.department_id ?? null,
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

  /** Full resolution: profile + membership. Sets loading = false at the end. */
  const resolveAll = useCallback(async (s: Session | null) => {
    setLoading(true);
    if (!s?.user) {
      setUser(null);
      setSession(null);
      setProfile(null);
      setOrg(null);
      setNeedsOnboarding(false);
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
    setLoading(false);
  }, []);

  const refreshMembership = useCallback(async () => {
    if (!user) return;
    const resolved = await resolveMembership(user.id);
    setOrg(resolved);
    setNeedsOnboarding(!resolved);
  }, [user]);

  useEffect(() => {
    // Initial session check.
    void supabase.auth.getSession().then(({ data: { session: s } }) => {
      void resolveAll(s);
    });

    // Subscribe to auth state changes.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      void resolveAll(s);
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
