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
  const { error: memberError } = await svc.from("organization_members").insert({
    organization_id: org.id,
    user_id: user.id,
    role: "owner" as MemberRole,
    status: "active",
    joined_at: new Date().toISOString(),
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
  /** Fault-injection hook for integration tests to verify audit failure rollback */
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
  const {
    data: { user },
    error: userErr,
  } = await userClient.auth.getUser();
  if (userErr || !user) throw new Error("Unauthorized");

  const svc = getServiceClient();

  // 1. Fetch active membership and current profile snapshot before any writes
  const [{ data: member, error: memberLookupErr }, { data: currentProfile }] = await Promise.all([
    svc
      .from("organization_members")
      .select("id, organization_id, user_id, role, department_id, designation, invited_by")
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle(),
    svc.from("profiles").select("id, full_name").eq("id", user.id).maybeSingle(),
  ]);

  if (memberLookupErr || !member) {
    throw new Error("No active organization membership found");
  }

  if (member.role === "owner" || member.role === "admin") {
    throw new Error("Forbidden: Owners and administrators do not use self-service member onboarding");
  }

  // 2. Prevent repeat onboarding or post-onboarding department/designation tampering
  const existingOnboardedOrgs =
    (user.app_metadata?.onboarded_orgs as Record<string, any> | undefined) || {};
  const hasAppMetaOnboarded = Boolean(existingOnboardedOrgs[member.organization_id]);

  const { data: existingOnboardingAudits } = await svc
    .from("audit_logs")
    .select("id, metadata")
    .eq("organization_id", member.organization_id)
    .eq("entity_type", "organization_members")
    .eq("entity_id", member.id)
    .eq("event_type", "member_joined");

  const hasAuditOnboarded = (existingOnboardingAudits || []).some(
    (row) => (row.metadata as Record<string, any> | null)?.action === "onboarding_completed"
  );

  const isAlreadyFullyConfigured = Boolean(member.department_id && member.designation);

  if (hasAppMetaOnboarded || hasAuditOnboarded || isAlreadyFullyConfigured) {
    throw new Error(
      "Forbidden: Member onboarding has already been completed. Contact an administrator to change your department or role."
    );
  }

  // 3. Validate department request BEFORE performing any writes
  const targetRequestedDeptId =
    data.requestedDepartmentId !== undefined
      ? data.requestedDepartmentId
      : data.departmentId !== undefined
        ? data.departmentId
        : null;

  let requestedDeptName: string | null = null;
  if (targetRequestedDeptId) {
    const { data: dept } = await svc
      .from("departments")
      .select("id, name")
      .eq("id", targetRequestedDeptId)
      .eq("organization_id", member.organization_id)
      .maybeSingle();

    if (!dept) {
      throw new Error("Forbidden: Selected department does not exist in your organization");
    }
    requestedDeptName = dept.name;
  } else if (!member.department_id && !data.isGlobal) {
    throw new Error("Validation failed: Department selection is required");
  }

  const previousFullName = currentProfile?.full_name ?? null;
  const previousDesignation = member.designation ?? null;
  let profileUpdated = false;
  let memberUpdated = false;

  try {
    // 4. Update profile full_name if provided
    if (data.fullName) {
      const { error: profErr } = await svc
        .from("profiles")
        .update({ full_name: data.fullName })
        .eq("id", user.id);
      if (profErr) {
        throw new Error(`Failed to update profile: ${profErr.message}`);
      }
      profileUpdated = true;
    }

    // 5. Update organization_members designation ONLY.
    // SECURITY INVARIANT: Never allow self-service onboarding to write organization_members.department_id.
    // Trusted department assignment is strictly administrator-controlled via updateMemberRoleCore.
    const { error: updateErr } = await svc
      .from("organization_members")
      .update({
        designation: data.designation,
        updated_at: new Date().toISOString(),
      })
      .eq("id", member.id)
      .eq("organization_id", member.organization_id);

    if (updateErr) {
      throw new Error(`Failed to update membership: ${updateErr.message}`);
    }
    memberUpdated = true;

    // 6. Write immutable audit log using valid audit_action enum ('member_joined')
    const eventType = (options?._forceAuditEventTypeForTest || "member_joined") as any;
    const { data: insertedAudit, error: auditErr } = await svc
      .from("audit_logs")
      .insert({
        organization_id: member.organization_id,
        actor_id: user.id,
        event_type: eventType,
        entity_type: "organization_members",
        entity_id: member.id,
        metadata: {
          action: "onboarding_completed",
          designation: data.designation,
          existing_department_id: member.department_id,
          requested_department_id: member.department_id ? null : targetRequestedDeptId,
          requested_department_name: member.department_id ? null : requestedDeptName,
          is_global_request: Boolean(data.isGlobal),
        } as any,
      })
      .select("id")
      .single();

    if (auditErr || !insertedAudit) {
      throw new Error(
        `Audit log insertion failed (${auditErr?.message || "unknown error"})`
      );
    }

    // 7. Persist onboarding completion state in server-controlled app_metadata
    const { error: metaErr } = await svc.auth.admin.updateUserById(user.id, {
      app_metadata: {
        ...user.app_metadata,
        onboarded_orgs: {
          ...existingOnboardedOrgs,
          [member.organization_id]: {
            onboarded_at: new Date().toISOString(),
            designation: data.designation,
            requested_department_id: member.department_id ? null : targetRequestedDeptId,
            requested_department_name: member.department_id ? null : requestedDeptName,
            is_global: Boolean(data.isGlobal),
          },
        },
      },
    });

    if (metaErr) {
      await svc.from("audit_logs").delete().eq("id", insertedAudit.id);
      throw new Error(`Failed to persist onboarding metadata: ${metaErr.message}`);
    }

    return {
      success: true,
      departmentId: member.department_id,
      requestedDepartmentId: member.department_id ? null : targetRequestedDeptId,
      requestedDepartmentName: member.department_id ? null : requestedDeptName,
      requiresAdminDepartmentApproval: !member.department_id && Boolean(targetRequestedDeptId),
    };
  } catch (err) {
    // Compensating rollback so partial writes never persist on failure
    if (memberUpdated) {
      await svc
        .from("organization_members")
        .update({
          designation: previousDesignation,
          updated_at: new Date().toISOString(),
        })
        .eq("id", member.id)
        .eq("organization_id", member.organization_id);
    }
    if (profileUpdated) {
      await svc
        .from("profiles")
        .update({ full_name: previousFullName })
        .eq("id", user.id);
    }
    throw err;
  }
}

export const completeMemberOnboarding = createServerFn({ method: "POST" })
  .validator(CompleteMemberOnboardingInput)
  .handler(async (ctx) => {
    const headers = getRequestHeaders();
    const token = headers.get("authorization")?.replace("Bearer ", "") || "";
    return completeMemberOnboardingCore(ctx.data, token);
  });


