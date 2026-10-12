import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { verifyOrgRole, getUserClient } from "./procedures.server";
import { z } from "zod";

const VALID_CATEGORY_SLUGS = [
  "call-handling",
  "case-management",
  "customer-communication",
  "escalations",
  "product-platform",
  "compliance",
  "attendance-admin",
  "technical-procedures",
  "security",
  "general-operations",
  "system-procedures",
  "reference-material",
] as const;

// Zod schema for AI extraction
const ProcedureExtractionSchema = z.object({
  procedures: z
    .array(
      z.object({
        classification: z.enum([
          "procedure",
          "reference",
          "expectation",
          "incident",
          "announcement",
          "noise",
        ]),
        confidence: z.number().int().min(0).max(100),
        title: z.string().min(1).max(250),
        summary: z.string().max(500).optional().nullable(),
        description: z.string().max(8000),
        suggested_category_slug: z
          .enum(VALID_CATEGORY_SLUGS)
          .optional()
          .nullable()
          .catch(undefined),
        priority: z.enum(["critical", "high", "medium", "informational"]).default("medium"),
        effective_date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .nullable()
          .catch(null),
        expiry_date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .nullable()
          .catch(null),
        source_date: z.string().max(100).optional().nullable(),
        source_author: z.string().max(150).optional().nullable(),
        source_evidence: z.string().max(500).optional().nullable(),
        possible_duplicate: z.boolean().default(false),
        contains_sensitive: z.boolean().default(false),
      }),
    )
    .max(50),
});

const IngestInput = z.object({
  organizationId: z.string().uuid(),
  rawText: z.string().min(1),
  sourceType: z
    .enum(["teams", "slack", "whatsapp", "discord", "email", "manual", "other"])
    .optional()
    .default("teams"),
  sourceChannel: z.string().optional(),
});

