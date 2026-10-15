/**
 * Procedure Hub - Audience Review Inventory Utility
 *
 * Scans active procedures requiring acknowledgment and identifies their audience classification:
 * - PENDING_OPERATIONAL_REVIEW: Backfilled procedures assigned 'all_active_members' that should
 *   be audited to determine if they should remain company-wide or be scoped to frontline staff.
 * - CONFIRMED_STAFF_ONLY: Procedures explicitly scoped to frontline staff ('staff' role).
 */
import { supabase } from "../src/integrations/supabase/client.ts";

export interface ProcedureReviewItem {
  id: string;
  title: string;
  department_id: string | null;
  acknowledgment_audience: "staff" | "all_active_members";
  version_number: number;
  review_status: "PENDING_OPERATIONAL_REVIEW" | "CONFIRMED_STAFF_ONLY";
}

export function classifyAudienceReview(
  procedures: Array<{
    id: string;
    title: string;
    department_id: string | null;
    acknowledgment_audience?: string;
    version_number: number;
    acknowledgment_required: boolean;
    status: string;
  }>,
): ProcedureReviewItem[] {
  return procedures
    .filter((p) => p.status === "active" && p.acknowledgment_required)
    .map((p) => {
      const audience = (p.acknowledgment_audience || "all_active_members") as
        | "staff"
        | "all_active_members";
      return {
        id: p.id,
        title: p.title,
        department_id: p.department_id,
        acknowledgment_audience: audience,
        version_number: p.version_number,
        review_status:
          audience === "all_active_members"
            ? "PENDING_OPERATIONAL_REVIEW"
            : "CONFIRMED_STAFF_ONLY",
      };
    });
}

async function runInventory() {
  console.log("==========================================================");
  console.log("PROCEDURE AUDIENCE REVIEW INVENTORY");
  console.log("==========================================================\n");

  let procedures: any = null;
  try {
    const res = await supabase
      .from("procedures")
      .select("id, title, department_id, acknowledgment_audience, version_number, acknowledgment_required, status")
      .eq("status", "active")
      .eq("acknowledgment_required", true);
    procedures = res.data;
  } catch (err: any) {
    console.warn("⚠️ Live Supabase connection unavailable in local offline environment:", err.message);
  }

  if (!procedures) {
    console.log("Demonstrating inventory classification with sample procedures:\n");

    const sampleData = [
      {
        id: "p1",
        title: "Incident Escalation Protocol",
        department_id: null,
        acknowledgment_audience: "all_active_members",
        version_number: 1,
        acknowledgment_required: true,
        status: "active",
      },
      {
        id: "p2",
        title: "Till Roll Replacement Procedure",
        department_id: "dept-support",
        acknowledgment_audience: "staff",
        version_number: 2,
        acknowledgment_required: true,
        status: "active",
      },
    ];

    const inventory = classifyAudienceReview(sampleData as any);
    console.table(inventory);
    return;
  }

  const inventory = classifyAudienceReview(procedures as any);
  console.table(inventory);
  console.log(`\nTotal Active Required Procedures: ${inventory.length}`);
  console.log(`Pending Operational Review: ${inventory.filter((i) => i.review_status === "PENDING_OPERATIONAL_REVIEW").length}`);
  console.log(`Confirmed Staff Only: ${inventory.filter((i) => i.review_status === "CONFIRMED_STAFF_ONLY").length}`);
}

void runInventory();
