import * as fs from "fs";
import * as path from "path";
import { createClient } from "@supabase/supabase-js";

// Load .env before importing server modules
const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8");
  for (const line of envContent.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

import { completeMemberOnboardingCore } from "../src/lib/organization.server";
import { updateMemberRoleCore, getTeamMembersCore } from "../src/lib/team.server";
import { computeNeedsMemberOnboarding } from "../src/lib/auth";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_PUBLISHABLE_KEY!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_KEY) {
  console.error("Missing required Supabase environment variables.");
  process.exit(1);
}

const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

interface TestResult {
  scenario: string;
  passed: boolean;
  details: string;
}

const results: TestResult[] = [];

function record(scenario: string, passed: boolean, details: string) {
  results.push({ scenario, passed, details });
  const icon = passed ? "✅ PASS" : "❌ FAIL";
  console.log(`${icon}: ${scenario} — ${details}`);
}

async function createTempUser(prefix: string): Promise<{
  id: string;
  email: string;
  token: string;
}> {
  const email = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@procedurehub-onboarding-test.local`;
  const password = "TestPassword!23456";

  const { data: created, error: createErr } = await svc.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: `Initial ${prefix}` },
  });
  if (createErr || !created.user) {
    throw new Error(`Failed to create temp user ${prefix}: ${createErr?.message}`);
  }

  const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: signInData, error: signInErr } = await anonClient.auth.signInWithPassword({
    email,
    password,
  });
  if (signInErr || !signInData.session) {
    throw new Error(`Failed to sign in temp user ${prefix}: ${signInErr?.message}`);
  }

  return {
    id: created.user.id,
    email,
    token: signInData.session.access_token,
  };
}

function getAuthenticatedClient(token: string) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function main() {
  console.log(
    "=== Running Live Supabase Transactional Member Onboarding Suite (RPC + Server Core) ===\n"
  );

  // Pre-flight check: verify migration 20261016000002_member_onboarding_governance.sql is applied
  const colCheck = await svc
    .from("organization_members")
    .select("id, onboarded_at, requested_department_id")
    .limit(1);

  if (colCheck.error) {
    console.error(
      `❌ PRE-FLIGHT FAILED: Live database does not yet have 'onboarded_at' / 'requested_department_id' on organization_members: ${colCheck.error.message}`
    );
    console.error(
      "Please apply supabase/migrations/20261016000002_member_onboarding_governance.sql in the Supabase Dashboard SQL Editor."
    );
    process.exit(1);
  }

  const createdUserIds: string[] = [];
  const createdOrgIds: string[] = [];

  try {
    // 1. Provision isolated test users (Owner A, Admin A, Staff A, Owner B)
    const ownerA = await createTempUser("owner_org_a");
    createdUserIds.push(ownerA.id);

    const adminA = await createTempUser("admin_org_a");
    createdUserIds.push(adminA.id);

    const staffA = await createTempUser("staff_org_a");
    createdUserIds.push(staffA.id);

    const ownerB = await createTempUser("owner_org_b");
    createdUserIds.push(ownerB.id);

    const ts = Date.now();

    // 2. Create Org A and Org B
    const { data: orgA, error: orgAErr } = await svc
      .from("organizations")
      .insert({
        name: `Onboarding RPC Org A ${ts}`,
        slug: `onboard-rpc-a-${ts}`,
        created_by: ownerA.id,
        status: "active",
      })
      .select("*")
      .single();
    if (orgAErr || !orgA) throw new Error(`Failed to create Org A: ${orgAErr?.message}`);
    createdOrgIds.push(orgA.id);

    const { data: orgB, error: orgBErr } = await svc
      .from("organizations")
      .insert({
        name: `Onboarding RPC Org B ${ts}`,
        slug: `onboard-rpc-b-${ts}`,
        created_by: ownerB.id,
        status: "active",
      })
      .select("*")
      .single();
    if (orgBErr || !orgB) throw new Error(`Failed to create Org B: ${orgBErr?.message}`);
    createdOrgIds.push(orgB.id);

    // 3. Create Departments in Org A (Customer Support & Compliance) and Org B (External Dept)
    const { data: deptSupport, error: d1Err } = await svc
      .from("departments")
      .insert({ organization_id: orgA.id, name: "Customer Support" })
      .select("id, name")
      .single();
    if (d1Err || !deptSupport) throw new Error(`Failed to create deptSupport: ${d1Err?.message}`);

    const { data: deptCompliance, error: d2Err } = await svc
      .from("departments")
      .insert({ organization_id: orgA.id, name: "Compliance" })
      .select("id, name")
      .single();
    if (d2Err || !deptCompliance)
      throw new Error(`Failed to create deptCompliance: ${d2Err?.message}`);

    const { data: deptOrgB, error: dBErr } = await svc
      .from("departments")
      .insert({ organization_id: orgB.id, name: "Org B Secret Dept" })
      .select("id, name")
      .single();
    if (dBErr || !deptOrgB) throw new Error(`Failed to create deptOrgB: ${dBErr?.message}`);

    // 4. Add memberships:
    // - ownerA is owner of Org A
    // - adminA is admin of Org A (with onboarded_at: null to test role rejection inside SQL function)
    // - staffA is active staff in Org A with a pre-filled designation ("Pre-Invited Agent") but NO department and onboarded_at: null
    const { error: mOwnerErr } = await svc.from("organization_members").insert({
      organization_id: orgA.id,
      user_id: ownerA.id,
      role: "owner",
      status: "active",
      onboarded_at: new Date().toISOString(),
      joined_at: new Date().toISOString(),
    });
    if (mOwnerErr) throw new Error(`Failed to insert ownerA membership: ${mOwnerErr.message}`);

    const { error: mAdminErr } = await svc.from("organization_members").insert({
      organization_id: orgA.id,
      user_id: adminA.id,
      role: "admin",
      status: "active",
      onboarded_at: null,
      joined_at: new Date().toISOString(),
    });
    if (mAdminErr) throw new Error(`Failed to insert adminA membership: ${mAdminErr.message}`);

    const { data: staffMemberRow, error: mStaffErr } = await svc
      .from("organization_members")
      .insert({
        organization_id: orgA.id,
        user_id: staffA.id,
        role: "staff",
        designation: "Pre-Invited Agent",
        department_id: null,
        requested_department_id: null,
        onboarded_at: null,
        status: "active",
        joined_at: new Date().toISOString(),
      })
      .select("*")
      .single();
    if (mStaffErr || !staffMemberRow) {
      throw new Error(`Failed to insert staffA membership: ${mStaffErr?.message}`);
    }

    // -------------------------------------------------------------------------
    // SCENARIO 1: Authoritative partial onboarding detection (organization_members.onboarded_at)
    // -------------------------------------------------------------------------
    const needsWithDesigNoDept = computeNeedsMemberOnboarding({
      role: "staff",
      departmentId: null,
      designation: "Pre-Invited Agent",
      onboardedAt: null,
    });

    const needsWithDeptNoDesig = computeNeedsMemberOnboarding({
      role: "staff",
      departmentId: deptSupport.id,
      designation: null,
      onboardedAt: null,
    });

    const needsAfterOnboardedAtSet = computeNeedsMemberOnboarding({
      role: "staff",
      departmentId: null,
      designation: "Call Center Consultant",
      onboardedAt: new Date().toISOString(),
    });

    const needsForOwner = computeNeedsMemberOnboarding({
      role: "owner",
      departmentId: null,
      designation: null,
      onboardedAt: null,
    });

    record(
      "Scenario 1: Authoritative onboarding state detection via organization_members.onboarded_at",
      needsWithDesigNoDept === true &&
        needsWithDeptNoDesig === true &&
        needsAfterOnboardedAtSet === false &&
        needsForOwner === false,
      `desigOnly=${needsWithDesigNoDept}, deptOnly=${needsWithDeptNoDesig}, onboardedAtSet=${needsAfterOnboardedAtSet}, owner=${needsForOwner}`
    );

    // -------------------------------------------------------------------------
    // SCENARIO 2: Direct SQL RPC grant & role enforcement (anon, owner, and admin rejected)
    // -------------------------------------------------------------------------
    const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: anonRpcErr } = await anonClient.rpc("atomic_complete_member_onboarding", {
      _full_name: "Anon Caller",
      _designation: "Hacker",
      _is_global: true,
    });

    const ownerClient = getAuthenticatedClient(ownerA.token);
    const { error: ownerRpcErr } = await ownerClient.rpc("atomic_complete_member_onboarding", {
      _full_name: "Owner Caller",
      _designation: "CEO",
      _is_global: true,
    });

    const adminClient = getAuthenticatedClient(adminA.token);
    const { error: adminRpcErr } = await adminClient.rpc("atomic_complete_member_onboarding", {
      _full_name: "Admin Caller",
      _designation: "Director",
      _is_global: true,
    });

    const roleAndGrantPassed =
      Boolean(anonRpcErr) &&
      Boolean(ownerRpcErr?.message.includes("Forbidden: Owners and administrators")) &&
      Boolean(adminRpcErr?.message.includes("Forbidden: Owners and administrators"));

    record(
      "Scenario 2: Direct SQL RPC enforces execute grants (blocks anon) and rejects owner/admin roles",
      roleAndGrantPassed,
      `anonErr="${anonRpcErr?.message}", ownerErr="${ownerRpcErr?.message}", adminErr="${adminRpcErr?.message}"`
    );

    // -------------------------------------------------------------------------
    // SCENARIO 3: Cross-organization department request rejected by SQL function before any write
    // -------------------------------------------------------------------------
    let crossOrgError = "";
    try {
      await completeMemberOnboardingCore(
        {
          fullName: "Should Not Persist Name",
          designation: "Should Not Persist Designation",
          requestedDepartmentId: deptOrgB.id,
        },
        staffA.token
      );
    } catch (err: any) {
      crossOrgError = err?.message || String(err);
    }

    const { data: afterCrossOrgMember } = await svc
      .from("organization_members")
      .select("designation, department_id, requested_department_id, onboarded_at")
      .eq("id", staffMemberRow.id)
      .single();
    const { data: afterCrossOrgProfile } = await svc
      .from("profiles")
      .select("full_name")
      .eq("id", staffA.id)
      .single();

    const crossOrgRejectedCleanly =
      crossOrgError.includes("Forbidden: Selected department does not exist in your organization") &&
      afterCrossOrgMember?.designation === "Pre-Invited Agent" &&
      afterCrossOrgMember?.department_id === null &&
      afterCrossOrgMember?.requested_department_id === null &&
      afterCrossOrgMember?.onboarded_at === null &&
      afterCrossOrgProfile?.full_name === "Initial staff_org_a";

    record(
      "Scenario 3: Cross-organization department request rejected by SQL function with zero writes",
      crossOrgRejectedCleanly,
      `error="${crossOrgError}", designation="${afterCrossOrgMember?.designation}", onboarded_at=${afterCrossOrgMember?.onboarded_at}`
    );

    // -------------------------------------------------------------------------
    // SCENARIO 4: Audit insertion failure inside SQL function rolls back entire PostgreSQL transaction
    // -------------------------------------------------------------------------
    let auditFailError = "";
    try {
      await completeMemberOnboardingCore(
        {
          fullName: "Rolled Back Name",
          designation: "Rolled Back Designation",
          requestedDepartmentId: deptSupport.id,
        },
        staffA.token,
        { _forceAuditEventTypeForTest: "member_onboarded" } // invalid enum value inside SQL transaction
      );
    } catch (err: any) {
      auditFailError = err?.message || String(err);
    }

    const { data: afterAuditFailMember } = await svc
      .from("organization_members")
      .select("designation, department_id, requested_department_id, onboarded_at")
      .eq("id", staffMemberRow.id)
      .single();
    const { data: afterAuditFailProfile } = await svc
      .from("profiles")
      .select("full_name")
      .eq("id", staffA.id)
      .single();
    const { data: afterAuditFailLogs } = await svc
      .from("audit_logs")
      .select("id")
      .eq("organization_id", orgA.id)
      .eq("entity_id", staffMemberRow.id);

    const auditRollbackVerified =
      auditFailError.includes("invalid input value for enum") &&
      afterAuditFailMember?.designation === "Pre-Invited Agent" &&
      afterAuditFailMember?.department_id === null &&
      afterAuditFailMember?.requested_department_id === null &&
      afterAuditFailMember?.onboarded_at === null &&
      afterAuditFailProfile?.full_name === "Initial staff_org_a" &&
      (afterAuditFailLogs?.length ?? 0) === 0;

    record(
      "Scenario 4: Audit failure inside atomic_complete_member_onboarding rolls back profile, membership, and onboarded_at atomically",
      auditRollbackVerified,
      `error="${auditFailError}", designation="${afterAuditFailMember?.designation}", full_name="${afterAuditFailProfile?.full_name}", onboarded_at=${afterAuditFailMember?.onboarded_at}, auditRows=${afterAuditFailLogs?.length ?? 0}`
    );

    // -------------------------------------------------------------------------
    // SCENARIO 5: Concurrent & repeated onboarding attempts (FOR UPDATE row lock + authoritative state)
    // -------------------------------------------------------------------------
    const staffClient = getAuthenticatedClient(staffA.token);

    // Fire two concurrent onboarding requests for the same member simultaneously:
    // Call 1 via completeMemberOnboardingCore (requesting Customer Support)
    // Call 2 via direct RPC (attempting to request Compliance concurrently)
    const concurrentOutcomes = await Promise.allSettled([
      completeMemberOnboardingCore(
        {
          fullName: "Zinhle Mokoena",
          designation: "Call Center Consultant",
          requestedDepartmentId: deptSupport.id,
        },
        staffA.token
      ),
      staffClient
        .rpc("atomic_complete_member_onboarding", {
          _full_name: "Zinhle Mokoena",
          _designation: "Call Center Consultant",
          _requested_department_id: deptCompliance.id,
          _is_global: false,
        })
        .then(({ data, error }) => {
          if (error) throw new Error(error.message);
          return data;
        }),
    ]);

    const fulfilledCount = concurrentOutcomes.filter((o) => o.status === "fulfilled").length;
    const rejectedOutcomes = concurrentOutcomes.filter(
      (o): o is PromiseRejectedResult => o.status === "rejected"
    );

    // Also attempt a subsequent sequential repeat call
    let sequentialRepeatError = "";
    try {
      await completeMemberOnboardingCore(
        {
          fullName: "Zinhle Mokoena",
          designation: "Compliance Officer",
          requestedDepartmentId: deptCompliance.id,
        },
        staffA.token
      );
    } catch (err: any) {
      sequentialRepeatError = err?.message || String(err);
    }

    const { data: afterOnboardMember } = await svc
      .from("organization_members")
      .select("designation, department_id, requested_department_id, onboarded_at")
      .eq("id", staffMemberRow.id)
      .single();
    const { data: afterOnboardProfile } = await svc
      .from("profiles")
      .select("full_name")
      .eq("id", staffA.id)
      .single();
    const { data: onboardingAudits } = await svc
      .from("audit_logs")
      .select("id, event_type, metadata")
      .eq("organization_id", orgA.id)
      .eq("entity_id", staffMemberRow.id)
      .eq("event_type", "member_joined");

    const needsAfterOnboard = computeNeedsMemberOnboarding({
      role: "staff",
      departmentId: afterOnboardMember?.department_id ?? null,
      designation: afterOnboardMember?.designation ?? null,
      onboardedAt: afterOnboardMember?.onboarded_at ?? null,
    });

    const concurrentAndRepeatVerified =
      fulfilledCount === 1 &&
      rejectedOutcomes.length === 1 &&
      String(rejectedOutcomes[0].reason?.message || rejectedOutcomes[0].reason).includes(
        "Forbidden: Member onboarding has already been completed"
      ) &&
      sequentialRepeatError.includes("Forbidden: Member onboarding has already been completed") &&
      afterOnboardProfile?.full_name === "Zinhle Mokoena" &&
      afterOnboardMember?.designation === "Call Center Consultant" &&
      afterOnboardMember?.department_id === null &&
      afterOnboardMember?.requested_department_id !== null &&
      afterOnboardMember?.onboarded_at !== null &&
      onboardingAudits?.length === 1 &&
      needsAfterOnboard === false;

    record(
      "Scenario 5: Concurrent & repeated onboarding attempts serialized via FOR UPDATE (1 succeeds, 1 rejected, 1 audit row, onboarded_at & requested_department_id persisted)",
      concurrentAndRepeatVerified,
      `fulfilled=${fulfilledCount}, concurrentRejected="${rejectedOutcomes[0]?.reason?.message}", sequentialRepeatError="${sequentialRepeatError}", onboarded_at=${afterOnboardMember?.onboarded_at}, requested_department_id=${afterOnboardMember?.requested_department_id}, auditCount=${onboardingAudits?.length}`
    );

    // -------------------------------------------------------------------------
    // SCENARIO 6: Administrator approval, clearing of requested_department_id, and consistent behavior after department removal
    // -------------------------------------------------------------------------
    // 6a. Before approval, verify getTeamMembersCore surfaces the pending department request from organization_members.requested_department_id
    const teamBeforeApproval = await getTeamMembersCore(ownerA.token);
    const staffBeforeApproval = teamBeforeApproval.find((m) => m.id === staffMemberRow.id);

    // 6b. Admin approves the requested department via updateMemberRoleCore
    const approvedDeptId = afterOnboardMember!.requested_department_id!;
    await updateMemberRoleCore(
      {
        memberId: staffMemberRow.id,
        department_id: approvedDeptId,
      },
      ownerA.token
    );

    const { data: afterApproveMember } = await svc
      .from("organization_members")
      .select("department_id, requested_department_id, onboarded_at")
      .eq("id", staffMemberRow.id)
      .single();

    const teamAfterApproval = await getTeamMembersCore(ownerA.token);
    const staffAfterApproval = teamAfterApproval.find((m) => m.id === staffMemberRow.id);

    // 6c. Admin later removes the member from the department (department_id: null)
    // Verify the old onboarding department request does NOT reappear from historical audit logs!
    await updateMemberRoleCore(
      {
        memberId: staffMemberRow.id,
        department_id: null,
      },
      ownerA.token
    );

    const teamAfterRemoval = await getTeamMembersCore(ownerA.token);
    const staffAfterRemoval = teamAfterRemoval.find((m) => m.id === staffMemberRow.id);

    const lifecycleConsistent =
      staffBeforeApproval?.requested_department_id === approvedDeptId &&
      Boolean(staffBeforeApproval?.requested_department_name) &&
      afterApproveMember?.department_id === approvedDeptId &&
      afterApproveMember?.requested_department_id === null &&
      staffAfterApproval?.requested_department_id === null &&
      staffAfterApproval?.requested_department_name === null &&
      staffAfterRemoval?.department_id === null &&
      staffAfterRemoval?.requested_department_id === null &&
      staffAfterRemoval?.requested_department_name === null;

    record(
      "Scenario 6: Admin approval sets department_id & clears requested_department_id; subsequent department removal does not resurrect stale request",
      lifecycleConsistent,
      `beforeReq=${staffBeforeApproval?.requested_department_name}, afterApprove={dept:${afterApproveMember?.department_id}, req:${afterApproveMember?.requested_department_id}}, afterRemoval={dept:${staffAfterRemoval?.department_id}, req:${staffAfterRemoval?.requested_department_id}}`
    );
  } finally {
    // Cleanup temporary memberships, departments, organizations, and users
    for (const orgId of createdOrgIds) {
      await svc.from("organization_members").delete().eq("organization_id", orgId);
      await svc.from("departments").delete().eq("organization_id", orgId);
      await svc.from("organizations").delete().eq("id", orgId);
    }
    for (const uid of createdUserIds) {
      await svc.from("profiles").delete().eq("id", uid);
      await svc.auth.admin.deleteUser(uid);
    }
  }

  console.log("\n=== Summary ===");
  const passedCount = results.filter((r) => r.passed).length;
  console.log(`${passedCount}/${results.length} scenarios passed.`);

  if (passedCount !== results.length) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Unhandled integration test error:", err);
  process.exit(1);
});
