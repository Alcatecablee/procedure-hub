/**
 * Server functions for organization management.
 * These run on Cloudflare Workers and use the Supabase service key
 * so they can bypass RLS to create organizations and seed categories.
 *
 * SECURITY: All inputs are validated. organization_id is NEVER taken
 * from client input - it is derived from authenticated identity only.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import type { Database, MemberRole } from "@/integrations/supabase/types";
import { z } from "zod";

// ─── DEFAULT CATEGORIES ────────────────────────────────────────
// Seeded into every new organization.
const DEFAULT_CATEGORIES = [
  { name: "Call Handling", slug: "call-handling", sort_order: 1 },
  { name: "Case Management", slug: "case-management", sort_order: 2 },
  { name: "Customer Communication", slug: "customer-communication", sort_order: 3 },
  { name: "Escalations", slug: "escalations", sort_order: 4 },
  { name: "Product & Platform", slug: "product-platform", sort_order: 5 },
  { name: "Compliance", slug: "compliance", sort_order: 6 },
  { name: "Attendance & Admin", slug: "attendance-admin", sort_order: 7 },
  { name: "Technical Procedures", slug: "technical-procedures", sort_order: 8 },
  { name: "Security", slug: "security", sort_order: 9 },
  { name: "General Operations", slug: "general-operations", sort_order: 10 },
  { name: "System Procedures", slug: "system-procedures", sort_order: 11 },
  { name: "Reference Material", slug: "reference-material", sort_order: 12 },
] as const;

const DEFAULT_DEPARTMENTS = [
  "Operations",
  "Engineering",
  "Customer Support",
  "Compliance",
] as const;

// ─── SERVICE CLIENT (bypasses RLS for server-side ops) ────────
function getServiceClient() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  }
  return createClient<any>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ─── USER CLIENT (respects RLS, uses caller's JWT) ────────────
function getUserClient(token: string) {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anonKey) throw new Error("Supabase env not configured");
  return createClient<any>(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

import { PUBLIC_EMAIL_DOMAINS, getEmailDomain, isPublicEmailDomain } from "@/lib/public-domains";

const CreateOrgInput = z.object({
  name: z.string().min(2).max(200),
  domain: z
    .string()
    .optional()
    .refine((d) => !d || !PUBLIC_EMAIL_DOMAINS.has(d.toLowerCase()), {
      message: "Public email domains cannot be used for organization auto-join.",
    }),
});

export const createOrganization = createServerFn({ method: "POST" })
  .inputValidator(CreateOrgInput)
  .handler(async (ctx) => {
  const data = CreateOrgInput.parse(ctx.data);
  const headers = getRequestHeaders();
  const token = headers.get("authorization")?.replace("Bearer ", "");
  if (!token) throw new Error("Unauthorized");

  // Verify the caller is authenticated.
  const userClient = getUserClient(token);
  const {
    data: { user },
    error: authError,
  } = await userClient.auth.getUser();
  if (authError || !user) throw new Error("Unauthorized");
  if (!user.email) throw new Error("Email required");

  // Block creation for public domain accounts
  if (isPublicEmailDomain(user.email)) {
    throw new Error(
      "Workspaces cannot be created with public email addresses (e.g. gmail.com). Please use a company email.",
    );
  }

  // Check caller doesn't already have an organization.
  const { data: existingMember } = await userClient
    .from("organization_members")
    .select("id")
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  if (existingMember) {
    throw new Error("You are already a member of an organization.");
  }

  const svc = getServiceClient();
  const slug = slugify(data.name);

  // Check slug uniqueness.
  const { data: existing } = await svc
    .from("organizations")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  const finalSlug = existing ? `${slug}-${Date.now()}` : slug;

  // Create organization.
  const { data: org, error: orgError } = await svc
    .from("organizations")
    .insert({
      name: data.name,
      slug: finalSlug,
      domain: data.domain ?? null,
      status: "active",
      created_by: user.id,
    })
    .select()
    .single();

  if (orgError || !org) throw new Error(orgError?.message ?? "Failed to create organization");

  // Make caller the owner.
  const nowIso = new Date().toISOString();
  const { error: memberError } = await svc.from("organization_members").insert({
    organization_id: org.id,
    user_id: user.id,
    role: "owner" as MemberRole,
    status: "active",
    joined_at: nowIso,
    onboarded_at: nowIso,
  });
  if (memberError) throw new Error(memberError.message);

  // Seed default categories.
  const categoryRows = DEFAULT_CATEGORIES.map((c) => ({
    organization_id: org.id,
    name: c.name,
    slug: c.slug,
    sort_order: c.sort_order,
  }));
  await svc.from("categories").insert(categoryRows);

  // Seed default departments.
  const departmentRows = DEFAULT_DEPARTMENTS.map((name) => ({
    organization_id: org.id,
    name,
  }));
  await svc.from("departments").insert(departmentRows);

  // Audit log.
  await svc.from("audit_logs").insert({
    organization_id: org.id,
    actor_id: user.id,
    event_type: "org_created",
    entity_type: "organization",
    entity_id: org.id,
    metadata: { name: org.name, slug: org.slug } as any,
  });

  return { organizationId: org.id, slug: org.slug };
});

// ─── GET MY MEMBERSHIP ────────────────────────────────────────
export const getMyMembership = createServerFn({ method: "GET" }).handler(async () => {
  const headers = getRequestHeaders();
  const token = headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return null;

  const userClient = getUserClient(token);
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) return null;

  const { data } = await userClient
    .from("organization_members")
    .select("*, organizations(*)")
    .eq("user_id", user.id)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  return data ?? null;
});

export const CompleteMemberOnboardingInput = z.object({
  fullName: z.string().trim().min(2, "Full name must be at least 2 characters").max(100).optional(),
  designation: z.string().trim().min(2, "Job title / designation is required").max(100),
  requestedDepartmentId: z.string().uuid().nullable().optional(),
  // Accepted for backwards-compatible payload shape, but always treated as a department request (never direct assignment)
  departmentId: z.string().uuid().nullable().optional(),
  isGlobal: z.boolean().optional(),
});

export interface CompleteMemberOnboardingOptions {
  /** Fault-injection hook for integration tests to verify PostgreSQL transaction rollback on audit failure */
  _forceAuditEventTypeForTest?: string;
}

