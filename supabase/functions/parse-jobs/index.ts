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

NOTE: Line Notes may itself span multiple lines (the website wraps long cells). Treat all lines before the first TAB-separated data as part of Line Notes.

FIELD MAPPINGS:
- Job Number → jobNumber (keep full YYYY-NNNN format, e.g. "2026-0929")
- Start Date line → date (YYYY-MM-DD) AND startTime. 2-digit year "3/17/26" = 2026-03-17. NEVER use today's date.
- Line Notes → parse for end time / CB / split shift (see rules below)
- Employer → client
- Payroll Co. → payrollCompany
- Job Site + Location → venue (combine both)
- Show → name
- Rate → hourlyRate (strip $, e.g. $55.72 → 55.72)
- Steward → steward
- Skill + Job Notes + Contract + Dress Code → combine into notes

════════════════════════════════════════
LINE NOTES — END TIME RULE:
════════════════════════════════════════
If Line Notes contains a standalone time AND also contains CB info → the time is an endTime for the parent job (not a split shift).
  Example: Line Notes "09:00 PM\nCB THRU 10/7..." → parent gets endTime=09:00 PM, then CB jobs are created normally.

════════════════════════════════════════
CRITICAL RULE — CALLBACKS:
════════════════════════════════════════
If Line Notes contains "CB", "C/B", "CB's", "C/B's", or "SAME DAY CB":
  1. Always output the PARENT job (using the Start Date).
  2. For EACH callback date, output an ADDITIONAL job copying all parent fields but with the CB date.
  ⚠️ ONE RECORD WITH CB DATES = MULTIPLE JOBS. Never skip CB jobs.

CB variations:
- "CB 3/18, 3/20, 3/26, 3/27" → extra jobs on each date (inherit year from parent)
- "CB 2/6," → trailing comma means nothing follows, treat as single CB date 2/6
- "CB THRU 10/7" (parent date 10/5) → jobs on 10/5, 10/6, 10/7 (every day inclusive)
- "CB THRU 10/7 THEN 10/17 & 10/18" → jobs on 10/5–10/7, PLUS 10/17 and 10/18 ("THEN" and "&" add more dates)
- "CB THRU 5/30, DARK 5/27" (parent date 5/25) → jobs on 5/25, 5/26, 5/28, 5/29, 5/30 — DARK means day off, skip that date entirely
- "CB 3/15 @10A FOR LOAD OUT" → CB job on 3/15, startTime=10:00 AM, notes="FOR LOAD OUT"
- "CB 2/3 @10PM FOR OUT" → CB job on 2/3, startTime=10:00 PM, notes="FOR OUT"
- "CB 3/15 0900" → CB job on 3/15, startTime=09:00 AM
- Any descriptive prefix before CB (e.g. "IN/OUT: HANG, FOCUS CB 2/3 @10PM FOR OUT") → prefix text goes in parent notes, CB is parsed normally
- "SAME DAY CB, 10:00PM FOR LOAD OUT" → second job on SAME date, startTime=10:00 PM, notes="FOR LOAD OUT"
- "CB @ 1030PM FOR LOAD OUT" or "CB, 10:00PM FOR LOAD OUT" or "CB @ 10:30PM" → same-day CB at that time. "SAME DAY" is optional — if CB has a time but NO date, it is always same-day. Any plain text before "CB" (e.g. "ASSIST ALL DEPTS. AS NEEDED") goes into the parent job's notes.
- Times may use letter O instead of zero (e.g. "1O30PM" = 10:30 PM) — treat O as 0.
- Times may use letter O instead of zero (e.g. "1O30PM" = 10:30 PM) — treat O as 0.
- Text after dates that is not a time/date (e.g. "FOR LOAD OUT") → goes in notes on those CB jobs only

WORKED EXAMPLE A — multiple CB dates:
  Job: 2026-0929 | Start: 3/17/26 01:00 PM | Line Notes: "CB 3/18, 3/20, 3/26, 3/27"
  → 5 jobs: 2026-03-17, 2026-03-18, 2026-03-20, 2026-03-26, 2026-03-27 (all startTime=01:00 PM)

WORKED EXAMPLE B — end time + CB THRU + THEN + &:
  Job: 2025-2952 | Start: 10/5/25 08:00 AM | Line Notes: "09:00 PM\nCB THRU 10/7 THEN 10/17 & 10/18 FOR LOAD OUT"
  → 6 jobs:
    Job 1: date=2025-10-05, startTime=08:00 AM, endTime=09:00 PM (parent)
    Job 2: date=2025-10-06, startTime=08:00 AM (CB thru)
    Job 3: date=2025-10-07, startTime=08:00 AM (CB thru)
    Job 4: date=2025-10-17, startTime=08:00 AM, notes="FOR LOAD OUT"
    Job 5: date=2025-10-18, startTime=08:00 AM, notes="FOR LOAD OUT"

WORKED EXAMPLE C — same-day CB:
  Job: 2026-0902 | Start: 3/14/26 10:00 AM | Line Notes: "SAME DAY CB, 10:00PM FOR LOAD OUT"
  → 2 jobs: both 2026-03-14 — Job 1: 10:00 AM, Job 2: 10:00 PM, notes="FOR LOAD OUT"

WORKED EXAMPLE D — CB with @ time:
  Job: 2026-0864 | Start: 3/13/26 07:00 AM | Line Notes: "CB 3/15 @10A FOR LOAD OUT"
  → 2 jobs: Job 1: 2026-03-13 07:00 AM | Job 2: 2026-03-15 10:00 AM, notes="FOR LOAD OUT"

════════════════════════════════════════
SPLIT SHIFT RULE:
════════════════════════════════════════
If Line Notes has a standalone time but NO CB keyword and NO other date info → split shift: create two jobs on the same date.
  Job 1: startTime from Start Date | Job 2: startTime = the time in Line Notes

If Line Notes is empty or plain descriptive text with no CB and no time (e.g. "ADDED FOR SHOWRUN/OUT. WILL WORK WITH ROAD TECH - REPLACE ALEX ZEH"), put it in the job's notes field and create only the one parent job.

Normalize all times to "HH:MM AM/PM" (e.g. "0800"→"08:00 AM", "1030PM"→"10:30 PM", "@10A"→"10:00 AM").
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
