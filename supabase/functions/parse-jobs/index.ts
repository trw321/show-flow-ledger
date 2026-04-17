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
- Start Date → date AND startTime. Often contains both (e.g. "3/22/26 07:00 AM"). Extract date as YYYY-MM-DD and time as startTime. 2-digit years like "3/22/26" = 2026-03-22. NEVER default to today's date.
- Line Notes → parse for CB/split info (see CRITICAL RULES below)
- Employer → client
- Payroll Co. → payrollCompany
- Job Site + Location → venue (combine if both present)
- Show → name (event/show name)
- Rate → hourlyRate (number only, e.g. $55.72 → 55.72)
- Steward → steward
- Skill, Job Notes, Contract, Dress Code → combine into notes

════════════════════════════════════════
CRITICAL RULE — CALLBACKS (CB):
════════════════════════════════════════
If Line Notes contains "CB", "C/B", "CB's", or "C/B's":
  1. Keep the PARENT job using the Start Date as-is.
  2. For EACH callback date found, create an ADDITIONAL separate job entry.
  3. Each CB job copies ALL fields from the parent (same name, client, payrollCompany, venue, hourlyRate, steward, jobNumber) but with the callback date.

⚠️ ONE INPUT ROW WITH CB DATES = MULTIPLE JOBS IN OUTPUT. Do not skip the CB jobs.

CB date parsing:
- No year on CB date (e.g. "3/24") → inherit year from parent date
- Comma-separated dates (e.g. "CB 3/24, 3/25") → one job per date
- Time after CB date (e.g. "CB 3/24 0900") → that time is startTime for that CB job only
- "CB thru 3/18" with parent date 3/15 → jobs on 3/15, 3/16, 3/17, 3/18 (every day inclusive)
- Text after dates that is NOT a time (e.g. "FOR LOAD OUT") → put in notes on all CB jobs

WORKED EXAMPLE:
  Input row: Start Date "3/22/26 07:00 AM", Line Notes "CB 3/24, 3/25 FOR LOAD OUT"
  Output → 3 jobs:
    Job 1: date=2026-03-22, startTime=07:00 AM (parent)
    Job 2: date=2026-03-24, startTime=07:00 AM, notes="FOR LOAD OUT" (CB)
    Job 3: date=2026-03-25, startTime=07:00 AM, notes="FOR LOAD OUT" (CB)

WORKED EXAMPLE 2:
  Input row: Start Date "3/15/26 08:00 AM", Line Notes "CB thru 3/18/26"
  Output → 4 jobs: dates 2026-03-15, 2026-03-16, 2026-03-17, 2026-03-18

════════════════════════════════════════
SPLIT SHIFT RULE:
════════════════════════════════════════
If Line Notes contains a time but NO date (e.g. "1030PM"), create TWO jobs for the same date:
  Job 1: startTime from Start Date column
  Job 2: startTime = the time in Line Notes
Example: Line Notes "1030PM", Start Date "3/22/26 08:00 AM" → Job 1: 08:00 AM | Job 2: 10:30 PM

If Line Notes is empty or plain text with no CB and no extra time, ignore it.

Always normalize times to "HH:MM AM/PM" (e.g. "0800" → "08:00 AM", "1030PM" → "10:30 PM").
Status: "upcoming" for future dates, "completed" for past dates.`,
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
