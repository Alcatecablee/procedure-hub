import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { getCallerContext, getServiceClient } from "./team.server";
import { getUserClient } from "./procedures.server";

export function processStaffCompliance(data: any[]) {
  return {
    acknowledged: data.filter(d => d.compliance_status === "ACKNOWLEDGED"),
    outstanding: data.filter(d => d.compliance_status === "OUTSTANDING"),
    requiresReack: data.filter(d => d.compliance_status === "REQUIRES_REACK"),
    totalRequired: data.length,
  };
}

export function processOperationalCompliance(
  data: any[],
  deptMap?: Record<string, string>,
  profilesMap?: Map<string, { email?: string | null; full_name?: string | null }>,
  profileLookupFailed = false,
  versionNumberMap?: Map<string, number>,
  activeProcs?: Array<{ id: string; title: string; priority?: string; department_id?: string | null }>,
  allDepts?: Array<{ id: string; name: string }>,
) {
  const totalRequired = data.length;
  const acknowledged = data.filter((d) => d.compliance_status === "ACKNOWLEDGED").length;
  const outstanding = data.filter((d) => d.compliance_status === "OUTSTANDING").length;
  const requiresReack = data.filter((d) => d.compliance_status === "REQUIRES_REACK").length;
  const compliancePct =
    totalRequired === 0 ? null : Math.round((acknowledged / totalRequired) * 100);

  // Group by procedure (pre-seeded with all active procedures in scope)
  const byProcedure: Record<string, any> = {};
  if (activeProcs) {
    for (const p of activeProcs) {
      byProcedure[p.id] = {
        procedure_id: p.id,
        title: p.title,
        priority: p.priority,
        department_id: p.department_id,
        total: 0,
        acknowledged: 0,
        outstanding: 0,
        requires_reack: 0,
      };
    }
  }

  for (const curr of data) {
    if (!byProcedure[curr.procedure_id]) {
      byProcedure[curr.procedure_id] = {
        procedure_id: curr.procedure_id,
        title: curr.procedure_title,
        total: 0,
        acknowledged: 0,
        outstanding: 0,
        requires_reack: 0,
      };
    }
    byProcedure[curr.procedure_id].total++;
    if (curr.compliance_status === "ACKNOWLEDGED") byProcedure[curr.procedure_id].acknowledged++;
    if (curr.compliance_status === "OUTSTANDING") byProcedure[curr.procedure_id].outstanding++;
    if (curr.compliance_status === "REQUIRES_REACK") byProcedure[curr.procedure_id].requires_reack++;
  }

  // Group by department (pre-seeded with all active departments)
  const byDepartment: Record<string, any> = {};
  if (allDepts) {
    for (const d of allDepts) {
      byDepartment[d.id] = {
        department_id: d.id,
        department_name: d.name,
        total: 0,
        acknowledged: 0,
        outstanding: 0,
        requires_reack: 0,
      };
    }
  }

  for (const curr of data) {
    const deptId = curr.member_department_id || "unassigned";
    const deptName = deptId === "unassigned" ? "Unassigned" : (deptMap?.[deptId] || deptId);
    if (!byDepartment[deptId]) {
      byDepartment[deptId] = {
        department_id: deptId,
        department_name: deptName,
        total: 0,
        acknowledged: 0,
        outstanding: 0,
        requires_reack: 0,
      };
    }
    byDepartment[deptId].total++;
    if (curr.compliance_status === "ACKNOWLEDGED") byDepartment[deptId].acknowledged++;
    if (curr.compliance_status === "OUTSTANDING") byDepartment[deptId].outstanding++;
    if (curr.compliance_status === "REQUIRES_REACK") byDepartment[deptId].requires_reack++;
  }

  // Group by member
  const byMember = data.reduce((acc, curr) => {
    const uid = curr.user_id;
    const profile = profilesMap?.get(uid);
    const deptId = curr.member_department_id || "unassigned";
    const deptName = deptId === "unassigned" ? "Unassigned" : (deptMap?.[deptId] || deptId);

    const displayName =
      profile?.full_name ||
      profile?.email ||
      curr.member_name ||
      (profileLookupFailed ? "Team Member (Profile Unavailable)" : "Team Member");
    const displayEmail =
      profile?.email ||
      curr.member_email ||
      (profileLookupFailed ? "Unavailable" : uid);

    if (!acc[uid]) {
      acc[uid] = {
        user_id: uid,
        email: displayEmail,
        name: displayName,
        role: curr.member_role || "staff",
        department_id: deptId,
        department_name: deptName,
        total: 0,
        acknowledged: 0,
        outstanding: 0,
        requires_reack: 0,
      };
    }
    acc[uid].total++;
    if (curr.compliance_status === "ACKNOWLEDGED") acc[uid].acknowledged++;
    if (curr.compliance_status === "OUTSTANDING") acc[uid].outstanding++;
    if (curr.compliance_status === "REQUIRES_REACK") acc[uid].requires_reack++;
    return acc;
  }, {} as Record<string, any>);

  // Individual roster items
  const roster = data.map((curr) => {
    const uid = curr.user_id;
    const profile = profilesMap?.get(uid);
    const deptId = curr.member_department_id || "unassigned";
    const deptName = deptId === "unassigned" ? "Unassigned" : (deptMap?.[deptId] || deptId);

    const displayName =
      profile?.full_name ||
      profile?.email ||
      curr.member_name ||
      (profileLookupFailed ? "Team Member (Profile Unavailable)" : "Team Member");
    const displayEmail =
      profile?.email ||
      curr.member_email ||
      (profileLookupFailed ? "Unavailable" : uid);

    const ackVersionNumber =
      curr.latest_ack_version_number ??
      (curr.compliance_status === "ACKNOWLEDGED"
        ? curr.current_version_number
        : curr.latest_ack_version_id
        ? versionNumberMap?.get(curr.latest_ack_version_id) || null
        : null);

    return {
      user_id: uid,
      member_name: displayName,
      member_email: displayEmail,
      member_role: curr.member_role || "staff",
      department_name: deptName,
      procedure_id: curr.procedure_id,
      procedure_title: curr.procedure_title,
      current_version_number: curr.current_version_number,
      latest_ack_version_id: curr.latest_ack_version_id,
      latest_ack_version_number: ackVersionNumber,
      latest_ack_date: curr.latest_ack_date,
      compliance_status: curr.compliance_status,
    };
  });

  return {
    overall: {
      totalRequired,
      acknowledged,
      outstanding,
      requiresReack,
      compliancePct,
    },
    byProcedure: Object.values(byProcedure).map((p: any) => ({
      ...p,
      compliancePct: p.total === 0 ? null : Math.round((p.acknowledged / p.total) * 100),
    })),
    byDepartment: Object.values(byDepartment).map((d: any) => ({
      ...d,
      compliancePct: d.total === 0 ? null : Math.round((d.acknowledged / d.total) * 100),
    })),
    byMember: Object.values(byMember).map((m: any) => ({
      ...m,
      compliancePct: m.total === 0 ? null : Math.round((m.acknowledged / m.total) * 100),
    })),
    roster,
    meta: {
      profileLookupFailed,
    },
  };
}