export async function ingestTeamsExportCore(
  dataRaw: z.infer<typeof IngestInput>,
  token: string,
) {
  const data = IngestInput.parse(dataRaw);
  if (!token) throw new Error("Unauthorized");

  const client = getUserClient(token);
  const {
    data: { user },
    error: userErr,
  } = await client.auth.getUser();
  if (userErr || !user) throw new Error("Unauthorized");

  await verifyOrgRole(client, data.organizationId, ["owner", "admin", "manager"], user.id);

  if (!data.rawText || typeof data.rawText !== "string" || data.rawText.trim() === "") {
    throw new Error("rawText is required");
  }

  const textContent = data.rawText.slice(0, 60000); // 60k cap

  // 1. Create import record
  const { data: importRow, error: importErr } = await client
    .from("imports")
    .insert({
      organization_id: data.organizationId,
      created_by: user.id,
      source_type: data.sourceType || "teams",
      character_count: textContent.length,
      status: "processing",
    })
    .select("id")
    .single();

  if (importErr || !importRow)
    throw new Error(importErr?.message || "Failed to create import record");

  try {
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured on the server.");

    const prompt = `You are an operations analyst. You receive raw chat exports and extract ONLY operational procedures, rule changes, accountability instructions, escalation paths, workflow expectations, and official management directives.

STRICTLY IGNORE: greetings, casual replies, emoji reactions, availability requests, small talk, generic questions, status updates, social chatter.

For each distinct procedure you identify, produce:
- title: a short, clear, imperative title (max 80 chars)
  - confidence: integer from 0 to 100 representing how confident you are this is actionable
  - summary: a brief 1-2 sentence summary
- description: a clean, well-structured markdown description of the procedure with the rule, who it applies to, when it takes effect, and any exceptions
- classification: MUST BE ONE OF 'procedure', 'reference', 'expectation', 'incident', 'announcement', 'noise'
- priority: ONE OF 'critical', 'high', 'medium', 'informational'
- suggested_category_slug: OPTIONAL, ONE OF: 'call-handling', 'case-management', 'customer-communication', 'escalations', 'product-platform', 'compliance', 'attendance-admin', 'technical-procedures', 'security', 'general-operations', 'system-procedures', 'reference-material'
- source_evidence: a short quote (max 500 chars) from the original message
- contains_sensitive: true if it looks like passwords, API keys, or PII.

Return STRICT JSON matching this schema: { "procedures": [ ... ] }`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000); // 60s timeout

    const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";

    const aiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: textContent }] }],
          systemInstruction: { role: "system", parts: [{ text: prompt }] },
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.1,
            responseSchema: {
              type: "OBJECT",
              properties: {
                procedures: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: {
                      classification: {
                        type: "STRING",
                        enum: [
                          "procedure",
                          "reference",
                          "expectation",
                          "incident",
                          "announcement",
                          "noise",
                        ],
                      },
                      confidence: { type: "INTEGER" },
                      title: { type: "STRING" },
                      summary: { type: "STRING" },
                      description: { type: "STRING" },
                      suggested_category_slug: {
                        type: "STRING",
                        enum: [...VALID_CATEGORY_SLUGS],
                      },
                      priority: {
                        type: "STRING",
                        enum: ["critical", "high", "medium", "informational"],
                      },
                      source_evidence: { type: "STRING" },
                      contains_sensitive: { type: "BOOLEAN" },
                    },
                    required: ["classification", "confidence", "title", "description", "priority"],
                  },
                },
              },
              required: ["procedures"],
            },
          },
        }),
      },
    );

    clearTimeout(timeout);
    if (!aiRes.ok) {
      const errText = await aiRes.text();
      throw new Error(`Gemini API error: ${aiRes.status} ${errText}`);
    }

    const aiData = await aiRes.json();
    const parts = aiData?.candidates?.[0]?.content?.parts || [];
    const textPart = parts.find((p: any) => typeof p.text === "string" && !p.thought) || parts[0];
    const contentText = textPart?.text || "{}";
    const modelVersion = aiData?.modelVersion || GEMINI_MODEL;

    // Parse JSON
    let parsedJson;
    try {
      parsedJson = JSON.parse(contentText);
    } catch {
      throw new Error("Gemini returned invalid JSON");
    }

    // Validate Schema
    const validated = ProcedureExtractionSchema.safeParse(parsedJson);
    if (!validated.success) {
      throw new Error(`Invalid schema from AI: ${validated.error.message}`);
    }

    const procedures = validated.data.procedures;
    const isNoise = procedures.length === 0;

    // Prepare drafts
    if (!isNoise) {
      const draftRows = procedures.map((p) => ({
        import_id: importRow.id,
        organization_id: data.organizationId,
        classification: p.classification,
        confidence: p.confidence,
        title: p.title,
        summary: p.summary || null,
        description: p.description,
        suggested_category_slug: p.suggested_category_slug || null,
        priority: p.priority,
        effective_date: p.effective_date || null,
        expiry_date: p.expiry_date || null,
        source_date: p.source_date || null,
        source_author: p.source_author || null,
        source_evidence: p.source_evidence || null,
        possible_duplicate: p.possible_duplicate,
        contains_sensitive: p.contains_sensitive,
        status: "pending",
        model_name: GEMINI_MODEL,
        model_version: modelVersion,
        raw_ai_output: parsedJson,
      }));

      const { error: draftsErr } = await client.from("import_drafts").insert(draftRows);
      if (draftsErr) throw new Error(draftsErr.message);
    }

    // Mark import as review
    await client
      .from("imports")
      .update({
        status: isNoise ? "completed" : "review",
        candidate_count: procedures.length,
        noise_discarded: isNoise ? 1 : 0,
        completed_at: isNoise ? new Date().toISOString() : null,
      })
      .eq("id", importRow.id);

    return { importId: importRow.id };
  } catch (error) {
    // Deterministic failure logging
    await client
      .from("imports")
      .update({
        status: "failed",
        error_message: (error as Error).message,
        completed_at: new Date().toISOString(),
      })
      .eq("id", importRow.id);
    throw error;
  }
}

export const ingestTeamsExport = createServerFn({ method: "POST" })
  .inputValidator(IngestInput)
  .handler(async (ctx) => {
    const token = getRequestHeaders().get("authorization")?.replace("Bearer ", "");
    if (!token) throw new Error("Unauthorized");
    return ingestTeamsExportCore(ctx.data, token);
  });

const GetImportInput = z.object({
  organizationId: z.string().uuid(),
  importId: z.string().uuid(),
});

