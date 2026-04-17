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
              content: `You are a job history parser for an AV technician's bookkeeping app. Parse pasted text into structured job data. Today's date is ${today}.

COLUMN ORDER (tab-separated from dispatch website):
Job # | Start Date | Line Notes | Skill | Employer | Payroll Co. | Job Site | Show | Location | Job Notes | Contract | Rate | Dress Code | Steward

FIELD MAPPINGS:
- Job # → jobNumber (FULL number in YYYY-NNNN format, e.g. "2026-0959" — never truncate)
- Start Date → date (YYYY-MM-DD). NEVER default to today. For 2-digit years like "2/2/26" assume 2000s (= 2026-02-02).
- Employer → client
- Payroll Co. → payrollCompany
- Job Site + Location → venue (combine if both present)
- Show → name (event/show name)
- Rate → hourlyRate (number only, e.g. $55.72 → 55.72)
- Steward → steward
- Skill, Job Notes, Contract, Dress Code → combine into notes

LINE NOTES PARSING — this is critical, read carefully:
The "Line Notes" column contains the start time for the main shift (e.g. "0800" or "8:00AM"). It may also contain callback or split-shift info:

RULE 1 — CALLBACK (CB): If Line Notes contains "CB" or "C/B" followed by one or more dates, create a SEPARATE job entry for EACH callback date. The callback job copies all fields from the parent row (same show, employer, payroll, venue, rate, steward) but uses the callback date. The CB time after the date (if any) is the startTime of that callback shift.
Examples:
  "0800 CB 3/15/26" → Job 1: date=original, startTime=08:00 AM | Job 2: date=2026-03-15, startTime unknown (leave blank)
  "0800 CB 3/15/26 0900" → Job 1: date=original, startTime=08:00 AM | Job 2: date=2026-03-15, startTime=09:00 AM
  "0800 CB 3/15/26 C/B 3/16/26" → 3 jobs total

RULE 2 — SPLIT SHIFT: If Line Notes contains a time but NO date after it (just a raw time like "1030PM" or "22:30"), that is a split shift — create TWO job entries for the SAME date:
  - Job 1: startTime = main call time from beginning of Line Notes
  - Job 2: startTime = the split time found later in Line Notes
  Both jobs share the same date and all other fields.
Example: "0800 1030PM" → Job 1: startTime=08:00 AM | Job 2: startTime=10:30 PM (same date)

RULE 3 — PLAIN START TIME: If Line Notes is just a time with no CB or split, it's simply the startTime.

Always normalize times to "HH:MM AM/PM" format (e.g. "0800" → "08:00 AM", "1030PM" → "10:30 PM").
Status: "upcoming" for future dates, "completed" for past dates.
Be flexible — data may be messy concatenated text from a copied table.`,
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
