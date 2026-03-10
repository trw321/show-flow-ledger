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
              content: `You are a time entry parser for an AV technician's bookkeeping app. Parse spoken or typed input into structured time entry data. Today's date is ${today}. ${jobsList}

Extract: hours worked, hourly rate (default $0 if not mentioned), date (default today), client name, job name (match to available jobs if possible), and description/notes.

Interpret relative dates like "yesterday", "last friday", etc. relative to today.`,
            },
            { role: "user", content: text },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "create_time_entry",
                description: "Create a parsed time entry from the user's input",
                parameters: {
                  type: "object",
                  properties: {
                    hours: { type: "number", description: "Hours worked" },
                    rate: {
                      type: "number",
                      description: "Hourly rate in dollars, 0 if not mentioned",
                    },
                    date: {
                      type: "string",
                      description: "Date in YYYY-MM-DD format",
                    },
                    client: {
                      type: "string",
                      description: "Client name, empty string if not mentioned",
                    },
                    jobName: {
                      type: "string",
                      description:
                        "Job name matched from available jobs, or empty string",
                    },
                    description: {
                      type: "string",
                      description: "Description of work done",
                    },
                  },
                  required: [
                    "hours",
                    "rate",
                    "date",
                    "client",
                    "jobName",
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
