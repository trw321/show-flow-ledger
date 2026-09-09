import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { callToolWithGateway, GatewayError } from "../_shared/lovable-ai.ts";

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

    const today = new Date().toISOString().split("T")[0];

    const systemPrompt = `You are a job history parser for an AV technician's bookkeeping app. Today's date is ${today}.

Each block of text you receive is a single pre-expanded job record — output exactly one job per block.

════════════════════════════════════════
DATA FORMAT:
════════════════════════════════════════
  [Job Number]
  [Start Date with call time]

  [Line Notes] TAB [Skill] TAB [Employer] TAB [Payroll Co.] TAB [Job Site] TAB [Show] TAB [Location] TAB [Job Notes] TAB [Contract] TAB [Rate] TAB [Dress Code] TAB [Steward]

Line Notes may span multiple lines before the first TAB-separated field.

FIELD MAPPINGS:
- Job Number → jobNumber (YYYY-NNNN format, e.g. "2026-0929")
- Start Date line → date (YYYY-MM-DD) AND startTime. 2-digit year "3/17/26" = 2026-03-17. NEVER use today's date.
- Employer → client
- Payroll Co. → payrollCompany
- Job Site + Location → venue (combine both)
- Show → name
- Rate → hourlyRate (strip $, e.g. $55.72 → 55.72)
- Steward → steward
- Skill + Job Notes + Contract + Dress Code + any Line Notes text → combine into notes

payrollCompany is a company name (contains words like PAYROLL, AGENCY, STAFFING, INC, LLC) —
it is NEVER a short dress-code abbreviation. The Dress Code field near the end (after Rate,
before Steward) holds codes like NWB, YWA, NWA, WC, BOB, ALL BLACK — these always belong in
notes, never in payrollCompany, no matter which column position they appear to land in.

LINE NOTES — two special cases only:
1. Standalone time with no other info → split shift: output TWO jobs on the same date.
   Job 1: startTime from Start Date line. Job 2: startTime = the standalone time.
2. Standalone time alongside descriptive text → time is endTime for this job.
   Put the descriptive text in notes.

Normalize all times to "HH:MM AM/PM" (e.g. "0800"→"08:00 AM", "1030PM"→"10:30 PM").
Status: "upcoming" for future dates, "completed" for past dates.`;

    const parsed = await callToolWithGateway(systemPrompt, text, {
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
                jobNumber: { type: ["string", "null"], description: "Full job/dispatch number in YYYY-NNNN format (e.g. 2026-0496)" },
                date: { type: "string", description: "Date in YYYY-MM-DD format" },
                startTime: { type: ["string", "null"], description: "Start/call time e.g. 08:00 AM" },
                endTime: { type: ["string", "null"], description: "End/wrap time e.g. 05:00 PM" },
                name: { type: "string", description: "Event/show name" },
                client: { type: "string", description: "Production company or project name" },
                payrollCompany: { type: ["string", "null"], description: "Payroll agency name" },
                venue: { type: "string", description: "Venue or location" },
                hourlyRate: { type: ["number", "null"], description: "Hourly rate" },
                steward: { type: ["string", "null"], description: "Steward or contact person" },
                parkingCost: { type: ["number", "null"], description: "Parking cost if mentioned" },
                status: { type: "string", enum: ["upcoming", "in-progress", "completed", "cancelled"] },
                notes: { type: ["string", "null"], description: "Additional notes" },
              },
              required: ["jobNumber", "date", "startTime", "endTime", "name", "client", "payrollCompany", "venue", "hourlyRate", "steward", "parkingCost", "status", "notes"],
              additionalProperties: false,
            },
          },
        },
        required: ["jobs"],
        additionalProperties: false,
      },
    });

    if (!parsed.jobs) {
      throw new Error("Failed to parse jobs");
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("parse-jobs error:", err);
    const status = err instanceof GatewayError ? err.status : 500;
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
