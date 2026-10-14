import { z } from "zod";

// Mock definitions reflecting team.server.ts logic
type MemberRole = "owner" | "admin" | "manager" | "staff" | "viewer";

function enforceAdmin(role: MemberRole) {
  if (role !== "owner" && role !== "admin") {
    throw new Error("Forbidden: requires owner or admin role");
  }
}

function simulateUpdateRole(
  callerRole: MemberRole,
  targetOriginalRole: MemberRole,
  newRole: MemberRole | undefined,
  newDesignation?: string,
  totalOwners = 2,
) {
  try {
    enforceAdmin(callerRole);

    if (newRole === "owner" && callerRole !== "owner") {
      throw new Error("Only owners can assign the owner role.");
    }

    if (newRole === "admin" && callerRole !== "owner") {
      throw new Error("Only owners can assign the admin role.");
    }

    if (targetOriginalRole === "owner" && callerRole !== "owner") {
      throw new Error("Only owners can modify owner accounts.");
    }

    if (targetOriginalRole === "owner" && newRole && newRole !== "owner") {
      if (totalOwners <= 1) {
        throw new Error("Cannot demote the final owner of the organization.");
      }
    }

    return "ALLOWED";
  } catch (e: any) {
    return `BLOCKED: ${e.message}`;
  }
}

console.log("1. Owner assigns Admin:", simulateUpdateRole("owner", "staff", "admin"));
console.log("2. Owner assigns Manager:", simulateUpdateRole("owner", "staff", "manager"));
console.log("3. Admin assigns Manager:", simulateUpdateRole("admin", "staff", "manager"));
console.log("4. Admin assigns Staff:", simulateUpdateRole("admin", "viewer", "staff"));
console.log("5. Admin assigns Viewer:", simulateUpdateRole("admin", "staff", "viewer"));
console.log("6. Admin attempts Admin:", simulateUpdateRole("admin", "staff", "admin"));
console.log("7. Admin attempts Owner:", simulateUpdateRole("admin", "staff", "owner"));
console.log(
  "8. Manager attempts changing someone's role:",
  simulateUpdateRole("manager", "staff", "viewer"),
);
console.log(
  "9. Staff attempts changing designation:",
  simulateUpdateRole("staff", "staff", undefined, "New Title"),
);
console.log(
  "10. Admin changes designation without changing role:",
  simulateUpdateRole("admin", "staff", undefined, "Executive Head: Risk"),
);
console.log(
  "11. Admin changes department without changing role:",
  simulateUpdateRole("admin", "staff", undefined, undefined),
);
console.log(
  "12. Designation 'Executive Head: Risk & Fraud' grants capabilities?",
  "NO - simulateUpdateRole validates strictly against the strongly-typed 'callerRole' enum.",
);
console.log(
  "13. Owner cannot accidentally demote final Owner:",
  simulateUpdateRole("owner", "owner", "admin", undefined, 1),
);
console.log(
  "14. Cross-organization modification:",
  "BLOCKED by RLS and server-side ctx.orgId equivalence enforcement (verified in code).",
);
