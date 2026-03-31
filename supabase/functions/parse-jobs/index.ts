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
    const { text } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const today = new Date().toISOString().split("T")[0];

    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            {
              role: "system",
              content: `You are a job history parser for an AV technician's bookkeeping app. Parse pasted text into structured job data. Today's date is ${today}.

CRITICAL JOB NUMBER FORMAT: Job entries begin with a job number in YYYY-NNNN format (e.g. "2026-0959" — year 2026, job 0959). The date for that job comes immediately after the job number. Always store the FULL job number (e.g. "2026-0959"), never strip it to just the last digits.

CRITICAL DATE RULE: Extract the EXACT date from the source text for each job. The date appears right after the YYYY-NNNN job number. Dates may also appear in many formats (e.g. "2/2/26", "Feb 2", "02/02/2026"). NEVER default to today's date. For 2-digit years like "2/2/26", assume 2000s (= 2026-02-02).

Extract these fields for each job:
- jobNumber: the FULL job/dispatch number in YYYY-NNNN format (e.g. "2026-0496"). Never truncate it.
- date: in YYYY-MM-DD format. MUST come from the text, not assumed.
- startTime: call/start time (e.g. "08:00 AM")
- endTime: wrap/end time if present (e.g. "05:00 PM")
- client: production company or project name (e.g. "METRO MEDIA PRODUCTIONS INC")
- name: the event/show name (e.g. "PELOSI DINNER")
- payrollCompany: payroll agency if mentioned (e.g. "UNION PAYROLL AGENCY INC")
- venue: venue/location (e.g. "Marriott - 4th & Mission")
- hourlyRate: hourly rate as a number (e.g. $55.72 → 55.72)
- steward: steward or contact person name (e.g. "DAWN ROTH-GOLDEN")
- parkingCost: parking cost as a number if mentioned
- status: "upcoming" for future dates, "completed" for past dates
- notes: any remaining info — room/salon numbers, setup descriptions, special instructions like "BRING 2 FORMS OF ID", rate codes, etc.

Common AV industry text formats:
- Job numbers like "2026-0496"
- Times like "08:00 AM" / "05:00 PM"
- Concatenated text without clear delimiters
- Rate codes like "2023-2028 BASIC ENTERTAINMENT"
- Setup descriptions like "SETUP: HANG, FOCUS CB FOR OUTT ELEC X"
- "SAME DAY CB" or "same day callback" means a callback for more work — it may be on the same day or a different date. Treat it as a separate job entry. The CB time is the START time of the callback job. End times are rarely provided — leave endTime empty unless explicitly stated.

Be flexible — data may be from tables, lists, emails, or messy concatenated text.`,
            },
            { role: "user", content: text },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "create_jobs",
                description: "Create parsed job entries from pasted text",
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
                          startTime: { type: "string", description: "Start/call time e.g. 08:00 AM" },
                          endTime: { type: "string", description: "End/wrap time e.g. 05:00 PM" },
                          name: { type: "string", description: "Event/show name" },
                          client: { type: "string", description: "Production company or project name" },
                          payrollCompany: { type: "string", description: "Payroll agency name" },
                          venue: { type: "string", description: "Venue or location" },
                          hourlyRate: { type: "number", description: "Hourly rate" },
                          steward: { type: "string", description: "Steward or contact person" },
                          parkingCost: { type: "number", description: "Parking cost if mentioned" },
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
      throw new Error("AI gateway error");
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];

    if (!toolCall) {
      throw new Error("Failed to parse jobs");
    }

    const parsed = JSON.parse(toolCall.function.arguments);

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("parse-jobs error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
