import assert from "assert";

console.log("==========================================================");
console.log("RUNNING CTO SUITE: ACKNOWLEDGMENT SUBMISSION AUTHORIZATION");
console.log("==========================================================\n");

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>) {
  try {
    const res = fn();
    if (res instanceof Promise) {
      res
        .then(() => {
          console.log(`✅ PASS: ${name}`);
          passed++;
        })
        .catch((e: any) => {
          console.error(`❌ FAIL: ${name} - ${e.message}`);
          failed++;
        });
    } else {
      console.log(`✅ PASS: ${name}`);
      passed++;
    }
  } catch (e: any) {
    console.error(`❌ FAIL: ${name} - ${e.message}`);
    failed++;
  }
}

// ─── SUBMISSION SIMULATOR ─────────────────────────────────────────
// Faithfully replicates the authorization pipeline in `acknowledgeProcedureCore`
// and `atomic_acknowledge_procedure`.

interface ProcedureRecord {
  id: string;
  organization_id: string;
  status: "draft" | "active" | "archived" | "replaced";
  acknowledgment_required: boolean;
  acknowledgment_audience: "staff" | "all_active_members";
  department_id: string | null;
  current_version_id: string | null;
}

interface MemberRecord {
  user_id: string;
  organization_id: string;
  role: "owner" | "admin" | "manager" | "staff" | "viewer";
  status: "active" | "suspended" | "invited" | "removed";
  department_id: string | null;
}

function simulateAcknowledgeSubmission(
  input: { procedureId: string; versionId: string; organizationId: string },
  member: MemberRecord | null,
  proc: ProcedureRecord | null,
) {
  // 1. Verify user is an active member with an eligible role
  if (!member || member.status !== "active") {
    throw new Error("Unauthorized: Active organization membership required");
  }

  const eligibleRoles = ["owner", "admin", "manager", "staff"];
  if (!eligibleRoles.includes(member.role)) {
    throw new Error(`Forbidden: Insufficient permissions for role ${member.role}`);
  }

  // 2. Fetch procedure to validate lifecycle status, version, audience, and department scope
  if (!proc || proc.organization_id !== input.organizationId) {
    throw new Error("Procedure not found");
  }

  if (proc.status !== "active") {
    throw new Error("Cannot acknowledge: Procedure is not active");
  }

  if (!proc.acknowledgment_required) {
    throw new Error("Cannot acknowledge: Acknowledgment is not required for this procedure");
  }

  if (!proc.current_version_id || proc.current_version_id !== input.versionId) {
    throw new Error(
      "Cannot acknowledge: This version is no longer the current version. Please refresh and review the latest version.",
    );
  }

  // 3. Department scope check
  if (proc.department_id && proc.department_id !== member.department_id) {
    throw new Error(
      "Forbidden: Member is not in the assigned department for this procedure",
    );
  }

  // 4. Audience eligibility check
  if (proc.acknowledgment_audience === "staff" && member.role !== "staff") {
    throw new Error(
      "Forbidden: This procedure only requires and accepts acknowledgments from staff",
    );
  }

  return { success: true };
}

// ─── TESTS ────────────────────────────────────────────────────────

const orgId = "org-test-123";
const deptGaap = "dept-gaap-1";
const deptQrs = "dept-qrs-2";

const activeStaffGaap: MemberRecord = {
  user_id: "user-staff-gaap",
  organization_id: orgId,
  role: "staff",
  status: "active",
  department_id: deptGaap,
};

const activeManagerGaap: MemberRecord = {
  user_id: "user-mgr-gaap",
  organization_id: orgId,
  role: "manager",
  status: "active",
  department_id: deptGaap,
};

const activeStaffQrs: MemberRecord = {
  user_id: "user-staff-qrs",
  organization_id: orgId,
  role: "staff",
  status: "active",
  department_id: deptQrs,
};

const activeAdmin: MemberRecord = {
  user_id: "user-admin",
  organization_id: orgId,
  role: "admin",
  status: "active",
  department_id: null,
};

const activeViewer: MemberRecord = {
  user_id: "user-viewer",
  organization_id: orgId,
  role: "viewer",
  status: "active",
  department_id: deptGaap,
};

const suspendedStaff: MemberRecord = {
  user_id: "user-staff-suspended",
  organization_id: orgId,
  role: "staff",
  status: "suspended",
  department_id: deptGaap,
};

const procStaffDeptGaap: ProcedureRecord = {
  id: "proc-staff-gaap",
  organization_id: orgId,
  status: "active",
  acknowledgment_required: true,
  acknowledgment_audience: "staff",
  department_id: deptGaap,
  current_version_id: "ver-100",
};

test("1. Manager attempting to acknowledge a staff-only procedure is rejected with Forbidden", () => {
  assert.throws(
    () => {
      simulateAcknowledgeSubmission(
        { procedureId: procStaffDeptGaap.id, versionId: "ver-100", organizationId: orgId },
        activeManagerGaap,
        procStaffDeptGaap,
      );
    },
    /Forbidden: This procedure only requires and accepts acknowledgments from staff/,
  );
});

const activeAdminGaap: MemberRecord = {
  user_id: "user-admin-gaap",
  organization_id: orgId,
  role: "admin",
  status: "active",
  department_id: deptGaap,
};

