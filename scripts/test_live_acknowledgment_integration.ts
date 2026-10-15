import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import { acknowledgeProcedureCore } from "../src/lib/procedures.server";

// 1. Manually load environment variables from .env
const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
      process.env[key] = val;
    }
  }
}

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!;
const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function runLiveIntegrationTests() {
  console.log("==================================================================");
  console.log("RUNNING REAL SUPABASE INTEGRATION TEST SUITE: ACKNOWLEDGMENT AUTH");
  console.log("Target Environment:", url);
  console.log("==================================================================\n");

  const ts = Date.now();
  const cleanupUserIds: string[] = [];
  let testOrgId: string | null = null;

  try {
    // -------------------------------------------------------------
    // SETUP: Isolated Test Organization & Departments
    // -------------------------------------------------------------
    console.log("1. Setting up isolated test organization & departments...");
    const { data: org, error: orgErr } = await admin
      .from("organizations")
      .insert({
        name: `Integration Test Org ${ts}`,
        slug: `integration-test-${ts}`,
        status: "active",
      })
      .select()
      .single();
    if (orgErr || !org) throw new Error("Failed to create test org: " + orgErr?.message);
    testOrgId = org.id;

    const { data: deptAlpha, error: dAErr } = await admin
      .from("departments")
      .insert({ organization_id: testOrgId, name: `Dept Alpha ${ts}` })
      .select()
      .single();
    if (dAErr || !deptAlpha) throw new Error("Failed to create Dept Alpha: " + dAErr?.message);

    const { data: deptBeta, error: dBErr } = await admin
      .from("departments")
      .insert({ organization_id: testOrgId, name: `Dept Beta ${ts}` })
      .select()
      .single();
    if (dBErr || !deptBeta) throw new Error("Failed to create Dept Beta: " + dBErr?.message);

    // -------------------------------------------------------------
    // SETUP: Real Auth Users and Active Memberships
    // -------------------------------------------------------------
    console.log("2. Creating real test users with authentic Supabase JWTs...");
    const createTestUser = async (emailPrefix: string, role: "manager" | "staff", deptId: string) => {
      const email = `${emailPrefix}_${ts}@integrationtest.local`;
      const password = "TestPassword123!#";

      const { data: authUser, error: uErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (uErr || !authUser.user) throw new Error(`Create user ${emailPrefix} error: ` + uErr?.message);
      cleanupUserIds.push(authUser.user.id);

      // Create active organization member
      const { error: mErr } = await admin.from("organization_members").insert({
        organization_id: testOrgId,
        user_id: authUser.user.id,
        role,
        status: "active",
        department_id: deptId,
        designation: `${role.toUpperCase()} Test`,
        joined_at: new Date().toISOString(),
      });
      if (mErr) throw new Error(`Add member error for ${emailPrefix}: ` + mErr.message);

      // Sign in via client to get a real session JWT token
      const client = createClient(url, anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { data: sessionData, error: signErr } = await client.auth.signInWithPassword({
        email,
        password,
      });
      if (signErr || !sessionData.session) throw new Error(`Sign in error for ${emailPrefix}: ` + signErr?.message);

      return {
        id: authUser.user.id,
        email,
        token: sessionData.session.access_token,
        client,
      };
    };

    const managerA = await createTestUser("manager_a", "manager", deptAlpha.id);
    const staffA = await createTestUser("staff_a", "staff", deptAlpha.id);
    const staffB = await createTestUser("staff_b", "staff", deptBeta.id);

    // -------------------------------------------------------------
    // SETUP: Test Procedures and Versions
    // -------------------------------------------------------------
    console.log("3. Creating test procedures in live database...");
    const { data: proc1, error: p1Err } = await admin
      .from("procedures")
      .insert({
        organization_id: testOrgId,
        title: `Standard Operating Procedure ${ts}`,
        status: "active",
        priority: "medium",
        department_id: deptAlpha.id,
        acknowledgment_required: true,
        acknowledgment_audience: "staff", // Staff only!
        created_by: managerA.id,
      })
      .select()
      .single();
    if (p1Err || !proc1) throw new Error("Failed to create proc1: " + p1Err?.message);

    // Create v1
    const { data: v1, error: v1Err } = await admin
      .from("procedure_versions")
      .insert({
        procedure_id: proc1.id,
        organization_id: testOrgId,
        version_number: 1,
        title: proc1.title,
        description: "Version 1 content",
        published_by: managerA.id,
      })
      .select()
      .single();
    if (v1Err || !v1) throw new Error("Failed to create v1: " + v1Err?.message);

    // Create v2
    const { data: v2, error: v2Err } = await admin
      .from("procedure_versions")
      .insert({
        procedure_id: proc1.id,
        organization_id: testOrgId,
        version_number: 2,
        title: proc1.title,
        description: "Version 2 updated content",
        published_by: managerA.id,
      })
      .select()
      .single();
    if (v2Err || !v2) throw new Error("Failed to create v2: " + v2Err?.message);

    // Set v2 as current
    await admin.from("procedures").update({ current_version_id: v2.id }).eq("id", proc1.id);

    console.log("   Setup complete. Running test cases...\n");

    let passedCount = 0;

    // -------------------------------------------------------------
    // TEST 1: Manager attempting to acknowledge staff-only procedure
    // -------------------------------------------------------------
    try {
      await acknowledgeProcedureCore(
        { organizationId: testOrgId, procedureId: proc1.id, versionId: v2.id },
        managerA.token
      );
      throw new Error("TEST 1 FAILED: Manager was allowed to acknowledge staff-only procedure!");
    } catch (err: any) {
      if (err.message.includes("only requires and accepts acknowledgments from staff")) {
        console.log("✅ PASS: 1. Manager acknowledging staff-only procedure rejected with Forbidden");
        passedCount++;
      } else {
        throw new Error("TEST 1 UNEXPECTED ERROR: " + err.message);
      }
    }

    // Verify database state: no acknowledgment row created
    const { count: countManagerAck } = await admin
      .from("acknowledgments")
      .select("*", { count: "exact", head: true })
      .eq("user_id", managerA.id);
    if (countManagerAck !== 0) throw new Error("Database state invalid: Acknowledgment record persisted for manager!");

    // -------------------------------------------------------------
    // TEST 2: Staff in another department attempting to acknowledge
    // -------------------------------------------------------------
    try {
      await acknowledgeProcedureCore(
        { organizationId: testOrgId, procedureId: proc1.id, versionId: v2.id },
        staffB.token
      );
      throw new Error("TEST 2 FAILED: Staff in outside department was allowed to acknowledge!");
    } catch (err: any) {
      if (
        err.message.includes("not in the assigned department") ||
        err.message.includes("Procedure not found")
      ) {
        console.log("✅ PASS: 2. Staff in another department rejected (enforced by RLS 'Procedure not found' and department check)");
        passedCount++;
      } else {
        throw new Error("TEST 2 UNEXPECTED ERROR: " + err.message);
      }
    }

    // -------------------------------------------------------------
    // TEST 3: Legitimate Staff A acknowledging outdated version (v1)
    // -------------------------------------------------------------
    try {
      await acknowledgeProcedureCore(
        { organizationId: testOrgId, procedureId: proc1.id, versionId: v1.id },
        staffA.token
      );
      throw new Error("TEST 3 FAILED: Outdated version was allowed to be acknowledged!");
    } catch (err: any) {
      if (err.message.includes("no longer the current version")) {
        console.log("✅ PASS: 3. Outdated version submission rejected with version mismatch error");
        passedCount++;
      } else {
        throw new Error("TEST 3 UNEXPECTED ERROR: " + err.message);
      }
    }

    // -------------------------------------------------------------
    // TEST 4: Legitimate Staff A acknowledging current version (v2)
    // -------------------------------------------------------------
    const resA = await acknowledgeProcedureCore(
      { organizationId: testOrgId, procedureId: proc1.id, versionId: v2.id },
      staffA.token
    );
    if (!resA?.success) throw new Error("TEST 4 FAILED: Legitimate acknowledgment failed: " + JSON.stringify(resA));

    // Verify database state: Exactly 1 acknowledgment record
    const { data: acksStaffA } = await admin
      .from("acknowledgments")
      .select("id, procedure_version_id, user_id, revoked_at")
      .eq("procedure_id", proc1.id)
      .eq("user_id", staffA.id);

    if (!acksStaffA || acksStaffA.length !== 1) {
      throw new Error(`TEST 4 FAILED: Expected 1 acknowledgment record in database, found ${acksStaffA?.length}`);
    }
    if (acksStaffA[0].procedure_version_id !== v2.id) {
      throw new Error("TEST 4 FAILED: Acknowledged version ID mismatch!");
    }

    // Verify database state: Exactly 1 audit log record
    const { data: auditStaffA } = await admin
      .from("audit_logs")
      .select("id, event_type, entity_id")
      .eq("organization_id", testOrgId)
      .eq("actor_id", staffA.id)
      .eq("event_type", "acknowledgment_created");

    if (!auditStaffA || auditStaffA.length !== 1) {
      throw new Error(`TEST 4 FAILED: Expected 1 audit log in database, found ${auditStaffA?.length}`);
    }

    console.log("✅ PASS: 4. Legitimate staff acknowledgment succeeded and persisted exactly 1 record & audit log");
    passedCount++;

    // -------------------------------------------------------------
    // TEST 5: Duplicate acknowledgment submission (Idempotency)
    // -------------------------------------------------------------
    const resDuplicate = await acknowledgeProcedureCore(
      { organizationId: testOrgId, procedureId: proc1.id, versionId: v2.id },
      staffA.token
    );
    if (!resDuplicate?.success) {
      throw new Error("TEST 5 FAILED: Duplicate submission did not return success!");
    }

    // Verify database state: STILL exactly 1 acknowledgment record (no duplicates)
    const { data: acksStaffADup } = await admin
      .from("acknowledgments")
      .select("id")
      .eq("procedure_id", proc1.id)
      .eq("user_id", staffA.id);

    if (!acksStaffADup || acksStaffADup.length !== 1) {
      throw new Error(`TEST 5 FAILED: Duplicate submission created extra record! Count: ${acksStaffADup?.length}`);
    }

    // Verify database state: STILL exactly 1 audit log record (no spurious duplicate log)
    const { data: auditStaffADup } = await admin
      .from("audit_logs")
      .select("id")
      .eq("organization_id", testOrgId)
      .eq("actor_id", staffA.id)
      .eq("event_type", "acknowledgment_created");

    if (!auditStaffADup || auditStaffADup.length !== 1) {
      throw new Error(`TEST 5 FAILED: Duplicate submission created extra audit log! Count: ${auditStaffADup?.length}`);
    }

    console.log("✅ PASS: 5. Duplicate submission is idempotent: 1 acknowledgment, 1 audit log, zero spurious rows");
    passedCount++;

    // -------------------------------------------------------------
    // TEST 6: Direct SQL RPC Execution via authenticated user client
    // -------------------------------------------------------------
    const staffClient = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${staffA.token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: rpcDirectRes, error: rpcDirectErr } = await staffClient.rpc("atomic_acknowledge_procedure", {
      _proc_id: proc1.id,
      _ver_id: v2.id,
      _org_id: testOrgId,
    });

    if (rpcDirectErr) throw new Error("TEST 6 FAILED: Direct RPC error: " + rpcDirectErr.message);
    if (rpcDirectRes !== true) throw new Error("TEST 6 FAILED: Direct RPC did not return true!");

    console.log("✅ PASS: 6. Direct execution of atomic_acknowledge_procedure RPC succeeds with authenticated user token");
    passedCount++;

    // -------------------------------------------------------------
    // TEST 7: Manager acknowledging all_active_members procedure
    // -------------------------------------------------------------
    const { data: proc2, error: p2Err } = await admin
      .from("procedures")
      .insert({
        organization_id: testOrgId,
        title: `Company-wide Policy ${ts}`,
        status: "active",
        priority: "high",
        department_id: deptAlpha.id,
        acknowledgment_required: true,
        acknowledgment_audience: "all_active_members", // Open to all active roles
        created_by: managerA.id,
      })
      .select()
      .single();
    if (p2Err || !proc2) throw new Error("Failed to create proc2: " + p2Err?.message);

    const { data: v3 } = await admin
      .from("procedure_versions")
      .insert({
        procedure_id: proc2.id,
        organization_id: testOrgId,
        version_number: 1,
        title: proc2.title,
        description: "Company policy content",
        published_by: managerA.id,
      })
      .select()
      .single();

    await admin.from("procedures").update({ current_version_id: v3.id }).eq("id", proc2.id);

    const resManager = await acknowledgeProcedureCore(
      { organizationId: testOrgId, procedureId: proc2.id, versionId: v3.id },
      managerA.token
    );
    if (!resManager?.success) throw new Error("TEST 7 FAILED: Manager acknowledgment on policy failed!");

    const { count: managerAckCount } = await admin
      .from("acknowledgments")
      .select("*", { count: "exact", head: true })
      .eq("procedure_id", proc2.id)
      .eq("user_id", managerA.id);

    if (managerAckCount !== 1) throw new Error("TEST 7 FAILED: Manager acknowledgment not recorded!");

    console.log("✅ PASS: 7. Manager acknowledging all_active_members procedure in their department succeeds");
    passedCount++;

    console.log("\n==================================================================");
    console.log(`REAL INTEGRATION TEST RESULTS: ${passedCount} passed, 0 failed.`);
    console.log("All real database constraints, RPC, and server auth verified.");
    console.log("==================================================================");

  } catch (testError) {
    console.error("TEST FAILED WITH ERROR:", testError);
    throw testError;
  } finally {
    // -------------------------------------------------------------
    // TEARDOWN: Clean up test fixtures from live database
    // -------------------------------------------------------------
    console.log("\nCleaning up test users and organization from live database...");
    for (const uid of cleanupUserIds) {
      try {
        await admin.auth.admin.deleteUser(uid);
      } catch (e) {}
    }
    if (testOrgId) {
      try {
        await admin.from("organizations").delete().eq("id", testOrgId);
      } catch (e) {}
    }
    console.log("Cleanup complete.");
  }
}

runLiveIntegrationTests().catch((err) => {
  console.error("FATAL INTEGRATION ERROR:", err);
  process.exit(1);
});
