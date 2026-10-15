import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getCallerContext, getServiceClient } from "./team.server";

export function getUserClient(token: string) {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anonKey) throw new Error("Supabase env not configured");
  return createClient<any>(url, anonKey, {
    global: { headers: { Authorization: "Bearer " + token } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function requireAuth(token: string) {
  const client = getUserClient(token);
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  if (error || !user) throw new Error("Unauthorized");
  return { client, user };
}

export async function verifyOrgRole(
  client: any,
  orgId: string,
  allowedRoles: string[],
  userId: string,
) {
  const { data } = await client
    .from("organization_members")
    .select("role")
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .eq("status", "active")
    .single();

  if (!data || !allowedRoles.includes(data.role)) {
    throw new Error("Forbidden: Insufficient organization role");
  }
}

const CreateProcedureInput = z.object({
  organizationId: z.string().uuid(),
  categoryId: z.string().uuid().optional().nullable(),
  title: z.string().min(1).max(250),
  summary: z.string().max(500).optional().nullable(),
  description: z.string().optional().nullable(),
  priority: z.enum(["critical", "high", "medium", "informational"]).default("medium"),
  effectiveDate: z.string().optional().nullable(),
  expiryDate: z.string().optional().nullable(),
  acknowledgmentRequired: z.boolean().default(true),
  acknowledgmentAudience: z.enum(["staff", "all_active_members"]).default("staff"),
  publish: z.boolean().default(false),
  departmentId: z.string().uuid().optional().nullable(),
});

export async function createProcedureCore(dataRaw: any, token: string) {
  const data = CreateProcedureInput.parse(dataRaw);
  if (!token) throw new Error("Unauthorized");

  const { client, user } = await requireAuth(token);
  await verifyOrgRole(client, data.organizationId, ["owner", "admin", "manager"], user.id);

  if (data.effectiveDate && data.expiryDate) {
    if (new Date(data.effectiveDate) >= new Date(data.expiryDate)) {
      throw new Error("Effective date must be before expiry date");
    }
  }

  const { data: procId, error } = await client.rpc("atomic_create_procedure", {
    _org_id: data.organizationId,
    _title: data.title,
    _summary: data.summary,
    _description: data.description,
    _priority: data.priority,
    _category_id: data.categoryId || null,
    _effective_date: data.effectiveDate || null,
    _expiry_date: data.expiryDate || null,
    _ack_required: data.acknowledgmentRequired,
    _publish: data.publish,
    _department_id: data.departmentId,
    _ack_audience: data.acknowledgmentAudience,
  });

  if (error) throw new Error(error.message);
  return { procedureId: procId };
}

const UpdateProcedureInput = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  categoryId: z.string().uuid().optional().nullable(),
  title: z.string().min(1).max(250),
  summary: z.string().max(500).optional().nullable(),
  description: z.string().optional().nullable(),
  priority: z.enum(["critical", "high", "medium", "informational"]),
  effectiveDate: z.string().optional().nullable(),
  expiryDate: z.string().optional().nullable(),
  acknowledgmentRequired: z.boolean(),
  acknowledgmentAudience: z.enum(["staff", "all_active_members"]).default("staff"),
  publish: z.boolean().default(false),
  expectedVersion: z.number(),
  departmentId: z.string().uuid().optional().nullable(),
});

export async function updateProcedureCore(dataRaw: any, token: string) {
  const data = UpdateProcedureInput.parse(dataRaw);
  if (!token) throw new Error("Unauthorized");

  const { client, user } = await requireAuth(token);
  await verifyOrgRole(client, data.organizationId, ["owner", "admin", "manager"], user.id);

  if (data.effectiveDate && data.expiryDate) {
    if (new Date(data.effectiveDate) >= new Date(data.expiryDate)) {
      throw new Error("Effective date must be before expiry date");
    }
  }

  const { data: current } = await client
    .from("procedures")
    .select(
      "id, title, summary, description, priority, category_id, effective_date, expiry_date, acknowledgment_required, acknowledgment_audience, department_id, status, version_number",
    )
    .eq("id", data.id)
    .eq("organization_id", data.organizationId)
    .maybeSingle();

  if (current) {
    if (current.version_number !== data.expectedVersion) {
      throw new Error("Conflict: Procedure was modified by someone else.");
    }

    const nextDeptId =
      data.departmentId !== undefined ? data.departmentId || null : current.department_id;
    const hasChanges =
      (current.title || "") !== (data.title || "") ||
      (current.summary || "") !== (data.summary || "") ||
      (current.description || "") !== (data.description || "") ||
      current.priority !== data.priority ||
      (current.category_id || null) !== (data.categoryId || null) ||
      (current.effective_date || null) !== (data.effectiveDate || null) ||
      (current.expiry_date || null) !== (data.expiryDate || null) ||
      Boolean(current.acknowledgment_required) !== Boolean(data.acknowledgmentRequired) ||
      (current.acknowledgment_audience || "staff") !== (data.acknowledgmentAudience || "staff") ||
      (current.department_id || null) !== (nextDeptId || null);

    if (!hasChanges && !data.publish) {
      return { procedureId: data.id, published: false, skipped: true };
    }
    if (!hasChanges && data.publish && current.status === "active") {
      return { procedureId: data.id, published: true, skipped: true };
    }
  }

  const { data: res, error } = await client.rpc("atomic_update_procedure", {
    _proc_id: data.id,
    _org_id: data.organizationId,
    _title: data.title,
    _summary: data.summary,
    _description: data.description,
    _priority: data.priority,
    _category_id: data.categoryId || null,
    _effective_date: data.effectiveDate || null,
    _expiry_date: data.expiryDate || null,
    _ack_required: data.acknowledgmentRequired,
    _publish: data.publish,
    _department_id: data.departmentId || null,
    _expected_version: data.expectedVersion,
    _ack_audience: data.acknowledgmentAudience,
  });

  if (error) throw new Error(error.message);
  if (typeof res === "object" && res !== null) {
    return res;
  }
  return { procedureId: data.id, published: Boolean(data.publish), skipped: false };
}

const AcknowledgeInput = z.object({
  procedureId: z.string().uuid(),
  versionId: z.string().uuid(),
  organizationId: z.string().uuid(),
});

export async function acknowledgeProcedureCore(dataRaw: any, token: string) {
  const data = AcknowledgeInput.parse(dataRaw);
  if (!token) throw new Error("Unauthorized");

  const { client, user } = await requireAuth(token);
  await verifyOrgRole(
    client,
    data.organizationId,
    ["owner", "admin", "manager", "staff"],
    user.id,
  );

  const { error } = await client.rpc("atomic_acknowledge_procedure", {
    _proc_id: data.procedureId,
    _ver_id: data.versionId,
    _org_id: data.organizationId,
  });

  if (error) throw new Error(error.message);
  return { success: true };
}

const GetProceduresInput = z.object({
  organizationId: z.string().uuid(),
  query: z.string().optional(),
  status: z.enum(["active", "draft", "archived", "replaced", "all"]).default("active"),
  page: z.number().min(1).default(1),
  pageSize: z.number().min(1).max(100).default(20),
});

export const getProcedures = createServerFn({ method: "GET" })
  .inputValidator(GetProceduresInput)
  .handler(async (ctx) => {
  const data = GetProceduresInput.parse(ctx.data as any);
  const headers = getRequestHeaders();
  const token = headers.get("authorization")?.replace("Bearer ", "");
  if (!token) throw new Error("Unauthorized");

  const { client, user } = await requireAuth(token);

  const { data: member } = await client
    .from("organization_members")
    .select("role, department_id")
    .eq("organization_id", data.organizationId)
    .eq("user_id", user.id)
    .eq("status", "active")
    .single();

  const isAdmin = member && ["owner", "admin", "manager"].includes(member.role);

  const offset = (data.page - 1) * data.pageSize;
  let query = client
    .from("procedures")
    .select(
      "id, title, summary, status, priority, category_id, department_id, current_version_id, version_number, effective_date, expiry_date, acknowledgment_required, acknowledgment_audience, created_at, updated_at",
    )
    .eq("organization_id", data.organizationId);

  let requestedStatus = data.status;
  if (!isAdmin && requestedStatus === "draft") {
    // Staff cannot explicitly request drafts
    return { procedures: [], total: 0 };
  }

  if (requestedStatus !== "all" && requestedStatus !== "replaced") {
    query = query.eq("status", requestedStatus);
  } else if (!isAdmin) {
    // If staff requests "all", exclude drafts
    query = query.neq("status", "draft");
  }

  if (data.query) {
    query = query.or(
      `title.ilike.%${data.query}%,summary.ilike.%${data.query}%,description.ilike.%${data.query}%`,
    );
  }

  const { data: procedures, error } = await query
    .order("updated_at", { ascending: false })
    .range(offset, offset + data.pageSize - 1);

  if (error) throw new Error(error.message);

  const procList = procedures || [];
  const procIds = procList.map((p) => p.id);

  let userAckMap: Record<string, string> = {};
  if (procIds.length > 0) {
    const { data: acks } = await client
      .from("acknowledgments")
      .select("procedure_id, procedure_version_id")
      .eq("user_id", user.id)
      .in("procedure_id", procIds)
      .is("revoked_at", null);

    if (acks) {
      for (const a of acks) {
        userAckMap[a.procedure_id] = a.procedure_version_id;
      }
    }
  }

  const enriched = procList.map((p) => {
    const ackedVerId = userAckMap[p.id];
    const isAcked = Boolean(p.current_version_id && ackedVerId === p.current_version_id);
    const isTargetAudience =
      p.acknowledgment_audience === "all_active_members" || member?.role === "staff";
    const isTargetDepartment = !p.department_id || p.department_id === member?.department_id;
    const isEligibleRole = ["owner", "admin", "manager", "staff"].includes(member?.role || "");
    const isObligated = isEligibleRole && isTargetAudience && isTargetDepartment;
    const needsAck = Boolean(
      p.acknowledgment_required && p.status === "active" && isObligated && !isAcked,
    );

    return {
      ...p,
      is_acknowledged: isAcked,
      is_obligated: isObligated,
      needs_acknowledgment: needsAck,
    };
  });

  return { procedures: enriched };
});

export const createProcedure = createServerFn({ method: "POST" })
  .inputValidator(CreateProcedureInput)
  .handler(async (ctx) => {
  const token = getRequestHeaders().get("authorization")?.replace("Bearer ", "");
  if (!token) throw new Error("Unauthorized");
  return createProcedureCore(ctx.data, token);
});

export const updateProcedure = createServerFn({ method: "POST" })
  .inputValidator(UpdateProcedureInput)
  .handler(async (ctx) => {
  const token = getRequestHeaders().get("authorization")?.replace("Bearer ", "");
  if (!token) throw new Error("Unauthorized");
  return updateProcedureCore(ctx.data, token);
});

export const acknowledgeProcedure = createServerFn({ method: "POST" })
  .inputValidator(AcknowledgeInput)
  .handler(async (ctx) => {
  const token = getRequestHeaders().get("authorization")?.replace("Bearer ", "");
  if (!token) throw new Error("Unauthorized");
  return acknowledgeProcedureCore(ctx.data, token);
});

const GetProcedureInput = z.object({
  organizationId: z.string().uuid(),
  id: z.string().uuid(),
});

export const getProcedure = createServerFn({ method: "GET" })
  .inputValidator(GetProcedureInput)
  .handler(async (ctx) => {
  const data = GetProcedureInput.parse(ctx.data as any);
  const headers = getRequestHeaders();
  const token = headers.get("authorization")?.replace("Bearer ", "");
  if (!token) throw new Error("Unauthorized");

  const { client, user } = await requireAuth(token);

  const { data: proc, error: pErr } = await client
    .from("procedures")
    .select("*, categories(name)")
    .eq("id", data.id)
    .eq("organization_id", data.organizationId)
    .single();

  if (pErr || !proc) throw new Error(pErr?.message || "Procedure not found");

  if (proc.status === "draft") {
    // Only admins can view drafts
    const { data: member } = await client
      .from("organization_members")
      .select("role")
      .eq("organization_id", data.organizationId)
      .eq("user_id", user.id)
      .eq("status", "active")
      .single();
    if (!member || !["owner", "admin", "manager"].includes(member.role)) {
      throw new Error("Forbidden: Procedure not found or access denied");
    }
  }

  const { data: versions } = await client
    .from("procedure_versions")
    .select("*")
    .eq("procedure_id", data.id)
    .order("version_number", { ascending: false });

  // Get current user's acknowledgments for this procedure
  const { data: acks } = await client
    .from("acknowledgments")
    .select("procedure_version_id")
    .eq("procedure_id", data.id)
    .eq("user_id", user.id)
    .is("revoked_at", null);

  return {
    procedure: proc,
    versions: versions || [],
    acknowledgedVersions: (acks || []).map((a) => a.procedure_version_id),
  };
});

const GetCategoriesInput = z.object({
  organizationId: z.string().uuid(),
});

export const getCategories = createServerFn({ method: "GET" })
  .inputValidator(GetCategoriesInput)
  .handler(async (ctx) => {
  const data = GetCategoriesInput.parse(ctx.data as any);
  const headers = getRequestHeaders();
  const token = headers.get("authorization")?.replace("Bearer ", "");
  if (!token) throw new Error("Unauthorized");

  const { client } = await requireAuth(token);

  const { data: categories, error } = await client
    .from("categories")
    .select("id, name, slug")
    .eq("organization_id", data.organizationId)
    .order("sort_order");

  if (error) throw new Error(error.message);
  return { categories: categories || [] };
});

const ArchiveProcedureInput = z.object({
  organizationId: z.string().uuid(),
  id: z.string().uuid(),
});

export async function archiveProcedureCore(dataRaw: any, token: string) {
  const data = ArchiveProcedureInput.parse(dataRaw);
  const { client, user } = await requireAuth(token);
  await verifyOrgRole(client, data.organizationId, ["owner", "admin", "manager"], user.id);

  const { error } = await client.rpc("atomic_archive_procedure", {
    _proc_id: data.id,
    _org_id: data.organizationId,
  });

  if (error) {
    console.error("Archive error:", error);
    throw new Error(error.message);
  }

  return { success: true };
}

export const archiveProcedure = createServerFn({ method: "POST" })
  .inputValidator(ArchiveProcedureInput)
  .handler(async (ctx) => {
  const token = getRequestHeaders().get("authorization")?.replace("Bearer ", "");
  if (!token) throw new Error("Unauthorized");
  return archiveProcedureCore(ctx.data, token);
});

const ReplaceProcedureInput = z.object({
  organizationId: z.string().uuid(),
  oldProcedureId: z.string().uuid(),
  newProcedureId: z.string().uuid(),
});

export async function replaceProcedureCore(dataRaw: any, token: string) {
  const data = ReplaceProcedureInput.parse(dataRaw);
  const { client, user } = await requireAuth(token);
  await verifyOrgRole(client, data.organizationId, ["owner", "admin", "manager"], user.id);

  const { error } = await client.rpc("atomic_replace_procedure", {
    _old_proc_id: data.oldProcedureId,
    _new_proc_id: data.newProcedureId,
    _org_id: data.organizationId,
  });

  if (error) {
    console.error("Replace error:", error);
    throw new Error(error.message);
  }

  return { success: true };
}

export const replaceProcedure = createServerFn({ method: "POST" })
  .inputValidator(ReplaceProcedureInput)
  .handler(async (ctx) => {
  const token = getRequestHeaders().get("authorization")?.replace("Bearer ", "");
  if (!token) throw new Error("Unauthorized");
  return replaceProcedureCore(ctx.data, token);
});

const GetProcedureAuditLogsInput = z.object({
  organizationId: z.string().uuid(),
  id: z.string().uuid(),
});

export async function getProcedureAuditLogsCore(dataRaw: any, token: string) {
  const data = GetProcedureAuditLogsInput.parse(dataRaw);
  if (!token) throw new Error("Unauthorized");

  const { client, user } = await requireAuth(token);

  // Verify caller has manager, admin, or owner role in the organization
  await verifyOrgRole(
    client,
    data.organizationId,
    ["owner", "admin", "manager"],
    user.id,
  );

  // Verify the procedure exists in the organization and is accessible to caller
  const { data: proc, error: pErr } = await client
    .from("procedures")
    .select("id, status, department_id")
    .eq("id", data.id)
    .eq("organization_id", data.organizationId)
    .maybeSingle();

  if (pErr || !proc) {
    throw new Error("Procedure not found or access denied");
  }

  const { data: versions } = await client
    .from("procedure_versions")
    .select("id")
    .eq("procedure_id", data.id)
    .eq("organization_id", data.organizationId);
  const versionIds = versions?.map((v: any) => v.id) || [];

  let orString = `and(entity_type.eq.procedure,entity_id.eq.${data.id})`;
  if (versionIds.length > 0) {
    orString += `,and(entity_type.eq.procedure_version,entity_id.in.(${versionIds.join(",")}))`;
  }
  orString += `,and(entity_type.eq.import_draft,metadata->>procedure_id.eq.${data.id})`;

  const { data: logs, error } = await client
    .from("audit_logs")
    .select("*")
    .eq("organization_id", data.organizationId)
    .or(orString)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) throw new Error(error.message);
  if (!logs || logs.length === 0) return [];

  const actorIds = Array.from(
    new Set(logs.map((l: any) => l.actor_id).filter((id: any): id is string => Boolean(id))),
  );

  let profilesMap = new Map<string, { full_name: string | null; email: string }>();
  if (actorIds.length > 0) {
    const svc = getServiceClient();
    const { data: profiles } = await svc
      .from("profiles")
      .select("id, full_name, email")
      .in("id", actorIds);
    profilesMap = new Map(profiles?.map((p: any) => [p.id, p]) || []);
  }

  return logs.map((l: any) => ({
    ...l,
    profiles: l.actor_id ? profilesMap.get(l.actor_id) || null : null,
  }));
}

