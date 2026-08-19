import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { base64: imageBase64, mimeType } = await req.json();

    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not configured");
    }

    const today = new Date().toISOString().split("T")[0];

    const response = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [
            {
              role: "system",
              content: `You are a job history parser for an AV technician's bookkeeping app. Parse the image into structured job data. Today's date is ${today}.

Extract these fields for each job found in the image:
- jobNumber: the FULL job/dispatch number in YYYY-NNNN format (e.g. "2026-0496"). Never truncate it.
- date: in YYYY-MM-DD format. For 2-digit years like "2/21/26", assume 2000s (2026-02-21).
- startTime: call/start time (e.g. "08:00 AM")
- endTime: wrap/end time if present (e.g. "05:00 PM")
- client: production company or project name
- name: the event/show name
- payrollCompany: payroll agency if mentioned
- venue: venue/location
- hourlyRate: hourly rate as a number
- steward: steward or contact person name
- parkingCost: parking cost as a number if mentioned
- status: "upcoming" for future dates, "completed" for past dates
- notes: any remaining info

Industry terminology:
- "SAME DAY CB" or "same day callback" means a callback for more work — it may be on the same day or a different date. Treat it as a separate job entry. The CB time is the START time of the callback job. End times are rarely provided — leave endTime empty unless explicitly stated.

CALLBACKS ⚠️ ONE RECORD WITH CB = MULTIPLE JOBS — never skip:
- "CB 3/18, 3/20" → extra job per date (inherit year from parent)
- "CB 3/24, 3/25 FOR LOAD OUT" → extra jobs on 3/24 AND 3/25; "FOR LOAD OUT" is trailing note text (not a date) → notes on both CB jobs. Output = 3 jobs total.
- "CB 2/6," trailing comma → single date 2/6
- "CB THRU 10/7" (parent 10/5) → jobs on 10/5, 10/6, 10/7 (every calendar day in between, inclusive)
- "CB THRU 10/7 THEN 10/17 & 10/18 FOR LOAD OUT" → 10/5–10/7 (one job per day) plus 10/17, 10/18, notes="FOR LOAD OUT" on the trailing dates. Output = 5 jobs total.
- "CB THRU 8/27 AND THEN 8/30, NITE" (parent 8/22) → one job per day 8/22–8/27 (6 jobs) plus 8/30 with notes="NITE". Output = 7 jobs total.
- "DARK [date]" in a range → skip that date, don't create a job for it
- "CB 3/15 @10A FOR LOAD OUT" → CB on 3/15, startTime=10:00 AM, notes="FOR LOAD OUT"
- "CB @ 10PM" / "SAME DAY CB, 10PM" (no date) → same-day CB at that time

Be flexible — the image may be a screenshot of a dispatch email, a schedule, a table, or a photo of a printed document.`,
            },
            {
              role: "user",
              content: [
                {
                  type: "image_url",
                  image_url: {
                    url: `data:${mimeType || "image/jpeg"};base64,${imageBase64}`,
                  },
                },
                {
                  type: "text",
                  text: "Extract all job information from this image.",
                },
              ],
            },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "create_jobs",
                description: "Create parsed job entries from the image",
                parameters: {
                  type: "object",
                  properties: {
                    jobs: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          jobNumber: { type: "string", description: "Full job/dispatch number in YYYY-NNNN format (e.g. 2026-0496)" },
                          date: { type: "string", description: "Date in YYYY-MM-DD format" },
                          startTime: { type: "string", description: "Start/call time" },
                          endTime: { type: "string", description: "End/wrap time" },
                          name: { type: "string", description: "Event/show name" },
                          client: { type: "string", description: "Production company" },
                          payrollCompany: { type: "string", description: "Payroll agency" },
                          venue: { type: "string", description: "Venue or location" },
                          hourlyRate: { type: "number", description: "Hourly rate" },
                          steward: { type: "string", description: "Steward or contact" },
                          parkingCost: { type: "number", description: "Parking cost" },
                          status: { type: "string", enum: ["upcoming", "in-progress", "completed", "cancelled"] },
                          notes: { type: "string", description: "Additional notes" },
                        },
                        required: ["name", "client", "venue", "date", "status"],
                      },
                    },
                  },
                  required: ["jobs"],
                  additionalProperties: false,
                },
              },
            },
          ],
          tool_choice: {
            type: "function",
            function: { name: "create_jobs" },
          },
        }),
      }
    );

    if (!response.ok) {
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, please try again shortly." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error("AI gateway error");
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];

    if (!toolCall) {
      throw new Error("Failed to parse jobs from image");
    }

    const parsed = JSON.parse(toolCall.function.arguments);

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("parse-job-image error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
