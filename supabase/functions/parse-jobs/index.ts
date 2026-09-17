import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { callToolWithGateway, GatewayError, PARSER_MODELS, type ReasoningEffort } from "../_shared/lovable-ai.ts";

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
    const { text, model, reasoningEffort } = await req.json();

    // Safelisted so the endpoint can be pointed at newer models without
    // becoming an open proxy to arbitrary model names.
    const chosenModel = model && (PARSER_MODELS as readonly string[]).includes(model) ? model : undefined;
    const EFFORTS = ["none", "low", "medium", "high"];
    const chosenEffort = reasoningEffort && EFFORTS.includes(reasoningEffort) ? reasoningEffort : undefined;

    const today = new Date().toISOString().split("T")[0];

    const systemPrompt = `You are a job history parser for an AV technician's bookkeeping app. Today's date is ${today}.

Blocks are separated by a blank line. Count them, then output exactly that many jobs, in the same
order. One block in, one job out — always.

NEVER MERGE OR DEDUPLICATE BLOCKS. Two blocks are frequently near-identical, differing only in the
call time and a few words of note — that is a split shift or a callback (two separate calls, often
the same day, sometimes the same job number) and it must produce TWO jobs. Repeated job numbers,
dates, venues and rates across blocks are expected and are never a reason to collapse them into one.
If you receive 2 blocks you must return 2 jobs, even if they look like duplicates of each other.

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
- Job Site → venue. The NAME of the place only — "PIER 80", "FROST AMPHITHEATER", "CHASE CENTER".
- Location → notes, never venue. Despite its name this column holds street addresses, gate/entrance
  directions and parking instructions ("ENTER END OF CESAR CHAVEZ ST. (PARK ON PIER 80)", "551 MEMORIAL
  WAY, PARK IN GALVAS LOT, STREET PARK WILL BE TOWED"). Keep the venue a name you could read off a
  marquee; anything telling you how to get in or where to park belongs in notes.
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
    }, { model: chosenModel, reasoningEffort: chosenEffort as ReasoningEffort | undefined });

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