export const getProcedureAuditLogs = createServerFn({ method: "GET" })
  .inputValidator(GetProcedureAuditLogsInput)
  .handler(async (ctx) => {
    const headers = getRequestHeaders();
    const token = headers.get("authorization")?.replace("Bearer ", "");
    if (!token) throw new Error("Unauthorized");
    return getProcedureAuditLogsCore(ctx.data, token);
  });

const ManageCategoryInput = z.object({
  organizationId: z.string().uuid(),
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(100),
  slug: z
    .string()
    .regex(/^[a-z0-9][a-z0-9\-]*[a-z0-9]$/)
    .optional(),
});

export const createCategory = createServerFn({ method: "POST" })
  .inputValidator(ManageCategoryInput)
  .handler(async (ctx) => {
  const data = ManageCategoryInput.parse(ctx.data);
  const headers = getRequestHeaders();
  const token = headers.get("authorization")?.replace("Bearer ", "");
  if (!token) throw new Error("Unauthorized");

  const { client, user } = await requireAuth(token);
  await verifyOrgRole(client, data.organizationId, ["owner", "admin"], user.id);

  const slug =
    data.slug ||
    data.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");

  const { data: cat, error } = await client
    .from("categories")
    .insert({
      organization_id: data.organizationId,
      name: data.name,
      slug: slug,
    })
    .select("id, name, slug")
    .single();

  if (error) throw new Error(error.message);
  return cat;
});

