import { enforceAdmin, enforceAdminOrManager } from "../src/lib/team.server.ts";

import assert from "assert";

console.log("Running Authorization Unit Tests...");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`❌ FAIL: ${name} - ${e.message}`);
    failed++;
  }
}

function expectThrow(fn, expectedMsgPart) {
  try {
    fn();
    throw new Error("Did not throw");
  } catch (e) {
    if (e.message === "Did not throw") throw e;
    if (expectedMsgPart && !e.message.includes(expectedMsgPart)) {
      throw new Error(`Expected error containing "${expectedMsgPart}" but got "${e.message}"`);
    }
  }
}

// 1. enforceAdmin
test("enforceAdmin allows owner", () => enforceAdmin("owner"));
test("enforceAdmin allows admin", () => enforceAdmin("admin"));
test("enforceAdmin rejects manager", () => expectThrow(() => enforceAdmin("manager"), "Forbidden"));
test("enforceAdmin rejects staff", () => expectThrow(() => enforceAdmin("staff"), "Forbidden"));

// 2. enforceAdminOrManager
test("enforceAdminOrManager allows owner", () => enforceAdminOrManager("owner"));
test("enforceAdminOrManager allows admin", () => enforceAdminOrManager("admin"));
test("enforceAdminOrManager allows manager", () => enforceAdminOrManager("manager"));
test("enforceAdminOrManager rejects staff", () => expectThrow(() => enforceAdminOrManager("staff"), "Forbidden"));

console.log(`\nTest Summary: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
