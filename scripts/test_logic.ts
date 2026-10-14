import { createClient } from "@supabase/supabase-js";
import {
  createProcedureCore,
  updateProcedureCore,
  acknowledgeProcedureCore,
} from "../src/lib/procedures.server";

const url = process.env.SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY!;

const adminClient = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function runLogicTests() {
  console.log("== Starting Procedure Hub Server Function Logic Tests ==");

  const ts = Date.now();
  const emailA_admin = `adminA_${ts}@test.com`;
  const emailA_staff = `staffA_${ts}@test.com`;

  const { data: aAdminUser } = await adminClient.auth.admin.createUser({
    email: emailA_admin,
    password: "password123",
    email_confirm: true,
  });
  const { data: aStaffUser } = await adminClient.auth.admin.createUser({
    email: emailA_staff,
    password: "password123",
    email_confirm: true,
  });

  const { data: orgA } = await adminClient
    .from("organizations")
    .insert({
      name: "Org Logic Test",
      slug: `org-logic-${ts}`,
      status: "active",
      created_by: aAdminUser.user.id,
    })
    .select()
    .single();

  await adminClient.from("organization_members").insert([
    { organization_id: orgA.id, user_id: aAdminUser.user.id, role: "admin", status: "active" },
    { organization_id: orgA.id, user_id: aStaffUser.user.id, role: "staff", status: "active" },
  ]);

  const clientA_admin = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data: sessionAdmin } = await clientA_admin.auth.signInWithPassword({
    email: emailA_admin,
    password: "password123",
  });
  const tokenAdmin = sessionAdmin.session!.access_token;

  const clientA_staff = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data: sessionStaff } = await clientA_staff.auth.signInWithPassword({
    email: emailA_staff,
    password: "password123",
  });
  const tokenStaff = sessionStaff.session!.access_token;

  let testsPassed = 0;
  let testsFailed = 0;
  function assert(condition: boolean, msg: string) {
    if (condition) {
      console.log(`[PASS] ${msg}`);
      testsPassed++;
    } else {
      console.error(`[FAIL] ${msg}`);
      testsFailed++;
    }
  }

  // Helper to fetch audit count
  async function getAuditCount(entityId: string, eventType: string) {
    const { count } = await adminClient
      .from("audit_logs")
      .select("*", { count: "exact", head: true })
      .eq("entity_id", entityId)
      .eq("event_type", eventType);
    return count || 0;
  }

  // 1. Invalid Dates
  try {
    await createProcedureCore(
      {
        organizationId: orgA.id,
        title: "Date Test",
        summary: "",
        description: "",
        priority: "medium",
        acknowledgmentRequired: false,
        effectiveDate: "2026-10-01",
        expiryDate: "2026-09-01",
        publish: false,
      },
      tokenAdmin,
    );
    assert(false, "Invalid dates (Effective >= Expiry) should throw");
  } catch (e: any) {
    assert(
      e.message.includes("Effective date must be before expiry date"),
      "Invalid dates (Effective >= Expiry) rejected correctly",
    );
  }

  // 2. Create Procedure (publish = false)
  const procRes = await createProcedureCore(
    {
      organizationId: orgA.id,
      title: "Test Procedure 1",
      summary: "",
      description: "",
      priority: "medium",
      acknowledgmentRequired: false,
      publish: false,
    },
    tokenAdmin,
  );
  const procId = procRes.procedureId;
  assert(!!procId, "Procedure created as draft");

  const createdAudit = await getAuditCount(procId, "procedure_created");
  assert(createdAudit === 1, "Audit log 'procedure_created' fired exactly once");

  // 3. Update Procedure to Publish (Version 1)
  const upRes1 = await updateProcedureCore(
    {
      id: procId,
      organizationId: orgA.id,
      title: "Test Procedure 1",
      summary: "",
      description: "",
      priority: "medium",
      expectedVersion: 0,
      publish: true,
      acknowledgmentRequired: true,
    },
    tokenAdmin,
  );
  assert(upRes1.published === true, "Procedure published to Version 1");

  const { data: procV1 } = await adminClient
    .from("procedures")
    .select("current_version_id, version_number")
    .eq("id", procId)
    .single();
  const v1Id = procV1.current_version_id;

  const pubAudit1 =
    (await getAuditCount(procId, "procedure_published")) +
    (await getAuditCount(v1Id, "procedure_published"));
  assert(pubAudit1 === 1, "Audit log 'procedure_published' fired exactly once");

  // 4. Double Acknowledgment & Successful Ack
  await acknowledgeProcedureCore(
    { procedureId: procId, versionId: v1Id, organizationId: orgA.id },
    tokenStaff,
  );
  const ackAudit = await getAuditCount(v1Id, "acknowledgment_created");
  assert(ackAudit === 1, "Staff acknowledged successfully, audit log created");

  try {
    const res = await acknowledgeProcedureCore(
      { procedureId: procId, versionId: v1Id, organizationId: orgA.id },
      tokenStaff,
    );
    assert(
      res.success === true,
      "Double acknowledgment handled safely/idempotently without throwing",
    );
  } catch (e: any) {
    assert(false, "Double acknowledgment threw an unexpected error: " + e.message);
  }
  const ackAudit2 = await getAuditCount(v1Id, "acknowledgment_created");
  assert(ackAudit2 === 1, "Duplicate acknowledgment did NOT create duplicate audit log");

  // 5. No-op Revision
  const noopRes = await updateProcedureCore(
    {
      id: procId,
      organizationId: orgA.id,
      title: "Test Procedure 1",
      summary: "",
      description: "",
      priority: "medium",
      expectedVersion: 1,
      publish: true,
      acknowledgmentRequired: true,
    },
    tokenAdmin,
  );
  assert(noopRes.skipped === true, "No-op revision correctly skipped incrementing version");

  // 6. Concurrent Edits
  try {
    await updateProcedureCore(
      {
        id: procId,
        organizationId: orgA.id,
        title: "Test Procedure Updated A",
        summary: "",
        description: "",
        priority: "medium",
        expectedVersion: 0,
        publish: true,
        acknowledgmentRequired: true,
      },
      tokenAdmin,
    );
    assert(false, "Concurrent edit should throw");
  } catch (e: any) {
    assert(
      e.message.includes("Conflict"),
      "Concurrent edit correctly rejected due to expectedVersion mismatch",
    );
  }

  // 7. Update to Version 2
  const upRes2 = await updateProcedureCore(
    {
      id: procId,
      organizationId: orgA.id,
      title: "Test Procedure Updated B",
      summary: "",
      description: "",
      priority: "high",
      expectedVersion: 1,
      publish: true,
      acknowledgmentRequired: true,
    },
    tokenAdmin,
  );

  const { data: procV2 } = await adminClient
    .from("procedures")
    .select("current_version_id, version_number")
    .eq("id", procId)
    .single();
  const v2Id = procV2.current_version_id;
  assert(procV2.version_number === 2, "Version incremented to 2");

  // 8. Acknowledge Old Version
  try {
    await acknowledgeProcedureCore(
      { procedureId: procId, versionId: v1Id, organizationId: orgA.id },
      tokenStaff,
    );
    assert(false, "Acknowledging stale version should fail");
  } catch (e: any) {
    assert(
      e.message.includes("no longer the current version"),
      "Stale acknowledgment rejected correctly",
    );
  }

  // Cleanup
  await adminClient.auth.admin.deleteUser(aAdminUser.user.id);
  await adminClient.auth.admin.deleteUser(aStaffUser.user.id);
  await adminClient.from("organizations").delete().eq("id", orgA.id);

  console.log(`\nTests finished: ${testsPassed} Passed, ${testsFailed} Failed`);
}

runLogicTests().catch(console.error);
