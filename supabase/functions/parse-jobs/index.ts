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

════════════════════════════════════════
DATA FORMAT — each job record looks like this:
════════════════════════════════════════
  [Job Number]
  [Start Date with call time]

  [Line Notes] TAB [Skill] TAB [Employer] TAB [Payroll Co.] TAB [Job Site] TAB [Show] TAB [Location] TAB [Job Notes] TAB [Contract] TAB [Rate] TAB [Dress Code] TAB [Steward]

Example record:
  2026-0929
  3/17/26 01:00 PM

  CB 3/18, 3/20	P VIDEO WALL	FREEMAN AV	FREEMAN AV	MOSCONE SOUTH	RSA CONF	BOOTH 5744	NOTES	CONTRACT	$55.72	NWB	CESAR ESCOBAR

FIELD MAPPINGS:
- Job Number → jobNumber (keep full YYYY-NNNN format, e.g. "2026-0929")
- Start Date line → date (YYYY-MM-DD) AND startTime. 2-digit year "3/17/26" = 2026-03-17. NEVER use today's date.
- Line Notes (first tab-column on the data line) → parse for CB/split (see rules below)
- Employer → client
- Payroll Co. → payrollCompany
- Job Site + Location → venue (combine both)
- Show → name
- Rate → hourlyRate (strip $, e.g. $55.72 → 55.72)
- Steward → steward
- Skill + Job Notes + Contract + Dress Code → combine into notes

════════════════════════════════════════
CRITICAL RULE — CALLBACKS:
════════════════════════════════════════
If Line Notes contains "CB", "C/B", "CB's", "C/B's", or "SAME DAY CB":
  1. Always output the PARENT job (using the Start Date).
  2. For EACH callback date, output an ADDITIONAL job copying all parent fields but with the CB date.
  ⚠️ ONE RECORD WITH CB DATES = MULTIPLE JOBS. Never skip CB jobs.

CB variations:
- "CB 3/18, 3/20, 3/26, 3/27" → 4 extra jobs on those dates (inherit year from parent)
- "CB 3/15 @10A FOR LOAD OUT" → CB job on 3/15, startTime=10:00 AM, notes="FOR LOAD OUT"
- "CB 3/15 0900" → CB job on 3/15, startTime=09:00 AM
- "CB thru 3/18" (parent date 3/15) → jobs on 3/15, 3/16, 3/17, 3/18 (every day inclusive)
- "SAME DAY CB, 10:00PM FOR LOAD OUT" → second job on SAME date as parent, startTime=10:00 PM, notes="FOR LOAD OUT"
- Text after dates that is not a time (e.g. "FOR LOAD OUT") → goes in notes on CB jobs

WORKED EXAMPLE A — multiple CB dates:
  Job: 2026-0929 | Start Date: 3/17/26 01:00 PM | Line Notes: "CB 3/18, 3/20, 3/26, 3/27"
  → Output 5 jobs: dates 2026-03-17, 2026-03-18, 2026-03-20, 2026-03-26, 2026-03-27
  → All share same name/client/venue/rate/startTime (01:00 PM)

WORKED EXAMPLE B — same-day CB with time:
  Job: 2026-0902 | Start Date: 3/14/26 10:00 AM | Line Notes: "SAME DAY CB, 10:00PM FOR LOAD OUT"
  → Output 2 jobs: both date=2026-03-14
    Job 1: startTime=10:00 AM
    Job 2: startTime=10:00 PM, notes="FOR LOAD OUT"

WORKED EXAMPLE C — CB with @ time:
  Job: 2026-0864 | Start Date: 3/13/26 07:00 AM | Line Notes: "CB 3/15 @10A FOR LOAD OUT"
  → Output 2 jobs:
    Job 1: date=2026-03-13, startTime=07:00 AM (parent)
    Job 2: date=2026-03-15, startTime=10:00 AM, notes="FOR LOAD OUT" (CB)

════════════════════════════════════════
SPLIT SHIFT RULE:
════════════════════════════════════════
If Line Notes has a time but NO date and NO "CB" keyword, create two jobs on the same date:
  Job 1: startTime from Start Date
  Job 2: startTime = the time in Line Notes

If Line Notes is empty or plain descriptive text with no CB and no time, ignore it.

Normalize all times to "HH:MM AM/PM" format (e.g. "0800"→"08:00 AM", "1030PM"→"10:30 PM", "@10A"→"10:00 AM", "10:00PM"→"10:00 PM").
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