export const updateCategory = createServerFn({ method: "POST" })
  .inputValidator(ManageCategoryInput)
  .handler(async (ctx) => {
  const data = ManageCategoryInput.parse(ctx.data);
  if (!data.id) throw new Error("Category ID required");
  const headers = getRequestHeaders();
  const token = headers.get("authorization")?.replace("Bearer ", "");
  if (!token) throw new Error("Unauthorized");

  const { client, user } = await requireAuth(token);
  await verifyOrgRole(client, data.organizationId, ["owner", "admin"], user.id);

  const slug =
    data.slug ||
    data.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");

  const { data: cat, error } = await client
    .from("categories")
    .update({ name: data.name, slug: slug })
    .eq("id", data.id)
    .eq("organization_id", data.organizationId)
    .select("id, name, slug")
    .single();

  if (error) throw new Error(error.message);
  return cat;
});

const DeleteCategoryInput = z.object({
  organizationId: z.string().uuid(),
  id: z.string().uuid(),
});

export const deleteCategory = createServerFn({ method: "POST" })
  .inputValidator(DeleteCategoryInput)
  .handler(async (ctx) => {
  const data = DeleteCategoryInput.parse(ctx.data);
  const headers = getRequestHeaders();
  const token = headers.get("authorization")?.replace("Bearer ", "");
  if (!token) throw new Error("Unauthorized");

  const { client, user } = await requireAuth(token);
  await verifyOrgRole(client, data.organizationId, ["owner", "admin"], user.id);

  const { error } = await client
    .from("categories")
    .delete()
    .eq("id", data.id)
    .eq("organization_id", data.organizationId);

  if (error) throw new Error(error.message);
  return { success: true };
});

