import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import type { Database, MemberRole, MemberStatus } from "@/integrations/supabase/types";
import { z } from "zod";

function getServiceClient() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  }
  return createClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function getUserClient(token: string) {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anonKey) throw new Error("Supabase env not configured");
  return createClient<Database>(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function getCallerContext(token: string) {
  const userClient = getUserClient(token);
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const { data: membership } = await userClient
    .from("organization_members")
    .select("organization_id, role, status")
    .eq("user_id", user.id)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (!membership) throw new Error("No active organization membership");

  return { user, orgId: membership.organization_id, role: membership.role as MemberRole };
}

function enforceAdmin(role: MemberRole) {
  if (role !== "owner" && role !== "admin") {
    throw new Error("Forbidden: requires owner or admin role");
  }
}

// ─── READ OPERATIONS ──────────────────────────────────────────

export const getTeamMembers = createServerFn({ method: "GET" }).handler(async () => {
  console.log("==> getTeamMembers called");
  const token = getRequestHeaders().get("authorization")?.replace("Bearer ", "");
  if (!token) {
    console.error("==> getTeamMembers: No token (SSR fallback)");
    return [];
  }
  const ctx = await getCallerContext(token);
  console.log("==> getTeamMembers ctx:", ctx);
  enforceAdmin(ctx.role);

  const svc = getServiceClient();
  const { data: members, error } = await svc
    .from("organization_members")
    .select(
      `
      id,
      user_id,
      role,
      designation,
      department,
      status,
      joined_at
    `,
    )
    .eq("organization_id", ctx.orgId)
    .in("status", ["active", "suspended"]);

  if (error) {
    console.error("==> getTeamMembers DB error:", error);
    throw new Error(error.message);
  }
  if (!members || members.length === 0) return [];

  const userIds = members.map((m) => m.user_id);
  const { data: profiles } = await svc
    .from("profiles")
    .select("id, email, full_name")
    .in("id", userIds);

  const profilesMap = new Map(profiles?.map((p) => [p.id, p]) || []);

  return members.map((m) => ({
    ...m,
    profiles: profilesMap.get(m.user_id) || null,
  }));
});

export const getPendingInvitations = createServerFn({ method: "GET" }).handler(async () => {
  const token = getRequestHeaders().get("authorization")?.replace("Bearer ", "");
  if (!token) return [];
  const ctx = await getCallerContext(token);
  enforceAdmin(ctx.role);

  const svc = getServiceClient();
  const { data: members, error } = await svc
    .from("organization_members")
    .select(
      `
      id,
      user_id,
      role,
      designation,
      department,
      status,
      created_at,
      invited_by
    `,
    )
    .eq("organization_id", ctx.orgId)
    .eq("status", "invited");

  if (error) throw new Error(error.message);
  if (!members || members.length === 0) return [];

  const userIds = members.map((m) => m.user_id);
  const { data: profiles } = await svc
    .from("profiles")
    .select("id, email, full_name")
    .in("id", userIds);

  const profilesMap = new Map(profiles?.map((p) => [p.id, p]) || []);

  return members.map((m) => ({
    ...m,
    profiles: profilesMap.get(m.user_id) || null,
  }));
});

// ─── MUTATIONS ───────────────────────────────────────────────

const InviteInput = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "manager", "staff", "viewer"]), // Owner cannot be invited directly
  designation: z.string().optional(),
  department: z.string().optional(),
});

export const createInvitation = createServerFn({ method: "POST" }).handler(async (req) => {
  const data = InviteInput.parse(req.data as any);
  const token = getRequestHeaders().get("authorization")?.replace("Bearer ", "");
  if (!token) throw new Error("Unauthorized");
  const ctx = await getCallerContext(token);
  enforceAdmin(ctx.role);

  // Enforce governance: Only owners can create admins
  if (data.role === "admin" && ctx.role !== "owner") {
    throw new Error("Only owners can assign the admin role.");
  }

  const svc = getServiceClient();

  // Normalize email
  const email = data.email.toLowerCase().trim();

  // 1. Check if user already exists in profiles
  const { data: profiles } = await svc.from("profiles").select("id").eq("email", email);
  let targetUserId = profiles?.[0]?.id;

  if (targetUserId) {
    // Check if they are already in this organization
    const { data: existingMembership } = await svc
      .from("organization_members")
      .select("status")
      .eq("organization_id", ctx.orgId)
      .eq("user_id", targetUserId)
      .maybeSingle();

    if (existingMembership) {
      if (existingMembership.status === "active")
        throw new Error("User is already an active member.");
      if (existingMembership.status === "invited")
        throw new Error("User already has a pending invitation.");
      throw new Error(`User status is ${existingMembership.status}.`);
    }
  } else {
    // Create via Supabase Auth Admin
    const { data: inviteData, error: inviteError } = await svc.auth.admin.inviteUserByEmail(email);
    if (inviteError || !inviteData.user) {
      throw new Error(`Failed to invite user: ${inviteError?.message || "Unknown error"}`);
    }
    targetUserId = inviteData.user.id;
  }

  // 2. Insert into organization_members
  const { error: insertError } = await svc.from("organization_members").insert({
    organization_id: ctx.orgId,
    user_id: targetUserId,
    role: data.role as MemberRole,
    designation: data.designation || null,
    department: data.department || null,
    status: "invited",
    invited_by: ctx.user.id,
    joined_at: null,
  });

  if (insertError) {
    throw new Error(insertError.message);
  }

  // 3. Audit log
  await svc.from("audit_logs").insert({
    organization_id: ctx.orgId,
    actor_id: ctx.user.id,
    event_type: "member_invited",
    entity_type: "organization_members",
    entity_id: targetUserId,
    metadata: { email, role: data.role } as any,
  });

  return { success: true };
});

