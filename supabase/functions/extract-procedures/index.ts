// Edge function: extract operational procedures from a chat export using Lovable AI
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You are an operations analyst. You receive raw chat exports (Microsoft Teams, Slack, WhatsApp, etc.) and extract ONLY operational procedures, rule changes, accountability instructions, escalation paths, workflow expectations, and official management directives.

STRICTLY IGNORE: greetings, casual replies, emoji reactions, availability requests ("I'm out today"), small talk, generic questions, status updates, social chatter.

For each distinct procedure you identify, produce:
- title: a short, clear, imperative title (max 80 chars)
- description: a clean, well-structured markdown description of the procedure with the rule, who it applies to, when it takes effect, and any exceptions
- category: one of "Call Handling", "Omni Channel", "Escalations", "Customer Commitments", "Remote Support", "Communication Standards", "Onsite Dispatch", "Database Restrictions", "Attendance & Accountability", "Training", "Security", "Operations"
- priority: one of "critical", "high", "medium", "informational"
- source_reference: a short quote (max 200 chars) from the original message that this procedure was extracted from

Return STRICT JSON only, no prose, no code fences. Shape: { "procedures": [ { "title", "description", "category", "priority", "source_reference" } ] }
If nothing operational is found, return { "procedures": [] }.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { raw_text } = await req.json();
    if (!raw_text || typeof raw_text !== "string") {
      return new Response(JSON.stringify({ error: "raw_text required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const truncated = raw_text.slice(0, 60000);

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: truncated },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (aiRes.status === 429) {
      return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again shortly." }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (aiRes.status === 402) {
      return new Response(JSON.stringify({ error: "AI credits exhausted. Add credits to continue." }), {
        status: 402,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error("AI gateway error", aiRes.status, errText);
      return new Response(JSON.stringify({ error: `AI request failed (${aiRes.status})` }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await aiRes.json();
    const content = data?.choices?.[0]?.message?.content ?? "{}";
    let parsed: { procedures?: unknown[] } = {};
    try {
      parsed = JSON.parse(content);
    } catch {
      const m = content.match(/\{[\s\S]*\}/);
      if (m) parsed = JSON.parse(m[0]);
    }

    return new Response(JSON.stringify({ procedures: parsed.procedures ?? [] }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("extract-procedures error", e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