export const getImport = createServerFn({ method: "GET" })
  .inputValidator(GetImportInput)
  .handler(async (ctx: any) => {
  const data = ctx.data;
  const token = getRequestHeaders().get("authorization")?.replace("Bearer ", "");
  if (!token) throw new Error("Unauthorized");

  const client = getUserClient(token);
  const {
    data: { user },
    error: userErr,
  } = await client.auth.getUser();
  if (userErr || !user) throw new Error("Unauthorized");

  await verifyOrgRole(client, data.organizationId, ["owner", "admin", "manager"], user.id);

  const { data: imp, error: err } = await client
    .from("imports")
    .select("*")
    .eq("id", data.importId)
    .eq("organization_id", data.organizationId)
    .single();

  if (err || !imp) throw new Error("Import not found");

  const { data: drafts, error: dErr } = await client
    .from("import_drafts")
    .select("*")
    .eq("import_id", data.importId)
    .order("created_at", { ascending: true });

  if (dErr) throw new Error(dErr.message);

  return { importRecord: imp, drafts: drafts || [] };
});

const GetImportsInput = z.object({
  organizationId: z.string().uuid(),
});

export const getImports = createServerFn({ method: "GET" })
  .inputValidator(GetImportsInput)
  .handler(async (ctx: any) => {
  const data = ctx.data;
  const token = getRequestHeaders().get("authorization")?.replace("Bearer ", "");
  if (!token) throw new Error("Unauthorized");

  const client = getUserClient(token);
  const {
    data: { user },
    error: userErr,
  } = await client.auth.getUser();
  if (userErr || !user) throw new Error("Unauthorized");

  await verifyOrgRole(client, data.organizationId, ["owner", "admin", "manager"], user.id);

  const { data: imports, error } = await client
    .from("imports")
    .select("*")
    .eq("organization_id", data.organizationId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return imports || [];
});

const ApproveDraftInput = z.object({
  organizationId: z.string().uuid(),
  draftId: z.string().uuid(),
  title: z.string().min(1),
  summary: z.string().optional().nullable(),
  description: z.string().min(1),
  priority: z.enum(["critical", "high", "medium", "informational"]),
  categoryId: z.string().uuid().optional().nullable(),
  effectiveDate: z.string().optional().nullable(),
  expiryDate: z.string().optional().nullable(),
  acknowledgmentRequired: z.boolean().default(true),
});

export const approveImportDraft = createServerFn({ method: "POST" })
  .inputValidator(ApproveDraftInput)
  .handler(async (ctx: any) => {
  const data = ctx.data;
  const token = getRequestHeaders().get("authorization")?.replace("Bearer ", "");
  if (!token) throw new Error("Unauthorized");

  const client = getUserClient(token);
  const {
    data: { user },
    error: userErr,
  } = await client.auth.getUser();
  if (userErr || !user) throw new Error("Unauthorized");

  await verifyOrgRole(client, data.organizationId, ["owner", "admin", "manager"], user.id);

  const { data: res, error } = await client.rpc("atomic_approve_draft", {
    _draft_id: data.draftId,
    _org_id: data.organizationId,
    _title: data.title,
    _summary: data.summary,
    _description: data.description,
    _priority: data.priority,
    _category_id: data.categoryId || null,
    _effective_date: data.effectiveDate || null,
    _expiry_date: data.expiryDate || null,
    _ack_required: Boolean(data.acknowledgmentRequired),
  });

  if (error) throw new Error(error.message);
  return { procedureId: res };
});

const RejectDraftInput = z.object({
  organizationId: z.string().uuid(),
  draftId: z.string().uuid(),
  notes: z.string().default("Rejected by reviewer"),
});

export const rejectImportDraft = createServerFn({ method: "POST" })
  .inputValidator(RejectDraftInput)
  .handler(async (ctx: any) => {
  const data = ctx.data;
  const token = getRequestHeaders().get("authorization")?.replace("Bearer ", "");
  if (!token) throw new Error("Unauthorized");

  const client = getUserClient(token);
  const {
    data: { user },
    error: userErr,
  } = await client.auth.getUser();
  if (userErr || !user) throw new Error("Unauthorized");

  await verifyOrgRole(client, data.organizationId, ["owner", "admin", "manager"], user.id);

  const { error } = await client.rpc("atomic_reject_draft", {
    _draft_id: data.draftId,
    _org_id: data.organizationId,
    _notes: data.notes,
  });

  if (error) throw new Error(error.message);
  return { success: true };
});
