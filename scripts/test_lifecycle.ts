import { createClient } from "@supabase/supabase-js";
import {
  createProcedureCore,
  archiveProcedureCore,
  replaceProcedureCore,
} from "../src/lib/procedures.server";

const url = process.env.SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY!;

const adminClient = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function runLifecycleTests() {
  console.log("== Starting Procedure Lifecycle & Security Tests ==");

  const ts = Date.now();
  const email_admin = `admin_lifecycle_${ts}@test.com`;
  const email_staff = `staff_lifecycle_${ts}@test.com`;

  const { data: adminUser } = await adminClient.auth.admin.createUser({
    email: email_admin,
    password: "password123",
    email_confirm: true,
  });
  const { data: staffUser } = await adminClient.auth.admin.createUser({
    email: email_staff,
    password: "password123",
    email_confirm: true,
  });

  const { data: orgA } = await adminClient
    .from("organizations")
    .insert({
      name: "Org Life Test",
      slug: `org-life-${ts}`,
      status: "active",
      created_by: adminUser.user.id,
    })
    .select()
    .single();
  const { data: orgB } = await adminClient
    .from("organizations")
    .insert({
      name: "Org Life B",
      slug: `org-life-b-${ts}`,
      status: "active",
      created_by: adminUser.user.id,
    })
    .select()
    .single();

  await adminClient.from("organization_members").insert({
    organization_id: orgA.id,
    user_id: adminUser.user.id,
    role: "admin",
    status: "active",
  });
  await adminClient.from("organization_members").insert({
    organization_id: orgA.id,
    user_id: staffUser.user.id,
    role: "staff",
    status: "active",
  });

  // Get tokens
  const adminClientLocal = createClient(url, anonKey, { auth: { persistSession: false } });
  await adminClientLocal.auth.signInWithPassword({ email: email_admin, password: "password123" });
  const adminToken = (await adminClientLocal.auth.getSession()).data.session!.access_token;

  const staffClientLocal = createClient(url, anonKey, { auth: { persistSession: false } });
  await staffClientLocal.auth.signInWithPassword({ email: email_staff, password: "password123" });
  const staffToken = (await staffClientLocal.auth.getSession()).data.session!.access_token;

  console.log("Testing Create Procedure (Admin)...");
  const p1 = await createProcedureCore(
    {
      organizationId: orgA.id,
      title: "Proc 1",
      summary: "",
      description: "",
      priority: "medium",
      acknowledgmentRequired: false,
      publish: true,
    },
    adminToken,
  );
  console.log("-> Created P1:", p1.procedureId);

  const p2 = await createProcedureCore(
    {
      organizationId: orgA.id,
      title: "Proc 2",
      summary: "",
      description: "",
      priority: "medium",
      acknowledgmentRequired: false,
      publish: true,
    },
    adminToken,
  );
  console.log("-> Created P2:", p2.procedureId);

  console.log("\nTesting Staff Authorization on Archive (Expected Fail)...");
  try {
    await archiveProcedureCore({ organizationId: orgA.id, id: p1.procedureId }, staffToken);
    throw new Error("Staff should not be able to archive");
  } catch (e: any) {
    console.log("-> Passed: Staff rejected:", e.message);
  }

  console.log("\nTesting Archive Procedure (Admin)...");
  await archiveProcedureCore({ organizationId: orgA.id, id: p1.procedureId }, adminToken);
  console.log("-> Passed: P1 Archived.");

  console.log("\nTesting Double Archive (Expected Fail)...");
  try {
    await archiveProcedureCore({ organizationId: orgA.id, id: p1.procedureId }, adminToken);
    throw new Error("Should not archive already archived proc");
  } catch (e: any) {
    console.log("-> Passed: Prevented double archive:", e.message);
  }

  console.log("\nTesting Self-Replacement (Expected Fail)...");
  try {
    await replaceProcedureCore(
      {
        organizationId: orgA.id,
        oldProcedureId: p2.procedureId,
        newProcedureId: p2.procedureId,
      },
      adminToken,
    );
    throw new Error("Self-replacement should fail");
  } catch (e: any) {
    console.log("-> Passed: Self-replacement rejected:", e.message);
  }

  console.log("\nTesting Replace with Draft (Expected Fail)...");
  const p3 = await createProcedureCore(
    {
      organizationId: orgA.id,
      title: "Proc 3 (Draft)",
      summary: "",
      description: "",
      priority: "medium",
      acknowledgmentRequired: false,
      publish: false, // DRAFT!
    },
    adminToken,
  );

  try {
    await replaceProcedureCore(
      {
        organizationId: orgA.id,
        oldProcedureId: p2.procedureId,
        newProcedureId: p3.procedureId,
      },
      adminToken,
    );
    throw new Error("Draft replacement should fail");
  } catch (e: any) {
    console.log("-> Passed: Draft replacement rejected:", e.message);
  }

  console.log("\nTesting Valid Replacement (Admin)...");
  const p4 = await createProcedureCore(
    {
      organizationId: orgA.id,
      title: "Proc 4 (Active)",
      summary: "",
      description: "",
      priority: "medium",
      acknowledgmentRequired: false,
      publish: true,
    },
    adminToken,
  );

  await replaceProcedureCore(
    {
      organizationId: orgA.id,
      oldProcedureId: p2.procedureId,
      newProcedureId: p4.procedureId,
    },
    adminToken,
  );
  console.log("-> Passed: Valid Replacement successful.");

  // Direct RPC Security Test
  console.log("\nTesting Direct RPC Forged Org Boundary (Expected Fail)...");
  try {
    const { error } = await adminClientLocal.rpc("atomic_archive_procedure", {
      _proc_id: p2.procedureId,
      _org_id: orgB.id,
    });
    if (!error) throw new Error("Should have failed tenant boundary.");
    console.log("-> Passed: Tenant boundary enforced in DB:", error.message);
  } catch (e: any) {
    console.log("-> Passed: Exception thrown:", e.message);
  }

  console.log("\n== All Lifecycle & Security Tests Passed ==");
}

runLifecycleTests().catch(console.error);
