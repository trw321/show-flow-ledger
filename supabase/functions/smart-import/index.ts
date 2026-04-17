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
    const { text, imageBase64, imageMimeType } = await req.json();
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");

    const today = new Date().toISOString().split("T")[0];
    let inputText = text;

    // Step 1: Extract text from image if provided
    if (imageBase64) {
      const visionResp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [{
            role: "user",
            content: [
              {
                type: "text",
                text: "Extract all text from this image exactly as it appears. Preserve columns using tabs and rows using newlines. Output only the raw extracted text, nothing else."
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:${imageMimeType || "image/jpeg"};base64,${imageBase64}`,
                  detail: "high"
                }
              }
            ]
          }],
          max_tokens: 4000
        })
      });
      if (!visionResp.ok) {
        const t = await visionResp.text();
        console.error("Vision error:", visionResp.status, t);
        throw new Error("Failed to read image");
      }
      const visionData = await visionResp.json();
      inputText = visionData.choices[0]?.message?.content ?? "";
    }

    if (!inputText?.trim()) throw new Error("No text to parse");

    // Step 2: Classify + parse in one call
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You are a smart import assistant for an AV technician's bookkeeping app. Today's date is ${today}.

Classify the input, then parse it accordingly.

CLASSIFICATION:
- "jobs": dispatch/work schedule with job numbers (YYYY-NNNN), employer names, dates
- "income": bank statement, pay stub, or payment records (dollar amounts + dates)
- "hours": scratch notes for logging hours (date + time range + venue)

═══════════════════════════════
IF "jobs":
═══════════════════════════════
DATA FORMAT — each record spans multiple lines:
  [Job Number]
  [Start Date with call time]

  [Line Notes] TAB [Skill] TAB [Employer] TAB [Payroll Co.] TAB [Job Site] TAB [Show] TAB [Location] TAB [Job Notes] TAB [Contract] TAB [Rate] TAB [Dress Code] TAB [Steward]

Line Notes may span multiple lines before the first tab-separated data.

FIELDS: Job Number→jobNumber | Start Date→date+startTime | Employer→client | Payroll Co.→payrollCompany
Job Site+Location→venue | Show→name | Rate→hourlyRate (strip $) | Steward→steward
Skill+Job Notes+Contract+Dress Code→notes | 2-digit year "3/17/26"=2026-03-17

LINE NOTES:
- Standalone time + CB present → time is endTime for parent
- Standalone time only, no CB → split shift (two jobs, same date, different start times)
- Plain descriptive text → goes in notes, one job only

CALLBACKS ⚠️ ONE RECORD WITH CB = MULTIPLE JOBS — never skip:
- "CB 3/18, 3/20" → extra job per date (inherit year from parent)
- "CB 2/6," trailing comma → single date 2/6
- "CB THRU 10/7" (parent 10/5) → jobs on 10/5, 10/6, 10/7
- "CB THRU 10/7 THEN 10/17 & 10/18 FOR LOAD OUT" → 10/5–10/7 plus 10/17, 10/18, notes="FOR LOAD OUT"
- "DARK [date]" in a range → skip that date
- "CB 3/15 @10A FOR LOAD OUT" → CB on 3/15, startTime=10:00 AM, notes="FOR LOAD OUT"
- "CB 2/3 @10PM FOR OUT" → CB on 2/3, startTime=10:00 PM, notes="FOR OUT"
- "CB @ 10PM" / "SAME DAY CB, 10PM" / "CB, 10PM" (no date) → same-day CB at that time
- Prefix text before CB (e.g. "IN/OUT: HANG, FOCUS CB 2/3 @10PM") → prefix in parent notes
- "O" in times = zero (1O30PM = 10:30 PM)
Status: "upcoming" for future, "completed" for past.

═══════════════════════════════
IF "income":
═══════════════════════════════
Extract deposits/payments only (ignore withdrawals, fees):
- client: who paid (employer/payroll company)
- description: what it's for
- amount: positive dollar amount
- date: YYYY-MM-DD
- status: "paid"

═══════════════════════════════
IF "hours":
═══════════════════════════════
Entries are separated by blank lines (one or more empty lines). Each entry does NOT need to start with a date — the fields can appear in any order within the entry.

For each blank-line-separated entry, extract:
- date: find any line matching date patterns (MM-DD-YY, MM/DD/YY, M/D/YY, etc.) → YYYY-MM-DD. "10-6-25" = 2025-10-06
- startTime / endTime: find a time range line like "8am ... 7p" or "9am-5pm" or "8am = - (1hr walk away) 7p" → "08:00 AM" / "07:00 PM"
- mealType: "walk away" or "WA" → "YWA"; "on the clock" or "NWA" → "NWA"
- hoursWorked:
  - If "N+M" format (e.g. "8+2"): N regular + M overtime = N+M total hours worked BEFORE meal deduction
  - Then apply meal deduction: YWA = -1hr, NWA = -0.5hr
  - If only a time range: calculate end - start, then apply deduction
- venue: any line that looks like a venue name (not a date, time, number, or emoji)
- steward: person's name if present (e.g. "Rein ratsep")
- hourlyRate: dollar amount if present (e.g. "$55.72" → 55.72)

EXAMPLE:
  "moscone c Rein ratsep $55.72\n10-6-25\n8am = - (1hr walk away) 7p\n8+2\n445+ 167 = 612\n💰"
  → date=2025-10-06, venue="moscone c", steward="Rein ratsep", hourlyRate=55.72
    startTime=08:00 AM, endTime=07:00 PM, mealType=YWA
    hoursWorked = 8+2 = 10, minus 1hr YWA = 9.0 (or use 10 if "8+2" already accounts for break)`
          },
          { role: "user", content: inputText }
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "import_data",
              description: "Return classified and parsed data",
              parameters: {
                type: "object",
                properties: {
                  type: { type: "string", enum: ["jobs", "income", "hours"] },
                  jobs: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        jobNumber: { type: "string" },
                        date: { type: "string" },
                        startTime: { type: "string" },
                        endTime: { type: "string" },
                        name: { type: "string" },
                        client: { type: "string" },
                        payrollCompany: { type: "string" },
                        venue: { type: "string" },
                        hourlyRate: { type: "number" },
                        steward: { type: "string" },
                        parkingCost: { type: "number" },
                        status: { type: "string", enum: ["upcoming", "in-progress", "completed", "cancelled"] },
                        notes: { type: "string" }
                      },
                      required: ["name", "client", "venue", "date", "status"]
                    }
                  },
                  income: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        client: { type: "string" },
                        description: { type: "string" },
                        amount: { type: "number" },
                        date: { type: "string" },
                        status: { type: "string", enum: ["pending", "paid", "overdue"] }
                      },
                      required: ["client", "description", "amount", "date", "status"]
                    }
                  },
                  hourUpdates: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        date: { type: "string" },
                        startTime: { type: "string" },
                        endTime: { type: "string" },
                        hoursWorked: { type: "number" },
                        venue: { type: "string" },
                        steward: { type: "string" },
                        hourlyRate: { type: "number" },
                        mealType: { type: "string", enum: ["YWA", "NWA"] }
                      },
                      required: ["date"]
                    }
                  }
                },
                required: ["type"],
                additionalProperties: false
              }
            }
          }
        ],
        tool_choice: { type: "function", function: { name: "import_data" } }
      })
    });

    if (!response.ok) {
      const t = await response.text();
      console.error("AI error:", response.status, t);
      throw new Error("AI error");
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) throw new Error("Failed to classify and parse");

    const parsed = JSON.parse(toolCall.function.arguments);
    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (err) {
    console.error("smart-import error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