const IdInput = z.object({ id: z.string().uuid() });

export const resendInvitation = createServerFn({ method: "POST" }).handler(async (req) => {
  const data = IdInput.parse(req.data as any);
  const token = getRequestHeaders().get("authorization")?.replace("Bearer ", "");
  if (!token) throw new Error("Unauthorized");
  const ctx = await getCallerContext(token);
  enforceAdmin(ctx.role);

  const svc = getServiceClient();

  // Verify it is an invitation belonging to this org
  const { data: member } = await svc
    .from("organization_members")
    .select("status, user_id")
    .eq("id", data.id)
    .eq("organization_id", ctx.orgId)
    .maybeSingle();

  if (!member) throw new Error("Invitation not found");
  if (member.status !== "invited") throw new Error("Cannot resend an active or removed membership");

  const { data: profile } = await svc
    .from("profiles")
    .select("email")
    .eq("id", member.user_id)
    .maybeSingle();

  if (!profile?.email) throw new Error("User profile or email not found");
  const email = profile.email;

  // Re-invite
  const { error } = await svc.auth.admin.inviteUserByEmail(email);
  if (error) throw new Error(`Failed to resend invite: ${error.message}`);

  await svc.from("audit_logs").insert({
    organization_id: ctx.orgId,
    actor_id: ctx.user.id,
    event_type: "member_invited",
    entity_type: "organization_members",
    entity_id: member.user_id,
    metadata: { action: "invitation_resent", email } as any,
  });

  return { success: true };
});

export const cancelInvitation = createServerFn({ method: "POST" }).handler(async (req) => {
  const data = IdInput.parse(req.data as any);
  const token = getRequestHeaders().get("authorization")?.replace("Bearer ", "");
  if (!token) throw new Error("Unauthorized");
  const ctx = await getCallerContext(token);
  enforceAdmin(ctx.role);

  const svc = getServiceClient();

  // Verify it is an invitation belonging to this org
  const { data: member } = await svc
    .from("organization_members")
    .select("status, user_id")
    .eq("id", data.id)
    .eq("organization_id", ctx.orgId)
    .maybeSingle();

  if (!member) throw new Error("Invitation not found");
  if (member.status !== "invited") throw new Error("Cannot cancel an active or removed membership");

  // Physically delete the row so it's fully cancelled and can't be accepted
  const { error } = await svc
    .from("organization_members")
    .delete()
    .eq("id", data.id)
    .eq("organization_id", ctx.orgId);

  if (error) throw new Error(error.message);

  await svc.from("audit_logs").insert({
    organization_id: ctx.orgId,
    actor_id: ctx.user.id,
    event_type: "member_removed",
    entity_type: "organization_members",
    entity_id: member.user_id,
    metadata: { action: "invitation_cancelled" } as any,
  });

  return { success: true };
});

const MemberUpdateInput = z.object({
  memberId: z.string().uuid(),
  role: z.enum(["owner", "admin", "manager", "staff", "viewer"]).optional(),
  designation: z.string().nullable().optional(),
  department: z.string().nullable().optional(),
});

export const updateMemberRole = createServerFn({ method: "POST" }).handler(async (req) => {
  const data = MemberUpdateInput.parse(req.data as any);
  const token = getRequestHeaders().get("authorization")?.replace("Bearer ", "");
  if (!token) throw new Error("Unauthorized");
  const ctx = await getCallerContext(token);
  enforceAdmin(ctx.role);

  // Prevent assigning owner unless caller is owner
  if (data.role === "owner" && ctx.role !== "owner") {
    throw new Error("Only owners can assign the owner role.");
  }

  // Enforce governance: Only owners can create admins
  if (data.role === "admin" && ctx.role !== "owner") {
    throw new Error("Only owners can assign the admin role.");
  }

  const svc = getServiceClient();

  const { data: target } = await svc
    .from("organization_members")
    .select("role, user_id")
    .eq("id", data.memberId)
    .eq("organization_id", ctx.orgId)
    .maybeSingle();

  if (!target) throw new Error("Member not found.");

  // Prevent modifying an owner if caller is not an owner
  if (target.role === "owner" && ctx.role !== "owner") {
    throw new Error("Only owners can modify owner accounts.");
  }

  // Self-demotion protection for final owner
  // and Final owner protection generally
  if (target.role === "owner" && data.role && data.role !== "owner") {
    const { count } = await svc
      .from("organization_members")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", ctx.orgId)
      .eq("role", "owner")
      .eq("status", "active");

    if (count && count <= 1) {
      throw new Error("Cannot demote the final owner of the organization.");
    }
  }

  const updates: any = {};
  if (data.role) updates.role = data.role as MemberRole;
  if (data.designation !== undefined) updates.designation = data.designation;
  if (data.department !== undefined) updates.department = data.department;

  const { error } = await svc
    .from("organization_members")
    .update(updates)
    .eq("id", data.memberId)
    .eq("organization_id", ctx.orgId);

  if (error) throw new Error(error.message);

  await svc.from("audit_logs").insert({
    organization_id: ctx.orgId,
    actor_id: ctx.user.id,
    event_type: "member_role_changed",
    entity_type: "organization_members",
    entity_id: target.user_id,
    metadata: { action: "member_updated", old_role: target.role, updates } as any,
  });

  return { success: true };
});

