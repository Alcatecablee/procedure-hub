import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY!;

const adminClient = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function runTests() {
  console.log("== Starting Procedure Hub Adversarial Tests ==");

  const ts = Date.now();
  const emailA_admin = `adminA_${ts}@test.com`;
  const emailA_staff = `staffA_${ts}@test.com`;
  const emailB_admin = `adminB_${ts}@test.com`;

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
  const { data: bAdminUser } = await adminClient.auth.admin.createUser({
    email: emailB_admin,
    password: "password123",
    email_confirm: true,
  });

  const { data: orgA } = await adminClient
    .from("organizations")
    .insert({
      name: "Org A",
      slug: `org-a-${ts}`,
      status: "active",
      created_by: aAdminUser.user.id,
    })
    .select()
    .single();
  const { data: orgB } = await adminClient
    .from("organizations")
    .insert({
      name: "Org B",
      slug: `org-b-${ts}`,
      status: "active",
      created_by: bAdminUser.user.id,
    })
    .select()
    .single();

  await adminClient.from("organization_members").insert([
    { organization_id: orgA.id, user_id: aAdminUser.user.id, role: "admin", status: "active" },
    { organization_id: orgA.id, user_id: aStaffUser.user.id, role: "staff", status: "active" },
    { organization_id: orgB.id, user_id: bAdminUser.user.id, role: "admin", status: "active" },
  ]);

  const clientA_admin = createClient(url, anonKey, { auth: { persistSession: false } });
  await clientA_admin.auth.signInWithPassword({ email: emailA_admin, password: "password123" });

  const clientA_staff = createClient(url, anonKey, { auth: { persistSession: false } });
  await clientA_staff.auth.signInWithPassword({ email: emailA_staff, password: "password123" });

  const clientB_admin = createClient(url, anonKey, { auth: { persistSession: false } });
  await clientB_admin.auth.signInWithPassword({ email: emailB_admin, password: "password123" });

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

  // 1. Staff attempting direct mutation
  const { data: staffProc, error: staffErr } = await clientA_staff
    .from("procedures")
    .insert({
      organization_id: orgA.id,
      title: "Staff Proc",
      status: "draft",
    })
    .select();
  assert(
    staffErr && staffErr.code === "42501",
    "Staff attempting direct mutation (DB RLS rejects)",
  );

  // 2. Admin creating procedure
  const { data: proc1, error: adminErr } = await clientA_admin
    .from("procedures")
    .insert({
      organization_id: orgA.id,
      title: "Admin Proc",
      status: "draft",
    })
    .select()
    .single();
  assert(!adminErr && proc1, "Admin attempting direct mutation (DB RLS allows)");

  // 3. User from Org B attempting to read Org A procedure
  const { data: bReadsA } = await clientB_admin.from("procedures").select("*").eq("id", proc1.id);
  assert(bReadsA?.length === 0, "User from Org B attempting to read Org A procedure (RLS hides)");

  // 4. Forged organization_id
  const { data: forgedOrg, error: forgedErr } = await clientA_admin
    .from("procedures")
    .insert({
      organization_id: orgB.id,
      title: "Forged Org",
      status: "draft",
    })
    .select();
  assert(
    forgedErr && forgedErr.code === "42501",
    "Forged organization_id (DB RLS rejects inserting for another org)",
  );

  await adminClient.auth.admin.deleteUser(aAdminUser.user.id);
  await adminClient.auth.admin.deleteUser(aStaffUser.user.id);
  await adminClient.auth.admin.deleteUser(bAdminUser.user.id);
  await adminClient.from("organizations").delete().in("id", [orgA.id, orgB.id]);
  console.log(`\nTests finished: ${testsPassed} Passed, ${testsFailed} Failed`);
}

runTests().catch(console.error);