export const getDepartments = createServerFn({ method: "GET" }).handler(async () => {
  const token = getRequestHeaders().get("authorization")?.replace("Bearer ", "");
  if (!token) return [];
  const ctx = await getCallerContext(token);

  const svc = getServiceClient();
  const { data, error } = await svc
    .from("departments")
    .select("id, name")
    .eq("organization_id", ctx.orgId)
    .order("name");

  if (error) throw new Error(error.message);
  return data || [];
});

const ManageDepartmentInput = z.object({
  organizationId: z.string().uuid(),
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(100),
});

const DeleteDepartmentInput = z.object({
  organizationId: z.string().uuid(),
  id: z.string().uuid(),
});

export const createDepartment = createServerFn({ method: "POST" })
  .inputValidator(ManageDepartmentInput)
  .handler(async (ctx) => {
  const data = ManageDepartmentInput.parse(ctx.data);
  const token = getRequestHeaders().get("authorization")?.replace("Bearer ", "");
  if (!token) throw new Error("Unauthorized");

  const { client, user } = await requireAuth(token);
  await verifyOrgRole(client, data.organizationId, ["owner", "admin"], user.id);

  const svc = getServiceClient();
  const { data: dept, error } = await svc
    .from("departments")
    .insert({
      organization_id: data.organizationId,
      name: data.name.trim(),
    })
    .select("id, name")
    .single();

  if (error) throw new Error(error.message);
  return dept;
});

