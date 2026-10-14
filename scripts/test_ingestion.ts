import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const adminClient = createClient(supabaseUrl, supabaseKey);

async function runAdversarialTests() {
  console.log("== Starting Phase 3 Adversarial Ingestion Tests ==\n");

  try {
    const adminEmail = `admin_${Date.now()}@test.com`;
    const { data: adminUser } = await adminClient.auth.admin.createUser({
      email: adminEmail,
      password: "password123",
      email_confirm: true,
    });

    const testOrgName = "testorg-" + Date.now().toString();
    const { data: orgA, error: errA } = await adminClient
      .from("organizations")
      .insert({
        name: testOrgName,
        slug: testOrgName,
        status: "active",
        created_by: adminUser.user.id,
      })
      .select()
      .single();
    if (errA) throw new Error("Failed to setup orgA: " + errA.message);
    const orgAId = orgA.id;

    const { data: orgB, error: errB } = await adminClient
      .from("organizations")
      .insert({
        name: testOrgName + "-b",
        slug: testOrgName + "-b",
        status: "active",
        created_by: adminUser.user.id,
      })
      .select()
      .single();
    if (errB) throw new Error("Failed to setup orgB: " + errB.message);
    const orgBId = orgB.id;

    await adminClient.from("organization_members").insert({
      organization_id: orgAId,
      user_id: adminUser.user.id,
      role: "admin",
      status: "active",
    });
    await adminClient.from("organization_members").insert({
      organization_id: orgBId,
      user_id: adminUser.user.id,
      role: "admin",
      status: "active",
    });

    const staffEmail = `staff_${Date.now()}@test.com`;
    const { data: staffUser } = await adminClient.auth.admin.createUser({
      email: staffEmail,
      password: "password123",
      email_confirm: true,
    });
    await adminClient.from("organization_members").insert({
      organization_id: orgAId,
      user_id: staffUser.user.id,
      role: "staff",
      status: "active",
    });

    console.log("Testing ingestion does not mutate procedures...");

    const { data: imp, error: err } = await adminClient
      .from("imports")
      .insert({
        organization_id: orgAId,
        created_by: adminUser.user.id,
        source_type: "teams",
      })
      .select("id")
      .single();
    if (err) throw err;
    const importId = imp.id;

    const { data: draft, error: derr } = await adminClient
      .from("import_drafts")
      .insert({
        import_id: importId,
        organization_id: orgAId,
        title: "Test Draft",
        description: "Test Desc",
        classification: "procedure",
        confidence: 90,
        priority: "medium",
        status: "pending",
      })
      .select("id")
      .single();
    if (derr) throw derr;

    const staffClient = createClient(supabaseUrl, process.env.SUPABASE_PUBLISHABLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await staffClient.auth.signInWithPassword({ email: staffEmail, password: "password123" });

    const { error: staffErr } = await staffClient.rpc("atomic_approve_draft", {
      _draft_id: draft.id,
      _org_id: orgAId,
      _title: "Title",
      _summary: "",
      _description: "Desc",
      _priority: "medium",
      _category_id: null,
      _effective_date: null,
      _expiry_date: null,
      _ack_required: false,
    });

    if (staffErr && staffErr.message.includes("Forbidden")) {
      console.log("[PASS] Staff cannot approve drafts");
    } else {
      console.error("[FAIL] Staff could approve draft", staffErr);
    }

    const adminAClient = createClient(supabaseUrl, process.env.SUPABASE_PUBLISHABLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await adminAClient.auth.signInWithPassword({ email: adminEmail, password: "password123" });

    const { error: tenantErr } = await adminAClient.rpc("atomic_approve_draft", {
      _draft_id: draft.id,
      _org_id: orgBId,
      _title: "Title",
      _summary: "",
      _description: "Desc",
      _priority: "medium",
      _category_id: null,
      _effective_date: null,
      _expiry_date: null,
      _ack_required: false,
    });

    if (tenantErr && tenantErr.message.includes("Tenant mismatch")) {
      console.log("[PASS] Tenant boundary enforced on approval");
    } else {
      console.error("[FAIL] Tenant boundary failed", tenantErr);
    }

    const { data: procId, error: okErr } = await adminAClient.rpc("atomic_approve_draft", {
      _draft_id: draft.id,
      _org_id: orgAId,
      _title: "Approved Title",
      _summary: "",
      _description: "Desc",
      _priority: "medium",
      _category_id: null,
      _effective_date: null,
      _expiry_date: null,
      _ack_required: false,
    });

    if (okErr) throw okErr;

    const { data: proc } = await adminAClient
      .from("procedures")
      .select("*")
      .eq("id", procId)
      .single();
    if (proc.status === "draft") {
      console.log("[PASS] Approval creates a draft procedure, NOT a published one");
    } else {
      console.error("[FAIL] Procedure was published immediately", proc.status);
    }

    const { error: reApproveErr } = await adminAClient.rpc("atomic_approve_draft", {
      _draft_id: draft.id,
      _org_id: orgAId,
      _title: "Approved Title 2",
      _summary: "",
      _description: "Desc",
      _priority: "medium",
      _category_id: null,
      _effective_date: null,
      _expiry_date: null,
      _ack_required: false,
    });

    if (reApproveErr && reApproveErr.message.includes("already approved")) {
      console.log("[PASS] Re-approval prevented");
    } else {
      console.error("[FAIL] Re-approval allowed", reApproveErr);
    }
  } catch (e) {
    console.error("Test error:", e);
  }

  process.exit(0);
}

runAdversarialTests();
