import { createClient } from "@supabase/supabase-js";
import {
  updateProcedureCore,
  acknowledgeProcedureCore,
  getProcedureAuditLogsCore,
} from "../src/lib/procedures.server";
import { ingestTeamsExportCore } from "../src/lib/import.server";

const url = process.env.SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY!;

const adminClient = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function runAcceptanceSuite() {
  console.log("==================================================================");
  console.log("  PROCEDURE HUB - DATABASE & E2E COMMERCIAL ACCEPTANCE TEST SUITE");
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
  const createdOrgIds: string[] = [];

  async function createTestUser(prefix: string, domain = "pilot-a.example.com") {
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
    // ------------------------------------------------------------------
    // STEP 1: Multi-Tenant Organization Setup & Role Accounts
    // ------------------------------------------------------------------
    console.log("--- Step 1: Provisioning Tenants & Role Accounts (Owner, Admin, Manager, Staff, OrgB) ---");
    const ownerA = await createTestUser("owner_a", `org-a-${ts}.com`);
    const adminA = await createTestUser("admin_a", `org-a-${ts}.com`);
    const managerA = await createTestUser("manager_a", `org-a-${ts}.com`);
    const staffA = await createTestUser("staff_a", `org-a-${ts}.com`);
    const ownerB = await createTestUser("owner_b", `org-b-${ts}.com`);

    const { data: orgA, error: orgAErr } = await adminClient
      .from("organizations")
      .insert({
        name: `Pilot Org A ${ts}`,
        slug: `pilot-org-a-${ts}`,
        domain: `org-a-${ts}.com`,
        status: "active",
        created_by: ownerA.user.id,
      })
      .select()
      .single();
    if (orgAErr || !orgA) throw new Error("Failed creating Org A: " + orgAErr?.message);
    createdOrgIds.push(orgA.id);

    const { data: orgB, error: orgBErr } = await adminClient
      .from("organizations")
      .insert({
        name: `Pilot Org B ${ts}`,
        slug: `pilot-org-b-${ts}`,
        domain: `org-b-${ts}.com`,
        status: "active",
        created_by: ownerB.user.id,
      })
      .select()
      .single();
    if (orgBErr || !orgB) throw new Error("Failed creating Org B: " + orgBErr?.message);
    createdOrgIds.push(orgB.id);

    await adminClient.from("organization_members").insert([
      { organization_id: orgA.id, user_id: ownerA.user.id, role: "owner", status: "active" },
      { organization_id: orgA.id, user_id: adminA.user.id, role: "admin", status: "active" },
      { organization_id: orgB.id, user_id: ownerB.user.id, role: "owner", status: "active" },
    ]);

    const sessOwnerA = await signInUser(ownerA.email);
    const sessAdminA = await signInUser(adminA.email);
    const sessOwnerB = await signInUser(ownerB.email);

    // ------------------------------------------------------------------
    // STEP 2: Department Creation & RLS Verification
    // ------------------------------------------------------------------
    console.log("\n--- Step 2: Department Creation & RLS Enforcement ---");
    const { data: deptOps, error: deptOpsErr } = await sessOwnerA.client
      .from("departments")
      .insert({ organization_id: orgA.id, name: "Operations" })
      .select()
      .single();
    assert(!deptOpsErr && !!deptOps?.id, "Owner can create 'Operations' department via RLS", deptOpsErr?.message);

    const { data: deptSupport, error: deptSupErr } = await sessAdminA.client
      .from("departments")
      .insert({ organization_id: orgA.id, name: "Customer Support" })
      .select()
      .single();
    assert(!deptSupErr && !!deptSupport?.id, "Admin can create 'Customer Support' department via RLS", deptSupErr?.message);

    // Assign Manager A and Staff A to Operations department
    await adminClient.from("organization_members").insert([
      {
        organization_id: orgA.id,
        user_id: managerA.user.id,
        role: "manager",
        department_id: deptOps.id,
        status: "active",
      },
      {
        organization_id: orgA.id,
        user_id: staffA.user.id,
        role: "staff",
        department_id: deptOps.id,
        status: "active",
      },
    ]);

    const sessManagerA = await signInUser(managerA.email);
    const sessStaffA = await signInUser(staffA.email);

    // Verify Manager and Staff CANNOT create or delete departments via RLS
    const { error: mgrDeptErr } = await sessManagerA.client
      .from("departments")
      .insert({ organization_id: orgA.id, name: "Unauthorized Manager Dept" });
    assert(!!mgrDeptErr, "Manager cannot create departments (RLS blocks)");

    const { error: staffDeptErr } = await sessStaffA.client
      .from("departments")
      .insert({ organization_id: orgA.id, name: "Unauthorized Staff Dept" });
    assert(!!staffDeptErr, "Staff cannot create departments (RLS blocks)");

    // Verify Staff and Manager CAN read their org's departments
    const { data: staffDepts } = await sessStaffA.client
      .from("departments")
      .select("id, name")
      .eq("organization_id", orgA.id);
    assert(staffDepts?.length === 2, "Staff can read organization departments");

    // ------------------------------------------------------------------
    // STEP 3: Invitation Collision (Domain Auto-Join Trigger) & Re-invite Removed Member
    // ------------------------------------------------------------------
    console.log("\n--- Step 3: Domain Auto-Join Invitation Collision & Removed Member Restoration ---");
    // Create a user whose email matches orgA's domain (`org-a-${ts}.com`)
    // The DB trigger `handle_new_user` automatically inserts (orgA.id, user_id, role='staff', status='active').
    const domainUser = await createTestUser("domain_invitee", `org-a-${ts}.com`);
    const { data: triggerRow } = await adminClient
      .from("organization_members")
      .select("role, status")
      .eq("organization_id", orgA.id)
      .eq("user_id", domainUser.user.id)
      .single();
    assert(
      triggerRow?.status === "active" && triggerRow?.role === "staff",
      "DB trigger on_auth_user_created auto-inserts domain-matching user",
    );

    // Now simulate explicit invitation upsert (as Manager/Admin inviting with specific role & department)
    const { error: upsertInviteErr } = await adminClient
      .from("organization_members")
      .upsert(
        {
          organization_id: orgA.id,
          user_id: domainUser.user.id,
          role: "manager",
          department_id: deptOps.id,
          designation: "Shift Lead",
          status: "invited",
          invited_by: ownerA.user.id,
          joined_at: null,
        },
        { onConflict: "organization_id,user_id" },
      );
    assert(!upsertInviteErr, "Upsert on (organization_id, user_id) succeeds without constraint error", upsertInviteErr?.message);

    const { data: afterUpsert } = await adminClient
      .from("organization_members")
      .select("role, status, department_id, designation")
      .eq("organization_id", orgA.id)
      .eq("user_id", domainUser.user.id)
      .single();
    assert(
      afterUpsert?.status === "invited" &&
        afterUpsert?.role === "manager" &&
        afterUpsert?.department_id === deptOps.id,
      "Explicit invitation upsert overrides auto-join row with invited status, role, and department",
    );

    // Simulate removing a member (status = 'removed') and re-inviting them via upsert
    await adminClient
      .from("organization_members")
      .update({ status: "removed" })
      .eq("organization_id", orgA.id)
      .eq("user_id", domainUser.user.id);

    const { error: reInviteErr } = await adminClient
      .from("organization_members")
      .upsert(
        {
          organization_id: orgA.id,
          user_id: domainUser.user.id,
          role: "staff",
          department_id: deptSupport.id,
          status: "invited",
          invited_by: adminA.user.id,
          joined_at: null,
        },
        { onConflict: "organization_id,user_id" },
      );
    const { data: reInvitedRow } = await adminClient
      .from("organization_members")
      .select("status, role, department_id")
      .eq("organization_id", orgA.id)
      .eq("user_id", domainUser.user.id)
      .single();
    assert(
      !reInviteErr && reInvitedRow?.status === "invited" && reInvitedRow?.role === "staff",
      "Removed member can be re-invited cleanly to 'invited' status without violating unique constraints",
    );

    // ------------------------------------------------------------------
    // STEP 4: Live Gemini AI Import -> Human Review -> Uncategorized Approval
    // ------------------------------------------------------------------
    console.log("\n--- Step 4: Live Gemini AI Import & Uncategorized Draft Approval ---");
    const sampleTeamsExport = `
[09:00 AM] John: Morning team, coffee machine is fixed!
[09:14 AM] Sarah (Operations Director): URGENT PROCEDURE UPDATE - Effective immediately, all Operations staff must verify customer two-factor authentication (2FA) codes before processing any account wire transfer over $1,000. Any failed verification must be logged in the Fraud Desk queue within 15 minutes.
[09:16 AM] Mike: Got it, thanks Sarah!
    `.trim();

    const importRes = await ingestTeamsExportCore(
      {
        organizationId: orgA.id,
        rawText: sampleTeamsExport,
        sourceType: "teams",
      },
      sessManagerA.token,
    );
    assert(!!importRes.importId, "Manager successfully executed live Gemini AI import via ingestTeamsExportCore");

    const { data: importRow } = await sessManagerA.client
      .from("imports")
      .select("*")
      .eq("id", importRes.importId)
      .single();
    assert(
      importRow?.status === "review" && (importRow?.candidate_count ?? 0) >= 1,
      `Import record transitioned to 'review' with ${importRow?.candidate_count} extracted candidate(s)`,
    );

    const { data: drafts } = await sessManagerA.client
      .from("import_drafts")
      .select("*")
      .eq("import_id", importRes.importId);
    const firstDraft = drafts?.[0];
    assert(
      !!firstDraft && firstDraft.status === "pending",
      `AI candidate staged in import_drafts as 'pending' (model: ${firstDraft?.model_name}, version: ${firstDraft?.model_version})`,
    );

    // Verify AI extraction did NOT automatically create or publish a procedure
    const { data: autoProcs } = await adminClient
      .from("procedures")
      .select("id")
      .eq("organization_id", orgA.id);
    assert(autoProcs?.length === 0, "AI extraction did NOT auto-create or auto-publish any procedure");

    // Approve draft with uncategorized (_category_id: null) as Manager
    const { data: approvedProcId, error: approveErr } = await sessManagerA.client.rpc(
      "atomic_approve_draft",
      {
        _draft_id: firstDraft.id,
        _org_id: orgA.id,
        _title: firstDraft.title || "Wire Transfer 2FA Verification",
        _summary: firstDraft.summary || "Mandatory 2FA check before wire transfers.",
        _description: firstDraft.description,
        _priority: "high",
        _category_id: null, // Uncategorized!
        _effective_date: null,
        _expiry_date: null,
        _ack_required: true,
      },
    );
    assert(
      !approveErr && !!approvedProcId,
      "atomic_approve_draft RPC succeeds with _category_id = null (uncategorized) for Manager",
      approveErr?.message,
    );

    const { data: draftProc } = await sessManagerA.client
      .from("procedures")
      .select("*")
      .eq("id", approvedProcId)
      .single();
    assert(
      draftProc?.status === "draft" &&
        draftProc?.category_id === null &&
        draftProc?.department_id === deptOps.id,
      "Approved draft creates a 'draft' procedure scoped to Manager's department with null category_id",
    );

    // Verify Staff CANNOT see draft procedure
    const { data: staffSeesDraft } = await sessStaffA.client
      .from("procedures")
      .select("id")
      .eq("id", approvedProcId);
    assert(staffSeesDraft?.length === 0, "Staff cannot read draft procedure (RLS hides drafts from staff)");

    // ------------------------------------------------------------------
    // STEP 5: Publication -> Acknowledgment -> Revision -> Re-Acknowledgment
    // ------------------------------------------------------------------
    console.log("\n--- Step 5: Procedure Publication, Staff Acknowledgment, Revision & Re-Acknowledgment ---");
    const pubV1 = await updateProcedureCore(
      {
        id: approvedProcId,
        organizationId: orgA.id,
        title: draftProc.title,
        summary: draftProc.summary,
        description: draftProc.description,
        priority: "high",
        categoryId: null,
        departmentId: deptOps.id,
        acknowledgmentRequired: true,
        expectedVersion: 0,
        publish: true,
      },
      sessManagerA.token,
    );
    assert(pubV1.published === true && pubV1.skipped === false, "Manager published draft procedure to Version 1");

    const { data: activeProcV1 } = await sessStaffA.client
      .from("procedures")
      .select("id, status, version_number, current_version_id")
      .eq("id", approvedProcId)
      .single();
    assert(
      activeProcV1?.status === "active" && activeProcV1?.version_number === 1 && !!activeProcV1?.current_version_id,
      "Staff can now read published Version 1 procedure",
    );

    // Check compliance view before Staff acknowledgment
    const { data: compBefore } = await sessManagerA.client
      .from("procedure_member_compliance")
      .select("compliance_status")
      .eq("procedure_id", approvedProcId)
      .eq("user_id", staffA.user.id)
      .single();
    assert(
      compBefore?.compliance_status === "OUTSTANDING",
      "Compliance view reports 'OUTSTANDING' for Staff before acknowledgment",
    );

    // Staff acknowledges Version 1
    const ackV1 = await acknowledgeProcedureCore(
      {
        procedureId: approvedProcId,
        versionId: activeProcV1.current_version_id,
        organizationId: orgA.id,
      },
      sessStaffA.token,
    );
    assert(ackV1.success === true, "Staff acknowledged Version 1 via acknowledgeProcedureCore");

    // Check compliance view after Version 1 acknowledgment
    const { data: compAfterV1 } = await sessManagerA.client
      .from("procedure_member_compliance")
      .select("compliance_status")
      .eq("procedure_id", approvedProcId)
      .eq("user_id", staffA.user.id)
      .single();
    assert(
      compAfterV1?.compliance_status === "ACKNOWLEDGED",
      "Compliance view transitions to 'ACKNOWLEDGED' after Staff acknowledges Version 1",
    );

    // Manager revises procedure to Version 2
    const pubV2 = await updateProcedureCore(
      {
        id: approvedProcId,
        organizationId: orgA.id,
        title: draftProc.title + " (Revised)",
        summary: "Updated threshold to $500",
        description: draftProc.description + "\n\nRevision 2: Threshold lowered to $500.",
        priority: "critical",
        categoryId: null,
        departmentId: deptOps.id,
        acknowledgmentRequired: true,
        expectedVersion: 1,
        publish: true,
      },
      sessManagerA.token,
    );
    assert(pubV2.published === true && pubV2.skipped === false, "Manager published revision (Version 2)");

    const { data: activeProcV2 } = await sessStaffA.client
      .from("procedures")
      .select("id, version_number, current_version_id")
      .eq("id", approvedProcId)
      .single();
    assert(
      activeProcV2?.version_number === 2 &&
        activeProcV2?.current_version_id !== activeProcV1?.current_version_id,
      "Procedure incremented to Version 2 with new current_version_id",
    );

    // Verify immutable version history contains both v1 and v2
    const { data: versionHistory } = await sessStaffA.client
      .from("procedure_versions")
      .select("version_number")
      .eq("procedure_id", approvedProcId)
      .order("version_number", { ascending: true });
    assert(
      versionHistory?.length === 2 &&
        versionHistory[0].version_number === 1 &&
        versionHistory[1].version_number === 2,
      "Immutable procedure_versions table retains both v1 and v2",
    );

    // Check compliance view after Version 2 publication (must require re-acknowledgment!)
    const { data: compAfterRevision } = await sessManagerA.client
      .from("procedure_member_compliance")
      .select("compliance_status")
      .eq("procedure_id", approvedProcId)
      .eq("user_id", staffA.user.id)
      .single();
    assert(
      compAfterRevision?.compliance_status === "REQUIRES_REACK",
      "Compliance view automatically transitions Staff to 'REQUIRES_REACK' upon Version 2 publication",
    );

    // Staff re-acknowledges Version 2
    await acknowledgeProcedureCore(
      {
        procedureId: approvedProcId,
        versionId: activeProcV2.current_version_id,
        organizationId: orgA.id,
      },
      sessStaffA.token,
    );

    const { data: compAfterV2Ack } = await sessManagerA.client
      .from("procedure_member_compliance")
      .select("compliance_status")
      .eq("procedure_id", approvedProcId)
      .eq("user_id", staffA.user.id)
      .single();
    assert(
      compAfterV2Ack?.compliance_status === "ACKNOWLEDGED",
      "Compliance view returns to 'ACKNOWLEDGED' after Staff re-acknowledges Version 2",
    );

    // Verify Audit History retrieval (`getProcedureAuditLogsCore`) resolves actor profiles
    const auditLogs = await getProcedureAuditLogsCore(
      { organizationId: orgA.id, id: approvedProcId },
      sessOwnerA.token,
    );
    assert(
      auditLogs.length >= 4 && auditLogs.some((l: any) => l.profiles?.email === managerA.email),
      `getProcedureAuditLogsCore returned ${auditLogs.length} audit events with resolved actor profile emails`,
    );

    // Regression Test 1: Missing organizationId must be rejected by GetProcedureAuditLogsInput schema
    let missingOrgErr: any = null;
    try {
      await getProcedureAuditLogsCore({ id: approvedProcId } as any, sessOwnerA.token);
    } catch (e: any) {
      missingOrgErr = e;
    }
    assert(
      !!missingOrgErr && (missingOrgErr.message.includes("organizationId") || missingOrgErr.message.includes("Required")),
      "getProcedureAuditLogsCore rejects request missing organizationId via dedicated Zod schema",
    );

    // Regression Test 2: Invalid organizationId format must be rejected by GetProcedureAuditLogsInput schema
    let invalidOrgErr: any = null;
    try {
      await getProcedureAuditLogsCore(
        { organizationId: "invalid-uuid-format", id: approvedProcId },
        sessOwnerA.token,
      );
    } catch (e: any) {
      invalidOrgErr = e;
    }
    assert(
      !!invalidOrgErr && invalidOrgErr.message.includes("Invalid uuid"),
      "getProcedureAuditLogsCore rejects malformed organizationId via dedicated Zod schema",
    );

    // Regression Test 3: Cross-organization audit-log retrieval must be rejected
    let crossOrgAuditErr: any = null;
    try {
      await getProcedureAuditLogsCore(
        { organizationId: orgA.id, id: approvedProcId },
        sessOwnerB.token,
      );
    } catch (e: any) {
      crossOrgAuditErr = e;
    }
    assert(
      !!crossOrgAuditErr && crossOrgAuditErr.message.includes("Forbidden: Insufficient organization role"),
      "Cross-organization audit-log retrieval blocked by verifyOrgRole",
    );

    // Regression Test 4: Procedure lookup fails when procedure ID does not belong to organization
    let foreignProcErr: any = null;
    try {
      await getProcedureAuditLogsCore(
        { organizationId: orgB.id, id: approvedProcId },
        sessOwnerB.token,
      );
    } catch (e: any) {
      foreignProcErr = e;
    }
    assert(
      !!foreignProcErr && foreignProcErr.message.includes("Procedure not found or access denied"),
      "Audit-log retrieval blocked when procedure does not belong to caller organization",
    );

    // Regression Test 5: Unrelated non-existent procedure ID rejected
    let nonExistentProcErr: any = null;
    try {
      await getProcedureAuditLogsCore(
        { organizationId: orgA.id, id: "00000000-0000-0000-0000-000000000000" },
        sessOwnerA.token,
      );
    } catch (e: any) {
      nonExistentProcErr = e;
    }
    assert(
      !!nonExistentProcErr && nonExistentProcErr.message.includes("Procedure not found or access denied"),
      "Audit-log retrieval rejects non-existent procedure ID",
    );

    // ------------------------------------------------------------------
    // STEP 6: Cross-Organization Tenant Isolation & Audit Immutability
    // ------------------------------------------------------------------
    console.log("\n--- Step 6: Cross-Tenant Isolation & Audit Log Immutability ---");
    const { data: orgBProcs } = await sessOwnerB.client
      .from("procedures")
      .select("*")
      .eq("organization_id", orgA.id);
    assert(orgBProcs?.length === 0, "Org B Owner cannot read Org A procedures");

    const { data: orgBMembers } = await sessOwnerB.client
      .from("organization_members")
      .select("*")
      .eq("organization_id", orgA.id);
    assert(orgBMembers?.length === 0, "Org B Owner cannot read Org A members");

    const { data: orgBImports } = await sessOwnerB.client
      .from("imports")
      .select("*")
      .eq("organization_id", orgA.id);
    assert(orgBImports?.length === 0, "Org B Owner cannot read Org A imports");

    const { data: orgBDrafts } = await sessOwnerB.client
      .from("import_drafts")
      .select("*")
      .eq("organization_id", orgA.id);
    assert(orgBDrafts?.length === 0, "Org B Owner cannot read Org A import_drafts");

    const { data: orgBAudits } = await sessOwnerB.client
      .from("audit_logs")
      .select("*")
      .eq("organization_id", orgA.id);
    assert(orgBAudits?.length === 0, "Org B Owner cannot read Org A audit_logs");

    // Verify Manager cannot modify another department's procedure
    const { data: supportProcId } = await sessAdminA.client.rpc("atomic_create_procedure", {
      _org_id: orgA.id,
      _title: "Support Only Procedure",
      _summary: "Support scope",
      _description: "Content",
      _priority: "medium",
      _category_id: null,
      _effective_date: null,
      _expiry_date: null,
      _ack_required: false,
      _publish: true,
      _department_id: deptSupport.id,
    });
    const { error: crossDeptErr } = await sessManagerA.client.rpc("atomic_archive_procedure", {
      _proc_id: supportProcId,
      _org_id: orgA.id,
    });
    assert(
      !!crossDeptErr && crossDeptErr.message.includes("outside their department"),
      "Manager in Operations cannot archive a procedure assigned to Customer Support",
    );

    // Verify audit_logs immutability trigger blocks DELETE even via service role!
    const { error: deleteAuditErr } = await adminClient
      .from("audit_logs")
      .delete()
      .eq("id", auditLogs[0].id);
    assert(
      !!deleteAuditErr && deleteAuditErr.message.includes("audit_logs rows are immutable"),
      "Database trigger enforces strict immutability on audit_logs (blocks DELETE)",
    );
  } finally {
    // Cleanup test users (note: organizations with audit_logs remain protected by immutable audit_logs trigger, so we clean up auth users)
    for (const uid of createdUserIds) {
      await adminClient.auth.admin.deleteUser(uid).catch(() => {});
    }
  }

  console.log(`\n==================================================================`);
  console.log(`  ACCEPTANCE SUITE SUMMARY: ${passed} Passed, ${failed} Failed`);
  console.log(`==================================================================`);
  process.exit(failed > 0 ? 1 : 0);
}

runAcceptanceSuite().catch((err) => {
  console.error("Fatal error in acceptance suite:", err);
  process.exit(1);
});