export const updateDepartment = createServerFn({ method: "POST" })
  .inputValidator(ManageDepartmentInput)
  .handler(async (ctx) => {
  const data = ManageDepartmentInput.parse(ctx.data);
  if (!data.id) throw new Error("Department ID required");
  const token = getRequestHeaders().get("authorization")?.replace("Bearer ", "");
  if (!token) throw new Error("Unauthorized");

  const { client, user } = await requireAuth(token);
  await verifyOrgRole(client, data.organizationId, ["owner", "admin"], user.id);

  const svc = getServiceClient();
  const { data: dept, error } = await svc
    .from("departments")
    .update({ name: data.name.trim(), updated_at: new Date().toISOString() })
    .eq("id", data.id)
    .eq("organization_id", data.organizationId)
    .select("id, name")
    .single();

  if (error) throw new Error(error.message);
  return dept;
});

export const deleteDepartment = createServerFn({ method: "POST" })
  .inputValidator(DeleteDepartmentInput)
  .handler(async (ctx) => {
  const data = DeleteDepartmentInput.parse(ctx.data);
  const token = getRequestHeaders().get("authorization")?.replace("Bearer ", "");
  if (!token) throw new Error("Unauthorized");

  const { client, user } = await requireAuth(token);
  await verifyOrgRole(client, data.organizationId, ["owner", "admin"], user.id);

  const svc = getServiceClient();
  const { error } = await svc
    .from("departments")
    .delete()
    .eq("id", data.id)
    .eq("organization_id", data.organizationId);

  if (error) throw new Error(error.message);
  return { success: true };
});