// Staff Compliance
export const getStaffCompliance = createServerFn({ method: "GET" }).handler(async () => {
  const token = getRequestHeaders().get("authorization")?.replace("Bearer ", "");
  if (!token) throw new Error("Unauthorized");
  
  const ctx = await getCallerContext(token);
  const client = getUserClient(token);

  const { data, error } = await client
    .from("procedure_member_compliance")
    .select("*")
    .eq("organization_id", ctx.orgId)
    .eq("user_id", ctx.user.id)
    .order("procedure_title");

  if (error) throw new Error(error.message);

  return processStaffCompliance(data);
});

// Operational Compliance
export const getOperationalCompliance = createServerFn({ method: "GET" }).handler(async () => {
  const token = getRequestHeaders().get("authorization")?.replace("Bearer ", "");
  if (!token) throw new Error("Unauthorized");
  
  const ctx = await getCallerContext(token);
  if (ctx.role !== "owner" && ctx.role !== "admin" && ctx.role !== "manager") {
    throw new Error("Forbidden: Insufficient role");
  }

  const svc = getServiceClient();

  // Fetch departments for friendly name mapping
  const { data: depts } = await svc
    .from("departments")
    .select("id, name")
    .eq("organization_id", ctx.orgId);
  const deptMap: Record<string, string> = {};
  if (depts) {
    for (const d of depts) {
      deptMap[d.id] = d.name;
    }
  }
  
  let query = svc
    .from("procedure_member_compliance")
    .select("*")
    .eq("organization_id", ctx.orgId);

  // Enforce Manager scope
  if (ctx.role === "manager") {
    if (!ctx.departmentId) throw new Error("Manager must be assigned to a department");
    query = query.eq("member_department_id", ctx.departmentId);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  // Fetch member profiles for display names and emails
  const userIds = Array.from(new Set((data || []).map((r) => r.user_id).filter(Boolean)));
  let profilesMap = new Map<string, { email?: string | null; full_name?: string | null }>();
  let profileLookupFailed = false;

  if (userIds.length > 0) {
    const { data: profiles, error: profilesError } = await svc
      .from("profiles")
      .select("id, email, full_name")
      .in("id", userIds);

    if (profilesError) {
      // Safely log on server without leaking sensitive info to client
      console.error("[compliance.server] Failed to fetch member profiles:", profilesError.message);
      profileLookupFailed = true;
    } else if (profiles) {
      profilesMap = new Map(profiles.map((p) => [p.id, p]));
    }
  }

  // Fetch version numbers for older/superseded acknowledgments
  const olderVersionIds = Array.from(
    new Set(
      (data || [])
        .filter((r) => r.compliance_status === "REQUIRES_REACK")
        .map((r) => r.latest_ack_version_id)
        .filter((id): id is string => typeof id === "string" && Boolean(id)),
    ),
  );
  let versionNumberMap = new Map<string, number>();
  if (olderVersionIds.length > 0) {
    const { data: versions, error: versionsError } = await svc
      .from("procedure_versions")
      .select("id, version_number")
      .in("id", olderVersionIds);

    if (versionsError) {
      console.error("[compliance.server] Failed to fetch superseded version numbers:", versionsError.message);
    } else if (versions) {
      versionNumberMap = new Map(versions.map((v) => [v.id, v.version_number]));
    }
  }

  // Fetch active procedures requiring acknowledgment in scope
  let procQuery = svc
    .from("procedures")
    .select("id, title, priority, department_id")
    .eq("organization_id", ctx.orgId)
    .eq("status", "active")
    .eq("acknowledgment_required", true);

  if (ctx.role === "manager" && ctx.departmentId) {
    procQuery = procQuery.eq("department_id", ctx.departmentId);
  }
  const { data: activeProcs } = await procQuery;

  return processOperationalCompliance(
    data,
    deptMap,
    profilesMap,
    profileLookupFailed,
    versionNumberMap,
    activeProcs || [],
    depts || [],
  );
});
