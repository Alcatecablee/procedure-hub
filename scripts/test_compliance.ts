import { processOperationalCompliance, processStaffCompliance } from "../src/lib/compliance.server.ts";
import assert from "assert";

console.log("Running Compliance Unit Tests...");

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✅ PASS: ${name}`);
    passed++;
  } catch (e: any) {
    console.error(`❌ FAIL: ${name} - ${e.message}`);
    failed++;
  }
}

// Mock Database Result Rows
const mockData = [
  // User 1: ACKNOWLEDGED (v2)
  {
    procedure_id: "p1", procedure_title: "Fire Safety", current_version_id: "v2", current_version_number: 2,
    user_id: "u1", member_department_id: "HR", compliance_status: "ACKNOWLEDGED",
  },
  // User 2: REQUIRES_REACK (has v1, but current is v2)
  {
    procedure_id: "p1", procedure_title: "Fire Safety", current_version_id: "v2", current_version_number: 2,
    user_id: "u2", member_department_id: "IT", compliance_status: "REQUIRES_REACK",
  },
  // User 3: OUTSTANDING (no ack)
  {
    procedure_id: "p1", procedure_title: "Fire Safety", current_version_id: "v2", current_version_number: 2,
    user_id: "u3", member_department_id: "IT", compliance_status: "OUTSTANDING",
  },
  // User 1 on p2: OUTSTANDING
  {
    procedure_id: "p2", procedure_title: "Code of Conduct", current_version_id: "v1", current_version_number: 1,
    user_id: "u1", member_department_id: "HR", compliance_status: "OUTSTANDING",
  }
];

// Operational Compliance Tests
test("Operational Compliance: Aggregates totals correctly", () => {
  const result = processOperationalCompliance(mockData);
  assert.strictEqual(result.overall.totalRequired, 4);
  assert.strictEqual(result.overall.acknowledged, 1);
  assert.strictEqual(result.overall.outstanding, 2);
  assert.strictEqual(result.overall.requiresReack, 1);
  assert.strictEqual(result.overall.compliancePct, 25); // 1/4 = 25%
});

test("Operational Compliance: Zero required members returns no data instead of 100%", () => {
  const result = processOperationalCompliance([]);
  assert.strictEqual(result.overall.totalRequired, 0);
  assert.strictEqual(result.overall.compliancePct, null);
});

test("Operational Compliance: Groups by procedure correctly", () => {
  const result = processOperationalCompliance(mockData);
  const p1 = result.byProcedure.find((p: any) => p.procedure_id === "p1");
  assert.strictEqual(p1.total, 3);
  assert.strictEqual(p1.acknowledged, 1);
  assert.strictEqual(p1.outstanding, 1);
  assert.strictEqual(p1.requires_reack, 1);
  assert.strictEqual(p1.compliancePct, 33); // 1/3 = 33%

  const p2 = result.byProcedure.find((p: any) => p.procedure_id === "p2");
  assert.strictEqual(p2.total, 1);
  assert.strictEqual(p2.compliancePct, 0);
});

test("Operational Compliance: Groups by department correctly", () => {
  const result = processOperationalCompliance(mockData);
  
  const hr = result.byDepartment.find((d: any) => d.department_id === "HR");
  assert.strictEqual(hr.total, 2); // u1 on p1 and p2
  assert.strictEqual(hr.acknowledged, 1);
  assert.strictEqual(hr.outstanding, 1);
  assert.strictEqual(hr.compliancePct, 50);

  const it = result.byDepartment.find((d: any) => d.department_id === "IT");
  assert.strictEqual(it.total, 2); // u2 and u3 on p1
  assert.strictEqual(it.acknowledged, 0);
  assert.strictEqual(it.requires_reack, 1);
  assert.strictEqual(it.outstanding, 1);
  assert.strictEqual(it.compliancePct, 0);
});

// Staff Compliance Tests
test("Staff Compliance: Groups by status correctly", () => {
  const staffData = mockData.filter(d => d.user_id === "u1");
  const result = processStaffCompliance(staffData);
  
  assert.strictEqual(result.totalRequired, 2);
  assert.strictEqual(result.acknowledged.length, 1);
  assert.strictEqual(result.outstanding.length, 1);
  assert.strictEqual(result.requiresReack.length, 0);
});

console.log(`\nTest Summary: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