export const removeMember = createServerFn({ method: "POST" }).handler(async (req) => {
  const data = IdInput.parse(req.data as any);
  const token = getRequestHeaders().get("authorization")?.replace("Bearer ", "");
  if (!token) throw new Error("Unauthorized");
  const ctx = await getCallerContext(token);
  enforceAdmin(ctx.role);

  const svc = getServiceClient();

  const { data: target } = await svc
    .from("organization_members")
    .select("role, user_id")
    .eq("id", data.id)
    .eq("organization_id", ctx.orgId)
    .maybeSingle();

  if (!target) throw new Error("Member not found.");

  // Prevent removing an owner if caller is not an owner
  if (target.role === "owner" && ctx.role !== "owner") {
    throw new Error("Only owners can remove owner accounts.");
  }

  // Check self-sabotage
  if (target.user_id === ctx.user.id) {
    throw new Error("You cannot remove yourself.");
  }

  // Final owner protection
  if (target.role === "owner") {
    const { count } = await svc
      .from("organization_members")
      .select("*", { count: "exact", head: true })
      .eq("organization_id", ctx.orgId)
      .eq("role", "owner")
      .eq("status", "active");

    if (count && count <= 1) {
      throw new Error("Cannot remove the final owner of the organization.");
    }
  }

  // Update status to removed instead of hard delete to preserve audit history
  const { error } = await svc
    .from("organization_members")
    .update({ status: "removed" })
    .eq("id", data.id)
    .eq("organization_id", ctx.orgId);

  if (error) throw new Error(error.message);

  await svc.from("audit_logs").insert({
    organization_id: ctx.orgId,
    actor_id: ctx.user.id,
    event_type: "member_removed",
    entity_type: "organization_members",
    entity_id: target.user_id,
    metadata: { action: "member_deactivated" } as any,
  });

  return { success: true };
});

export const acceptInvitation = createServerFn({ method: "POST" }).handler(async (req) => {
  const data = IdInput.parse(req.data as any);
  const token = getRequestHeaders().get("authorization")?.replace("Bearer ", "");
  if (!token) throw new Error("Unauthorized");

  const svc = getServiceClient();
  const userClient = getUserClient(token);
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  // Fetch the invitation
  const { data: invite } = await svc
    .from("organization_members")
    .select("user_id, status, organization_id")
    .eq("id", data.id)
    .maybeSingle();

  if (!invite) throw new Error("Invitation not found");
  if (invite.status !== "invited") throw new Error("Invitation is no longer pending");

  // IDENTITY VERIFICATION: Ensure the authenticated user matches the invitation target
  if (invite.user_id !== user.id) {
    throw new Error("This invitation belongs to a different user identity.");
  }

  // Check if they are already in an active org
  const { data: existingMembership } = await svc
    .from("organization_members")
    .select("id")
    .eq("user_id", user.id)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();

  if (existingMembership) {
    throw new Error("You are already an active member of an organization.");
  }

  // Atomically update the status
  const { error } = await svc
    .from("organization_members")
    .update({ status: "active", joined_at: new Date().toISOString() })
    .eq("id", data.id)
    .eq("status", "invited") // concurrency check
    .eq("user_id", user.id);

  if (error) throw new Error(error.message);

  await svc.from("audit_logs").insert({
    organization_id: invite.organization_id,
    actor_id: user.id,
    event_type: "member_joined",
    entity_type: "organization_members",
    entity_id: user.id,
    metadata: { action: "invitation_accepted" } as any,
  });

  return { success: true };
});

export const getMyPendingInvitations = createServerFn({ method: "GET" }).handler(async () => {
  const token = getRequestHeaders().get("authorization")?.replace("Bearer ", "");
  if (!token) return [];

  const svc = getServiceClient();
  const userClient = getUserClient(token);
  const {
    data: { user },
  } = await userClient.auth.getUser();
  if (!user) return [];

  const { data, error } = await svc
    .from("organization_members")
    .select(
      `
      id,
      role,
      organizations ( name, slug )
    `,
    )
    .eq("user_id", user.id)
    .eq("status", "invited");

  if (error) throw new Error(error.message);
  return data;
});
