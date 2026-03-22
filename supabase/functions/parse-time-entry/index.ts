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
    const { text, jobs } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    const today = new Date().toISOString().split("T")[0];
    const jobsList = jobs?.length
      ? `Available jobs: ${jobs.map((j: { name: string; client: string }) => `"${j.name}" (client: ${j.client})`).join(", ")}`
      : "No jobs available.";

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
              content: `You are a time entry parser for an AV technician's bookkeeping app. Parse spoken or typed input into structured job data. Today's date is ${today}. ${jobsList}

Extract all available details from the user's spoken input:
- Job/gig name and client/production company
- Venue/location
- Date (interpret relative dates like "yesterday", "last friday" relative to today)
- Start time and end time (in 12-hour format like "07:00 AM")
- Hours worked (calculate from start/end if given, or use explicit mention)
- Hourly rate (default $0 if not mentioned)
- Job number (if mentioned)
- Any notes or description

Match to available jobs if the description seems to reference one. Be generous with interpretation — the user is speaking naturally on a phone.`,
            },
            { role: "user", content: text },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "create_time_entry",
                description: "Create a parsed job entry from the user's spoken input",
                parameters: {
                  type: "object",
                  properties: {
                    jobName: {
                      type: "string",
                      description: "Job or gig name, matched from available jobs if possible",
                    },
                    client: {
                      type: "string",
                      description: "Client or production company name, empty string if not mentioned",
                    },
                    venue: {
                      type: "string",
                      description: "Venue or location, empty string if not mentioned",
                    },
                    date: {
                      type: "string",
                      description: "Date in YYYY-MM-DD format",
                    },
                    startTime: {
                      type: "string",
                      description: "Start time in HH:MM AM/PM format (e.g. '07:00 AM'), empty string if not mentioned",
                    },
                    endTime: {
                      type: "string",
                      description: "End time in HH:MM AM/PM format (e.g. '05:00 PM'), empty string if not mentioned",
                    },
                    hours: {
                      type: "number",
                      description: "Hours worked (calculate from start/end times if both given, otherwise use explicit mention, 0 if unknown)",
                    },
                    rate: {
                      type: "number",
                      description: "Hourly rate in dollars, 0 if not mentioned",
                    },
                    jobNumber: {
                      type: "string",
                      description: "Job number if mentioned, empty string otherwise",
                    },
                    description: {
                      type: "string",
                      description: "Any additional notes or description of work done",
                    },
                  },
                  required: [
                    "jobName",
                    "client",
                    "venue",
                    "date",
                    "startTime",
                    "endTime",
                    "hours",
                    "rate",
                    "jobNumber",
                    "description",
                  ],
                  additionalProperties: false,
                },
              },
            },
          ],
          tool_choice: {
            type: "function",
            function: { name: "create_time_entry" },
          },
        }),
      }
    );

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded, please try again later." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "Payment required, please add credits." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      throw new Error("AI gateway error");
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];

    if (!toolCall) {
      throw new Error("Failed to parse time entry");
    }

    const parsed = JSON.parse(toolCall.function.arguments);

    return new Response(JSON.stringify({ entry: parsed }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("parse-time-entry error:", err);
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