test("2. Admin attempting to acknowledge a staff-only procedure is rejected with Forbidden", () => {
  assert.throws(
    () => {
      simulateAcknowledgeSubmission(
        { procedureId: procStaffDeptGaap.id, versionId: "ver-100", organizationId: orgId },
        activeAdminGaap,
        procStaffDeptGaap,
      );
    },
    /Forbidden: This procedure only requires and accepts acknowledgments from staff/,
  );
});

test("3. Staff member in another department attempting to acknowledge is rejected with Forbidden", () => {
  assert.throws(
    () => {
      simulateAcknowledgeSubmission(
        { procedureId: procStaffDeptGaap.id, versionId: "ver-100", organizationId: orgId },
        activeStaffQrs,
        procStaffDeptGaap,
      );
    },
    /Forbidden: Member is not in the assigned department for this procedure/,
  );
});

test("4. Active member attempting to acknowledge an archived procedure is rejected", () => {
  const archivedProc: ProcedureRecord = {
    ...procStaffDeptGaap,
    status: "archived",
  };
  assert.throws(
    () => {
      simulateAcknowledgeSubmission(
        { procedureId: archivedProc.id, versionId: "ver-100", organizationId: orgId },
        activeStaffGaap,
        archivedProc,
      );
    },
    /Cannot acknowledge: Procedure is not active/,
  );
});

test("5. Active member attempting to acknowledge a draft procedure is rejected", () => {
  const draftProc: ProcedureRecord = {
    ...procStaffDeptGaap,
    status: "draft",
    current_version_id: null,
  };
  assert.throws(
    () => {
      simulateAcknowledgeSubmission(
        { procedureId: draftProc.id, versionId: "ver-100", organizationId: orgId },
        activeStaffGaap,
        draftProc,
      );
    },
    /Cannot acknowledge: Procedure is not active/,
  );
});

test("6. Active member attempting to acknowledge a procedure where acknowledgment is not required is rejected", () => {
  const nonAckProc: ProcedureRecord = {
    ...procStaffDeptGaap,
    acknowledgment_required: false,
  };
  assert.throws(
    () => {
      simulateAcknowledgeSubmission(
        { procedureId: nonAckProc.id, versionId: "ver-100", organizationId: orgId },
        activeStaffGaap,
        nonAckProc,
      );
    },
    /Cannot acknowledge: Acknowledgment is not required for this procedure/,
  );
});

test("7. Active member attempting to acknowledge an older superseded version is rejected", () => {
  assert.throws(
    () => {
      simulateAcknowledgeSubmission(
        { procedureId: procStaffDeptGaap.id, versionId: "ver-old-99", organizationId: orgId },
        activeStaffGaap,
        procStaffDeptGaap,
      );
    },
    /Cannot acknowledge: This version is no longer the current version/,
  );
});

test("8. Viewer role attempting to acknowledge is rejected with Forbidden", () => {
  assert.throws(
    () => {
      simulateAcknowledgeSubmission(
        { procedureId: procStaffDeptGaap.id, versionId: "ver-100", organizationId: orgId },
        activeViewer,
        procStaffDeptGaap,
      );
    },
    /Forbidden: Insufficient permissions for role viewer/,
  );
});

test("9. Suspended user attempting to acknowledge is rejected with Unauthorized", () => {
  assert.throws(
    () => {
      simulateAcknowledgeSubmission(
        { procedureId: procStaffDeptGaap.id, versionId: "ver-100", organizationId: orgId },
        suspendedStaff,
        procStaffDeptGaap,
      );
    },
    /Unauthorized: Active organization membership required/,
  );
});

test("10. Legitimate staff member in the assigned department acknowledging current version succeeds", () => {
  const res = simulateAcknowledgeSubmission(
    { procedureId: procStaffDeptGaap.id, versionId: "ver-100", organizationId: orgId },
    activeStaffGaap,
    procStaffDeptGaap,
  );
  assert.strictEqual(res.success, true);
});

test("11. Legitimate manager acknowledging an all_active_members procedure in their department succeeds", () => {
  const procAllMembersGaap: ProcedureRecord = {
    ...procStaffDeptGaap,
    id: "proc-all-gaap",
    acknowledgment_audience: "all_active_members",
  };
  const res = simulateAcknowledgeSubmission(
    { procedureId: procAllMembersGaap.id, versionId: "ver-100", organizationId: orgId },
    activeManagerGaap,
    procAllMembersGaap,
  );
  assert.strictEqual(res.success, true);
});

test("12. Legitimate staff member acknowledging a global staff-only procedure succeeds", () => {
  const procGlobalStaff: ProcedureRecord = {
    id: "proc-global-staff",
    organization_id: orgId,
    status: "active",
    acknowledgment_required: true,
    acknowledgment_audience: "staff",
    department_id: null,
    current_version_id: "ver-200",
  };
  const res1 = simulateAcknowledgeSubmission(
    { procedureId: procGlobalStaff.id, versionId: "ver-200", organizationId: orgId },
    activeStaffGaap,
    procGlobalStaff,
  );
  const res2 = simulateAcknowledgeSubmission(
    { procedureId: procGlobalStaff.id, versionId: "ver-200", organizationId: orgId },
    activeStaffQrs,
    procGlobalStaff,
  );
  assert.strictEqual(res1.success, true);
  assert.strictEqual(res2.success, true);
});

console.log(`\n==========================================================`);
console.log(`TEST SUMMARY: ${passed} passed, ${failed} failed.`);
console.log(`==========================================================`);
if (failed > 0) process.exit(1);
