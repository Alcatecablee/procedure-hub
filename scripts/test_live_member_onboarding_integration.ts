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
import { updateMemberRoleCore } from "../src/lib/team.server";
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

async function createTempUser(prefix: string): Promise<{ id: string; email: string; token: string }> {
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

async function main() {
  console.log("=== Running Live Supabase Member Onboarding Security & Integrity Suite ===\n");

  const createdUserIds: string[] = [];
  const createdOrgIds: string[] = [];

  try {
    // 1. Provision isolated test users (Owner A, Staff A, Owner B)
    const ownerA = await createTempUser("owner_org_a");
    createdUserIds.push(ownerA.id);

    const staffA = await createTempUser("staff_org_a");
    createdUserIds.push(staffA.id);

    const ownerB = await createTempUser("owner_org_b");
    createdUserIds.push(ownerB.id);

    const ts = Date.now();

    // 2. Create Org A and Org B
    const { data: orgA, error: orgAErr } = await svc
      .from("organizations")
      .insert({
        name: `Onboarding Test Org A ${ts}`,
        slug: `onboard-org-a-${ts}`,
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
        name: `Onboarding Test Org B ${ts}`,
        slug: `onboard-org-b-${ts}`,
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
    if (d2Err || !deptCompliance) throw new Error(`Failed to create deptCompliance: ${d2Err?.message}`);

    const { data: deptOrgB, error: dBErr } = await svc
      .from("departments")
      .insert({ organization_id: orgB.id, name: "Org B Secret Dept" })
      .select("id, name")
      .single();
    if (dBErr || !deptOrgB) throw new Error(`Failed to create deptOrgB: ${dBErr?.message}`);

    // 4. Add memberships:
    // - ownerA is owner of Org A
    // - staffA is active staff in Org A with a pre-filled designation ("Pre-Invited Agent") but NO department (department_id: null)
    const { error: mOwnerErr } = await svc.from("organization_members").insert({
      organization_id: orgA.id,
      user_id: ownerA.id,
      role: "owner",
      status: "active",
      joined_at: new Date().toISOString(),
    });
    if (mOwnerErr) throw new Error(`Failed to insert ownerA membership: ${mOwnerErr.message}`);

    const { data: staffMemberRow, error: mStaffErr } = await svc
      .from("organization_members")
      .insert({
        organization_id: orgA.id,
        user_id: staffA.id,
        role: "staff",
        designation: "Pre-Invited Agent",
        department_id: null,
        status: "active",
        joined_at: new Date().toISOString(),
      })
      .select("*")
      .single();
    if (mStaffErr || !staffMemberRow) {
      throw new Error(`Failed to insert staffA membership: ${mStaffErr?.message}`);
    }

    // -------------------------------------------------------------------------
    // SCENARIO 1: Member with designation but no department (and vice versa)
    // -------------------------------------------------------------------------
    const needsWithDesigNoDept = computeNeedsMemberOnboarding(
      {
        organization: orgA as any,
        role: "staff",
        departmentId: null,
        designation: "Pre-Invited Agent",
      },
      { app_metadata: {} }
    );

    const needsWithDeptNoDesig = computeNeedsMemberOnboarding(
      {
        organization: orgA as any,
        role: "staff",
        departmentId: deptSupport.id,
        designation: null,
      },
      { app_metadata: {} }
    );

    const needsForOwner = computeNeedsMemberOnboarding(
      {
        organization: orgA as any,
        role: "owner",
        departmentId: null,
        designation: null,
      },
      { app_metadata: {} }
    );

    record(
      "Scenario 1: Partial onboarding detection (designation without department, or department without designation)",
      needsWithDesigNoDept === true && needsWithDeptNoDesig === true && needsForOwner === false,
      `needsWithDesigNoDept=${needsWithDesigNoDept}, needsWithDeptNoDesig=${needsWithDeptNoDesig}, needsForOwner=${needsForOwner}`
    );

    // -------------------------------------------------------------------------
    // SCENARIO 2: Department request targeting another organization (rejected before any write)
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
      .select("designation, department_id")
      .eq("id", staffMemberRow.id)
      .single();
    const { data: afterCrossOrgProfile } = await svc
      .from("profiles")
      .select("full_name")
      .eq("id", staffA.id)
      .single();

    const crossOrgRejectedCleanly =
      crossOrgError.includes("Forbidden") &&
      afterCrossOrgMember?.designation === "Pre-Invited Agent" &&
      afterCrossOrgMember?.department_id === null &&
      afterCrossOrgProfile?.full_name === "Initial staff_org_a";

    record(
      "Scenario 2: Department request targeting another organization rejected before any write",
      crossOrgRejectedCleanly,
      `error="${crossOrgError}", designation="${afterCrossOrgMember?.designation}", profile.full_name="${afterCrossOrgProfile?.full_name}"`
    );

    // -------------------------------------------------------------------------
    // SCENARIO 3: Failed audit insertion triggers compensating rollback of profile & membership
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
        { _forceAuditEventTypeForTest: "member_onboarded" } // invalid enum value in PostgreSQL
      );
    } catch (err: any) {
      auditFailError = err?.message || String(err);
    }

    const { data: afterAuditFailMember } = await svc
      .from("organization_members")
      .select("designation, department_id")
      .eq("id", staffMemberRow.id)
      .single();
    const { data: afterAuditFailProfile } = await svc
      .from("profiles")
      .select("full_name")
      .eq("id", staffA.id)
      .single();

    const auditRollbackVerified =
      auditFailError.includes("Audit log insertion failed") &&
      afterAuditFailMember?.designation === "Pre-Invited Agent" &&
      afterAuditFailMember?.department_id === null &&
      afterAuditFailProfile?.full_name === "Initial staff_org_a";

    record(
      "Scenario 3: Failed audit log insertion rolls back profile and membership writes",
      auditRollbackVerified,
      `error="${auditFailError}", restored designation="${afterAuditFailMember?.designation}", restored full_name="${afterAuditFailProfile?.full_name}"`
    );

    // -------------------------------------------------------------------------
    // SCENARIO 4: Legitimate new member completing onboarding (requests Customer Support, does NOT self-assign department_id)
    // -------------------------------------------------------------------------
    const onboardRes = await completeMemberOnboardingCore(
      {
        fullName: "Zinhle Mokoena",
        designation: "Call Center Consultant",
        requestedDepartmentId: deptSupport.id,
      },
      staffA.token
    );

    const { data: afterOnboardMember } = await svc
      .from("organization_members")
      .select("designation, department_id")
      .eq("id", staffMemberRow.id)
      .single();
    const { data: afterOnboardProfile } = await svc
      .from("profiles")
      .select("full_name")
      .eq("id", staffA.id)
      .single();
    const { data: onboardingAuditRow } = await svc
      .from("audit_logs")
      .select("event_type, entity_type, entity_id, metadata")
      .eq("organization_id", orgA.id)
      .eq("entity_id", staffMemberRow.id)
      .eq("event_type", "member_joined")
      .maybeSingle();
    const { data: updatedAuthUser } = await svc.auth.admin.getUserById(staffA.id);

    const needsAfterOnboard = computeNeedsMemberOnboarding(
      {
        organization: orgA as any,
        role: "staff",
        departmentId: afterOnboardMember?.department_id ?? null,
        designation: afterOnboardMember?.designation ?? null,
      },
      updatedAuthUser?.user ?? null
    );

    const auditMeta = (onboardingAuditRow?.metadata || {}) as Record<string, any>;
    const legitimateOnboardPassed =
      onboardRes.success === true &&
      onboardRes.requiresAdminDepartmentApproval === true &&
      afterOnboardProfile?.full_name === "Zinhle Mokoena" &&
      afterOnboardMember?.designation === "Call Center Consultant" &&
      afterOnboardMember?.department_id === null && // Trusted department_id untouched by self-service!
      onboardingAuditRow?.event_type === "member_joined" &&
      auditMeta.action === "onboarding_completed" &&
      auditMeta.requested_department_id === deptSupport.id &&
      needsAfterOnboard === false;

    record(
      "Scenario 4: Legitimate member completes onboarding (writes audit_logs 'member_joined', leaves trusted department_id null pending admin approval)",
      legitimateOnboardPassed,
      `full_name="${afterOnboardProfile?.full_name}", designation="${afterOnboardMember?.designation}", department_id=${afterOnboardMember?.department_id}, requested_department_id=${auditMeta.requested_department_id}, needsMemberOnboarding=${needsAfterOnboard}`
    );

    // -------------------------------------------------------------------------
    // SCENARIO 5: Staff attempting to change their department after onboarding (both endpoints rejected)
    // -------------------------------------------------------------------------
    let repeatOnboardError = "";
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
      repeatOnboardError = err?.message || String(err);
    }

    let directRoleUpdateError = "";
    try {
      await updateMemberRoleCore(
        {
          memberId: staffMemberRow.id,
          department_id: deptCompliance.id,
        },
        staffA.token
      );
    } catch (err: any) {
      directRoleUpdateError = err?.message || String(err);
    }

    const { data: afterTamperMember } = await svc
      .from("organization_members")
      .select("designation, department_id")
      .eq("id", staffMemberRow.id)
      .single();

    const postOnboardTamperBlocked =
      repeatOnboardError.includes("Forbidden: Member onboarding has already been completed") &&
      directRoleUpdateError.includes("Forbidden: requires owner or admin role") &&
      afterTamperMember?.department_id === null &&
      afterTamperMember?.designation === "Call Center Consultant";

    record(
      "Scenario 5: Staff attempting to change department after onboarding is rejected on both onboarding and team endpoints",
      postOnboardTamperBlocked,
      `repeatOnboardError="${repeatOnboardError}", directRoleUpdateError="${directRoleUpdateError}", department_id=${afterTamperMember?.department_id}`
    );

    // -------------------------------------------------------------------------
    // SCENARIO 6: Authorized administrator completing department assignment via updateMemberRoleCore
    // -------------------------------------------------------------------------
    // First verify admin cannot assign a department from another organization
    let adminCrossOrgError = "";
    try {
      await updateMemberRoleCore(
        {
          memberId: staffMemberRow.id,
          department_id: deptOrgB.id,
        },
        ownerA.token
      );
    } catch (err: any) {
      adminCrossOrgError = err?.message || String(err);
    }

    // Now admin approves the member's Customer Support department assignment
    const adminApproveRes = await updateMemberRoleCore(
      {
        memberId: staffMemberRow.id,
        department_id: deptSupport.id,
      },
      ownerA.token
    );

    const { data: afterAdminApproveMember } = await svc
      .from("organization_members")
      .select("department_id, designation")
      .eq("id", staffMemberRow.id)
      .single();

    const adminAssignmentVerified =
      adminCrossOrgError.includes("Forbidden") &&
      adminApproveRes.success === true &&
      afterAdminApproveMember?.department_id === deptSupport.id;

    record(
      "Scenario 6: Authorized administrator approves and assigns trusted department_id via updateMemberRoleCore",
      adminAssignmentVerified,
      `adminCrossOrgError="${adminCrossOrgError}", assigned department_id=${afterAdminApproveMember?.department_id} (expected ${deptSupport.id})`
    );
  } finally {
    // Cleanup temporary organizations and users
    for (const orgId of createdOrgIds) {
      await svc.from("organizations").delete().eq("id", orgId);
    }
    for (const uid of createdUserIds) {
      await svc.auth.admin.deleteUser(uid);
      await svc.from("profiles").delete().eq("id", uid);
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
