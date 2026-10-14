import { createClient } from "@supabase/supabase-js";
import {
  createProcedureCore,
  updateProcedureCore,
  getProcedureAuditLogsCore,
} from "../src/lib/procedures.server";

const url = process.env.SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY!;

const adminClient = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function runAuditLogRegressionTests() {
  console.log("==================================================================");
  console.log("  PROCEDURE HUB - AUDIT LOG INPUT VALIDATION REGRESSION SUITE");
  console.log("==================================================================\n");

  const ts = Date.now();
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, label: string, detail?: string) {
    if (condition) {
      console.log(`✅ [PASS] ${label}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${label}${detail ? " - " + detail : ""}`);
      failed++;
    }
  }

  const createdUserIds: string[] = [];

  async function createTestUser(prefix: string, domain = "audit-test.example.com") {
    const email = `${prefix}_${ts}@${domain}`;
    const { data, error } = await adminClient.auth.admin.createUser({
      email,
      password: "Password123!",
      email_confirm: true,
      user_metadata: { full_name: `${prefix.toUpperCase()} User` },
    });
    if (error || !data.user) throw new Error(`Failed creating user ${email}: ${error?.message}`);
    createdUserIds.push(data.user.id);
    return { user: data.user, email };
  }

  async function signInUser(email: string) {
    const client = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.auth.signInWithPassword({
      email,
      password: "Password123!",
    });
    if (error || !data.session) throw new Error(`Failed signing in ${email}: ${error?.message}`);
    return { client, token: data.session.access_token };
  }

  try {
    // 1. Setup Org A and Org B
    const ownerA = await createTestUser("audit_owner_a", `audit-a-${ts}.com`);
    const staffA = await createTestUser("audit_staff_a", `audit-a-${ts}.com`);
    const ownerB = await createTestUser("audit_owner_b", `audit-b-${ts}.com`);

    const { data: orgA, error: orgAErr } = await adminClient
      .from("organizations")
      .insert({
        name: `Audit Org A ${ts}`,
        slug: `audit-org-a-${ts}`,
        domain: `audit-a-${ts}.com`,
        status: "active",
        created_by: ownerA.user.id,
      })
      .select()
      .single();
    if (orgAErr || !orgA) throw new Error("Failed creating Org A: " + orgAErr?.message);

    const { data: orgB, error: orgBErr } = await adminClient
      .from("organizations")
      .insert({
        name: `Audit Org B ${ts}`,
        slug: `audit-org-b-${ts}`,
        domain: `audit-b-${ts}.com`,
        status: "active",
        created_by: ownerB.user.id,
      })
      .select()
      .single();
    if (orgBErr || !orgB) throw new Error("Failed creating Org B: " + orgBErr?.message);

    await adminClient.from("organization_members").insert([
      { organization_id: orgA.id, user_id: ownerA.user.id, role: "owner", status: "active" },
      { organization_id: orgA.id, user_id: staffA.user.id, role: "staff", status: "active" },
      { organization_id: orgB.id, user_id: ownerB.user.id, role: "owner", status: "active" },
    ]);

    const sessOwnerA = await signInUser(ownerA.email);
    const sessStaffA = await signInUser(staffA.email);
    const sessOwnerB = await signInUser(ownerB.email);

    // 2. Create a procedure in Org A
    const procRes = await createProcedureCore(
      {
        organizationId: orgA.id,
        title: "Audit Safety Procedure",
        summary: "Testing audit log validation",
        description: "Full safety procedure details.",
        priority: "high",
        publish: false,
      },
      sessOwnerA.token,
    );
    const procId = procRes.procedureId;

    // Publish procedure to Version 1
    await updateProcedureCore(
      {
        id: procId,
        organizationId: orgA.id,
        title: "Audit Safety Procedure v1",
        summary: "Published version",
        description: "Full safety procedure details v1.",
        priority: "high",
        acknowledgmentRequired: true,
        publish: true,
        expectedVersion: 0,
      },
      sessOwnerA.token,
    );

    // TEST 1: Valid request returns expected audit events with resolved actor
    console.log("--- Test 1: Valid Audit Log Request ---");
    const validLogs = await getProcedureAuditLogsCore(
      { organizationId: orgA.id, id: procId },
      sessOwnerA.token,
    );
    assert(
      Array.isArray(validLogs) && validLogs.length >= 2,
      "Valid audit log request returns array of audit events",
    );
    assert(
      validLogs.some((l: any) => l.profiles?.email === ownerA.email),
      "Audit event contains resolved actor profile email",
    );

    // TEST 2: Missing organizationId is rejected by Zod schema
    console.log("\n--- Test 2: Missing or Invalid organizationId Rejected ---");
    let missingOrgRejected = false;
    let missingOrgError = "";
    try {
      // Intentionally passing only id, mimicking old GetProcedureInput behavior
      await getProcedureAuditLogsCore({ id: procId }, sessOwnerA.token);
    } catch (err: any) {
      missingOrgRejected = true;
      missingOrgError = err.message;
    }
    assert(
      missingOrgRejected && (missingOrgError.includes("organizationId") || missingOrgError.includes("Required")),
      "Missing organizationId is rejected with Zod schema validation error",
      missingOrgError,
    );

    // Invalid UUID for organizationId
    let invalidOrgRejected = false;
    let invalidOrgError = "";
    try {
      await getProcedureAuditLogsCore(
        { organizationId: "not-a-valid-uuid", id: procId },
        sessOwnerA.token,
      );
    } catch (err: any) {
      invalidOrgRejected = true;
      invalidOrgError = err.message;
    }
    assert(
      invalidOrgRejected && invalidOrgError.includes("Invalid uuid"),
      "Invalid UUID organizationId is rejected with Zod validation error",
      invalidOrgError,
    );

    // TEST 3: User from another organization cannot retrieve audit records
    console.log("\n--- Test 3: Cross-Organization Access Blocked ---");
    // Scenario 3a: Org B user passes Org A's organizationId
    let crossOrgRejected = false;
    let crossOrgError = "";
    try {
      await getProcedureAuditLogsCore(
        { organizationId: orgA.id, id: procId },
        sessOwnerB.token,
      );
    } catch (err: any) {
      crossOrgRejected = true;
      crossOrgError = err.message;
    }
    assert(
      crossOrgRejected && crossOrgError.includes("Forbidden: Insufficient organization role"),
      "User from Org B cannot retrieve Org A audit logs (rejected by verifyOrgRole)",
      crossOrgError,
    );

    // Scenario 3b: Org B user passes Org B's organizationId with Org A's procedureId
    let spoofOrgRejected = false;
    let spoofOrgError = "";
    try {
      await getProcedureAuditLogsCore(
        { organizationId: orgB.id, id: procId },
        sessOwnerB.token,
      );
    } catch (err: any) {
      spoofOrgRejected = true;
      spoofOrgError = err.message;
    }
    assert(
      spoofOrgRejected && spoofOrgError.includes("Procedure not found or access denied"),
      "Procedure lookup fails when procedure does not belong to caller organization",
      spoofOrgError,
    );

    // TEST 4: Unrelated / non-existent procedure ID cannot be used to retrieve audit history
    console.log("\n--- Test 4: Unrelated Procedure ID Rejected ---");
    const fakeProcId = "00000000-0000-0000-0000-000000000000";
    let fakeProcRejected = false;
    let fakeProcError = "";
    try {
      await getProcedureAuditLogsCore(
        { organizationId: orgA.id, id: fakeProcId },
        sessOwnerA.token,
      );
    } catch (err: any) {
      fakeProcRejected = true;
      fakeProcError = err.message;
    }
    assert(
      fakeProcRejected && fakeProcError.includes("Procedure not found or access denied"),
      "Non-existent procedure ID is rejected with 'Procedure not found or access denied'",
      fakeProcError,
    );

    // TEST 5: Draft procedure audit log access restrictions
    console.log("\n--- Test 5: Draft Procedure Access Controls ---");
    // Create an unpublished draft
    const draftProcRes = await createProcedureCore(
      {
        organizationId: orgA.id,
        title: "Confidential Draft Procedure",
        summary: "Draft not yet published",
        description: "Draft content.",
        priority: "medium",
        publish: false,
      },
      sessOwnerA.token,
    );

    // Staff in Org A attempting to access draft audit logs
    let staffDraftRejected = false;
    let staffDraftError = "";
    try {
      await getProcedureAuditLogsCore(
        { organizationId: orgA.id, id: draftProcRes.procedureId },
        sessStaffA.token,
      );
    } catch (err: any) {
      staffDraftRejected = true;
      staffDraftError = err.message;
    }
    assert(
      staffDraftRejected &&
        (staffDraftError.includes("Forbidden") ||
          staffDraftError.includes("Procedure not found or access denied")),
      "Staff member cannot access audit logs of an unpublished draft procedure",
      staffDraftError,
    );

    // Owner in Org A CAN access draft audit logs
    const ownerDraftLogs = await getProcedureAuditLogsCore(
      { organizationId: orgA.id, id: draftProcRes.procedureId },
      sessOwnerA.token,
    );
    assert(
      Array.isArray(ownerDraftLogs) && ownerDraftLogs.length >= 1,
      "Owner can access audit logs of an unpublished draft procedure in their organization",
    );
  } finally {
    for (const uid of createdUserIds) {
      await adminClient.auth.admin.deleteUser(uid).catch(() => {});
    }
  }

  console.log(`\n==================================================================`);
  console.log(`  AUDIT LOG TEST SUMMARY: ${passed} Passed, ${failed} Failed`);
  console.log(`==================================================================`);
  process.exit(failed > 0 ? 1 : 0);
}

runAuditLogRegressionTests().catch((err) => {
  console.error("Fatal error in audit log test suite:", err);
  process.exit(1);
});
