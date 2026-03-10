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
              content: `You are a job history parser for an AV technician's bookkeeping app. Parse pasted text (from websites, spreadsheets, emails, or notes) into structured job data. Today's date is ${today}.

Extract as many jobs as you can find. For each job extract:
- name: the job/show/event name (e.g. "PELOSI DINNER" or the show/event title)
- client: the production company or client name (e.g. "METRO MEDIA PRODUCTIONS INC")
- venue: the venue/location (e.g. "Marriott - 4th & Mission")
- date: in YYYY-MM-DD format. For 2-digit years like "2/21/26", assume 2000s (2026). Use best guess from context.
- status: one of "upcoming", "in-progress", "completed", "cancelled" (default "completed" for past dates, "upcoming" for future)
- hourlyRate: if mentioned, the hourly rate as a number (e.g. $55.72 -> 55.72)
- notes: any additional details like job number, room info, call times, special instructions, contact person, union/payroll info. Combine them into a readable note.

Common AV industry formats include:
- Job numbers (e.g. 2026-0496)
- Call times (e.g. 08:00 AM - 05:00 PM)  
- Setup descriptions (e.g. "SETUP: HANG, FOCUS CB")
- Union/payroll references
- Rate codes (e.g. "2023-2028 BASIC ENTERTAINMENT")
- Contact names
- Room/salon numbers

Be flexible with formats — tables, lists, paragraphs, CSV-like data, concatenated text without clear delimiters, etc. If you can't determine a field, use an empty string or omit it.`,
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
                          name: { type: "string", description: "Job/event name" },
                          client: { type: "string", description: "Client or production company" },
                          venue: { type: "string", description: "Venue or location" },
                          date: { type: "string", description: "Date in YYYY-MM-DD format" },
                          status: { type: "string", enum: ["upcoming", "in-progress", "completed", "cancelled"] },
                          hourlyRate: { type: "number", description: "Hourly rate if mentioned" },
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
