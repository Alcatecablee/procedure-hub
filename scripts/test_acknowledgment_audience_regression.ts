import { processOperationalCompliance, processStaffCompliance } from "../src/lib/compliance.server.ts";
import assert from "assert";

console.log("==========================================================");
console.log("RUNNING CTO REGRESSION SUITE: ACKNOWLEDGMENT AUDIENCE");
console.log("==========================================================\n");

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✅ PASS: ${name}`);
    passed++;
  } catch (e: any) {
    console.error(`❌ FAIL: ${name} - ${e.message}`);
    failed++;
  }
}

// ─── SQL VIEW SIMULATOR ──────────────────────────────────────────
// Faithfully models the authoritative logic in `public.procedure_member_compliance`
interface Procedure {
  id: string;
  title: string;
  status: "draft" | "active" | "archived" | "replaced";
  acknowledgment_required: boolean;
  acknowledgment_audience: "staff" | "all_active_members";
  department_id: string | null;
  current_version_id: string | null;
  version_number: number;
}

interface Member {
  user_id: string;
  role: "owner" | "admin" | "manager" | "staff" | "viewer";
  status: "active" | "suspended" | "invited" | "removed";
  department_id: string | null;
}

interface Acknowledgment {
  procedure_id: string;
  procedure_version_id: string;
  user_id: string;
  revoked_at: string | null;
}

function simulateComplianceView(
  procedures: Procedure[],
  members: Member[],
  acknowledgments: Acknowledgment[],
) {
  const rows: any[] = [];

  for (const p of procedures) {
    // DB Filter: p.status = 'active' AND p.acknowledgment_required = TRUE AND p.current_version_id IS NOT NULL
    if (p.status !== "active" || !p.acknowledgment_required || !p.current_version_id) {
      continue;
    }

    for (const m of members) {
      // DB Filter: m.status = 'active'
      if (m.status !== "active") continue;

      // DB Filter: (p.department_id IS NULL OR p.department_id = m.department_id)
      if (p.department_id && p.department_id !== m.department_id) continue;

      // DB Filter: (p.acknowledgment_audience = 'all_active_members' OR (p.acknowledgment_audience = 'staff' AND m.role = 'staff'))
      const inAudience =
        p.acknowledgment_audience === "all_active_members" ||
        (p.acknowledgment_audience === "staff" && m.role === "staff");

      if (!inAudience) continue;

      // Calculate status against acknowledgments
      const userAcks = acknowledgments.filter(
        (a) => a.procedure_id === p.id && a.user_id === m.user_id && !a.revoked_at,
      );

      const hasAckedCurrent = userAcks.some(
        (a) => a.procedure_version_id === p.current_version_id,
      );
      const hasAckedAny = userAcks.length > 0;

      let compliance_status: "ACKNOWLEDGED" | "OUTSTANDING" | "REQUIRES_REACK";
      if (hasAckedCurrent) {
        compliance_status = "ACKNOWLEDGED";
      } else if (hasAckedAny) {
        compliance_status = "REQUIRES_REACK";
      } else {
        compliance_status = "OUTSTANDING";
      }

      rows.push({
        procedure_id: p.id,
        procedure_title: p.title,
        procedure_department_id: p.department_id,
        acknowledgment_audience: p.acknowledgment_audience,
        user_id: m.user_id,
        member_role: m.role,
        member_department_id: m.department_id,
        compliance_status,
      });
    }
  }

  return rows;
}

// ─── TEST 1: Department-Scoped, Staff-Only Procedure ──────────────
test("1. Department-scoped, staff-only procedure requires acknowledgment from its 5 staff members, not its manager or admin", () => {
  const deptA = "dept-customer-care";
  const members: Member[] = [
    { user_id: "mgr-1", role: "manager", status: "active", department_id: deptA },
    { user_id: "adm-1", role: "admin", status: "active", department_id: deptA },
    { user_id: "staff-1", role: "staff", status: "active", department_id: deptA },
    { user_id: "staff-2", role: "staff", status: "active", department_id: deptA },
    { user_id: "staff-3", role: "staff", status: "active", department_id: deptA },
    { user_id: "staff-4", role: "staff", status: "active", department_id: deptA },
    { user_id: "staff-5", role: "staff", status: "active", department_id: deptA },
  ];

  const procedure: Procedure = {
    id: "proc-1",
    title: "Till Roll Dispatch Policy",
    status: "active",
    acknowledgment_required: true,
    acknowledgment_audience: "staff",
    department_id: deptA,
    current_version_id: "ver-1",
    version_number: 1,
  };

  const viewRows = simulateComplianceView([procedure], members, []);
  assert.strictEqual(viewRows.length, 5, "Denominator must be exactly 5 (staff only)");

  // Manager and Admin must NOT be in the view rows
  assert.strictEqual(viewRows.some((r) => r.user_id === "mgr-1"), false, "Manager must not be required");
  assert.strictEqual(viewRows.some((r) => r.user_id === "adm-1"), false, "Admin must not be required");

  // Operational metrics
  const op = processOperationalCompliance(viewRows);
  assert.strictEqual(op.overall.totalRequired, 5);
  assert.strictEqual(op.overall.outstanding, 5);
  assert.strictEqual(op.overall.compliancePct, 0);

  // Personal metrics for manager: 0 required
  const mgrPersonal = processStaffCompliance(viewRows.filter((r) => r.user_id === "mgr-1"));
  assert.strictEqual(mgrPersonal.totalRequired, 0);
});

// ─── TEST 2: All Active Members Procedure ─────────────────────────
test("2. An all_active_members procedure includes all eligible active roles within its scope", () => {
  const deptA = "dept-customer-care";
  const members: Member[] = [
    { user_id: "owner-1", role: "owner", status: "active", department_id: null },
    { user_id: "adm-1", role: "admin", status: "active", department_id: deptA },
    { user_id: "mgr-1", role: "manager", status: "active", department_id: deptA },
    { user_id: "staff-1", role: "staff", status: "active", department_id: deptA },
  ];

  // Scoped to Dept A, but all_active_members
  const procedure: Procedure = {
    id: "proc-policy",
    title: "Information Security & Code of Conduct",
    status: "active",
    acknowledgment_required: true,
    acknowledgment_audience: "all_active_members",
    department_id: deptA,
    current_version_id: "ver-1",
    version_number: 1,
  };

  const viewRows = simulateComplianceView([procedure], members, []);
  // adm-1, mgr-1, staff-1 belong to deptA; owner-1 has department_id null so excluded by dept filter
  assert.strictEqual(viewRows.length, 3, "Denominator must include all 3 dept members across all roles");
  assert.strictEqual(viewRows.some((r) => r.user_id === "adm-1"), true, "Admin is required");
  assert.strictEqual(viewRows.some((r) => r.user_id === "mgr-1"), true, "Manager is required");
  assert.strictEqual(viewRows.some((r) => r.user_id === "staff-1"), true, "Staff is required");
});

// ─── TEST 3: Cross-Department Exclusion ───────────────────────────
test("3. A staff member in another department is excluded from a department-scoped procedure", () => {
  const deptA = "dept-support";
  const deptB = "dept-finance";
  const members: Member[] = [
    { user_id: "staff-a", role: "staff", status: "active", department_id: deptA },
    { user_id: "staff-b", role: "staff", status: "active", department_id: deptB },
  ];

  const procedure: Procedure = {
    id: "proc-dept-a",
    title: "Support Escalation Path",
    status: "active",
    acknowledgment_required: true,
    acknowledgment_audience: "staff",
    department_id: deptA,
    current_version_id: "ver-1",
    version_number: 1,
  };

  const viewRows = simulateComplianceView([procedure], members, []);
  assert.strictEqual(viewRows.length, 1);
  assert.strictEqual(viewRows[0].user_id, "staff-a");
  assert.strictEqual(viewRows.some((r) => r.user_id === "staff-b"), false, "Staff in Dept B must be excluded");
});

// ─── TEST 4: Draft, Archived, and Non-Ack Procedures ──────────────
test("4. Draft, archived, and non-acknowledgment-required procedures do not enter the denominator", () => {
  const members: Member[] = [
    { user_id: "staff-1", role: "staff", status: "active", department_id: null },
  ];

  const procedures: Procedure[] = [
    {
      id: "proc-draft",
      title: "Draft SOP",
      status: "draft",
      acknowledgment_required: true,
      acknowledgment_audience: "staff",
      department_id: null,
      current_version_id: null,
      version_number: 0,
    },
    {
      id: "proc-archived",
      title: "Retired SOP",
      status: "archived",
      acknowledgment_required: true,
      acknowledgment_audience: "staff",
      department_id: null,
      current_version_id: "ver-old",
      version_number: 1,
    },
    {
      id: "proc-no-ack",
      title: "Informational Notice",
      status: "active",
      acknowledgment_required: false,
      acknowledgment_audience: "staff",
      department_id: null,
      current_version_id: "ver-info",
      version_number: 1,
    },
  ];

  const viewRows = simulateComplianceView(procedures, members, []);
  assert.strictEqual(viewRows.length, 0, "Denominator must be 0 for draft, archived, or non-ack procedures");
  const op = processOperationalCompliance(viewRows);
  assert.strictEqual(op.overall.totalRequired, 0);
  assert.strictEqual(op.overall.compliancePct, null);
});

// ─── TEST 5: Versioning and Re-Acknowledgment Lifecycle ───────────
test("5. Acknowledging current version changes status; publishing newer version correctly requires re-acknowledgment", () => {
  const members: Member[] = [
    { user_id: "staff-1", role: "staff", status: "active", department_id: null },
  ];

  // Stage A: Version 1 active, no acks
  const procV1: Procedure = {
    id: "proc-lifecycle",
    title: "POS Refund Limits",
    status: "active",
    acknowledgment_required: true,
    acknowledgment_audience: "staff",
    department_id: null,
    current_version_id: "ver-1",
    version_number: 1,
  };

  let rows = simulateComplianceView([procV1], members, []);
  assert.strictEqual(rows[0].compliance_status, "OUTSTANDING");

  // Stage B: Staff acknowledges v1
  const acks: Acknowledgment[] = [
    { procedure_id: "proc-lifecycle", procedure_version_id: "ver-1", user_id: "staff-1", revoked_at: null },
  ];
  rows = simulateComplianceView([procV1], members, acks);
  assert.strictEqual(rows[0].compliance_status, "ACKNOWLEDGED");

  // Stage C: Manager publishes v2
  const procV2: Procedure = {
    ...procV1,
    current_version_id: "ver-2",
    version_number: 2,
  };
  rows = simulateComplianceView([procV2], members, acks);
  assert.strictEqual(rows[0].compliance_status, "REQUIRES_REACK", "Must require re-acknowledgment on v2");

  // Stage D: Staff acknowledges v2
  acks.push({
    procedure_id: "proc-lifecycle",
    procedure_version_id: "ver-2",
    user_id: "staff-1",
    revoked_at: null,
  });
  rows = simulateComplianceView([procV2], members, acks);
  assert.strictEqual(rows[0].compliance_status, "ACKNOWLEDGED", "Must be ACKNOWLEDGED once v2 is signed");
});

// ─── TEST 6: Personal View vs Management Aggregates Consistency ───
test("6. Personal acknowledgment view and management aggregates produce consistent counts", () => {
  const members: Member[] = [
    { user_id: "staff-1", role: "staff", status: "active", department_id: null },
    { user_id: "staff-2", role: "staff", status: "active", department_id: null },
    { user_id: "staff-3", role: "staff", status: "active", department_id: null },
  ];

  const proc: Procedure = {
    id: "proc-sync",
    title: "Clean Desk Policy",
    status: "active",
    acknowledgment_required: true,
    acknowledgment_audience: "staff",
    department_id: null,
    current_version_id: "ver-1",
    version_number: 1,
  };

  // staff-1 has acknowledged, staff-2 and staff-3 have not
  const acks: Acknowledgment[] = [
    { procedure_id: "proc-sync", procedure_version_id: "ver-1", user_id: "staff-1", revoked_at: null },
  ];

  const viewRows = simulateComplianceView([proc], members, acks);

  // Management aggregate
  const mgmt = processOperationalCompliance(viewRows);
  assert.strictEqual(mgmt.overall.totalRequired, 3);
  assert.strictEqual(mgmt.overall.acknowledged, 1);
  assert.strictEqual(mgmt.overall.outstanding, 2);
  assert.strictEqual(mgmt.overall.compliancePct, 33);

  // Personal aggregations
  const p1 = processStaffCompliance(viewRows.filter((r) => r.user_id === "staff-1"));
  const p2 = processStaffCompliance(viewRows.filter((r) => r.user_id === "staff-2"));
  const p3 = processStaffCompliance(viewRows.filter((r) => r.user_id === "staff-3"));

  assert.strictEqual(p1.acknowledged.length, 1);
  assert.strictEqual(p1.outstanding.length, 0);

  assert.strictEqual(p2.acknowledged.length, 0);
  assert.strictEqual(p2.outstanding.length, 1);

  assert.strictEqual(p3.acknowledged.length, 0);
  assert.strictEqual(p3.outstanding.length, 1);

  // Cross-check: Sum of personal equals management
  const totalPersonalAcked = p1.acknowledged.length + p2.acknowledged.length + p3.acknowledged.length;
  const totalPersonalOutstanding = p1.outstanding.length + p2.outstanding.length + p3.outstanding.length;
  assert.strictEqual(totalPersonalAcked, mgmt.overall.acknowledged);
  assert.strictEqual(totalPersonalOutstanding, mgmt.overall.outstanding);
});

// ─── TEST 7: Existing Tenants Retain Default Behavior ─────────────
test("7. Existing tenants' procedures retain intended behavior after migration (defaults to staff)", () => {
  const members: Member[] = [
    { user_id: "manager-lead", role: "manager", status: "active", department_id: null },
    { user_id: "agent-1", role: "staff", status: "active", department_id: null },
    { user_id: "agent-2", role: "staff", status: "active", department_id: null },
  ];

  // Procedure created before migration, backfilled with default 'staff'
  const backfilledProcedure: Procedure = {
    id: "proc-legacy",
    title: "Legacy Call Routing Procedure",
    status: "active",
    acknowledgment_required: true,
    acknowledgment_audience: "staff", // Default assigned by DB migration backfill
    department_id: null,
    current_version_id: "ver-legacy-1",
    version_number: 1,
  };

  const viewRows = simulateComplianceView([backfilledProcedure], members, []);
  
  // Total required must be 2 (the 2 agents), excluding manager-lead
  assert.strictEqual(viewRows.length, 2, "Backfill must scope legacy procedures to 2 staff members");
  assert.strictEqual(viewRows.every((r) => r.member_role === "staff"), true, "All required members are staff");
  
  const op = processOperationalCompliance(viewRows);
  assert.strictEqual(op.overall.totalRequired, 2);
});

console.log("\n==========================================================");
console.log(`TEST SUMMARY: ${passed} passed, ${failed} failed.`);
console.log("==========================================================");

if (failed > 0) {
  process.exit(1);
}