export async function completeMemberOnboardingCore(
  dataRaw: unknown,
  token: string,
  options?: CompleteMemberOnboardingOptions
) {
  const data = CompleteMemberOnboardingInput.parse(dataRaw);
  if (!token) throw new Error("Unauthorized");

  const userClient = getUserClient(token);

  let effectiveFullName = data.fullName?.trim() || "";
  if (!effectiveFullName) {
    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (user) {
      const { data: profile } = await userClient
        .from("profiles")
        .select("full_name")
        .eq("id", user.id)
        .maybeSingle();
      effectiveFullName = profile?.full_name?.trim() || "";
    }
  }

  const targetRequestedDeptId =
    data.requestedDepartmentId !== undefined
      ? data.requestedDepartmentId
      : data.departmentId !== undefined
        ? data.departmentId
        : null;

  const rpcPayload: {
    _full_name: string;
    _designation: string;
    _requested_department_id: string | null;
    _is_global: boolean;
    _audit_event_override?: string | null;
  } = {
    _full_name: effectiveFullName,
    _designation: data.designation,
    _requested_department_id: targetRequestedDeptId,
    _is_global: Boolean(data.isGlobal),
  };

  if (options?._forceAuditEventTypeForTest !== undefined) {
    rpcPayload._audit_event_override = options._forceAuditEventTypeForTest;
  }

  // Execute the entire onboarding flow inside a single PostgreSQL transaction
  // using the authenticated user's JWT so auth.uid() identifies the caller.
  const { data: rpcResult, error: rpcError } = await userClient.rpc(
    "atomic_complete_member_onboarding",
    rpcPayload
  );

  if (rpcError) {
    throw new Error(rpcError.message);
  }

  const res = (rpcResult || {}) as Record<string, any>;
  const departmentId = res.departmentId ?? null;
  const requestedDepartmentId = res.requestedDepartmentId ?? null;

  return {
    success: true,
    memberId: res.memberId ?? null,
    departmentId,
    requestedDepartmentId,
    requestedDepartmentName: res.requestedDepartmentName ?? null,
    requiresAdminDepartmentApproval: Boolean(
      res.requiresAdminDepartmentApproval ?? (!departmentId && requestedDepartmentId)
    ),
  };
}

export const completeMemberOnboarding = createServerFn({ method: "POST" })
  .validator(CompleteMemberOnboardingInput)
  .handler(async (ctx) => {
    const headers = getRequestHeaders();
    const token = headers.get("authorization")?.replace("Bearer ", "") || "";
    return completeMemberOnboardingCore(ctx.data, token);
  });



