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

export function processOperationalCompliance(data: any[], deptMap?: Record<string, string>) {
  const totalRequired = data.length;
  const acknowledged = data.filter(d => d.compliance_status === "ACKNOWLEDGED").length;
  const outstanding = data.filter(d => d.compliance_status === "OUTSTANDING").length;
  const requiresReack = data.filter(d => d.compliance_status === "REQUIRES_REACK").length;
  const compliancePct = totalRequired === 0 ? null : Math.round((acknowledged / totalRequired) * 100);

  // Group by procedure
  const byProcedure = data.reduce((acc, curr) => {
    if (!acc[curr.procedure_id]) {
      acc[curr.procedure_id] = {
        procedure_id: curr.procedure_id,
        title: curr.procedure_title,
        total: 0,
        acknowledged: 0,
        outstanding: 0,
        requires_reack: 0,
      };
    }
    acc[curr.procedure_id].total++;
    if (curr.compliance_status === "ACKNOWLEDGED") acc[curr.procedure_id].acknowledged++;
    if (curr.compliance_status === "OUTSTANDING") acc[curr.procedure_id].outstanding++;
    if (curr.compliance_status === "REQUIRES_REACK") acc[curr.procedure_id].requires_reack++;
    return acc;
  }, {} as Record<string, any>);

  // Group by department
  const byDepartment = data.reduce((acc, curr) => {
    const deptId = curr.member_department_id || "unassigned";
    const deptName = deptId === "unassigned" ? "Unassigned" : (deptMap?.[deptId] || deptId);
    if (!acc[deptId]) {
      acc[deptId] = {
        department_id: deptId,
        department_name: deptName,
        total: 0,
        acknowledged: 0,
        outstanding: 0,
        requires_reack: 0,
      };
    }
    acc[deptId].total++;
    if (curr.compliance_status === "ACKNOWLEDGED") acc[deptId].acknowledged++;
    if (curr.compliance_status === "OUTSTANDING") acc[deptId].outstanding++;
    if (curr.compliance_status === "REQUIRES_REACK") acc[deptId].requires_reack++;
    return acc;
  }, {} as Record<string, any>);

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

  return processOperationalCompliance(data, deptMap);
});
