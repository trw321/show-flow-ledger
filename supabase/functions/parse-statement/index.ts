import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured");

    const { imageBase64, mimeType, type = "expense", jobs } = await req.json();
    if (!imageBase64) throw new Error("No image provided");

    const isIncome = type === "income";
    const isTimesheet = type === "timesheet";

    const jobsList = jobs?.length
      ? `Available jobs to match against: ${jobs.map((j: { name: string; client: string }) => `"${j.name}" (client: ${j.client})`).join(", ")}`
      : "";

    const systemPrompt = isTimesheet
      ? `You are a timesheet and work note parser for an AV technician. Analyze the uploaded image of handwritten notes, timesheets, call sheets, or schedules. Extract every work session/entry you can find. For each entry extract: date (YYYY-MM-DD), hours worked (as a number), client name, job/project name, description of work done, startTime (clock-in, e.g. "08:00 AM"), endTime (clock-out/wrap, e.g. "05:00 PM"), venue or location name, steward name if written, hourly rate if visible (default 0), and mealPenalties (number of meal penalties, default 0). IMPORTANT RULES: 1) A one-hour "walk away" (meal break, lunch break) is OFF THE CLOCK — subtract it from total hours. 2) A "meal penalty" or "MP" noted means the crew was not broken for a meal on time — count each as a meal penalty (each = 1 hour at straight rate, added to pay). If you see "MP" or "meal penalty" on the timesheet, set mealPenalties accordingly. These notes are often used to match against a pre-loaded job offer — pay attention to location, steward, and date as they are the key identifiers. ${jobsList} If you can't determine the date, use today's date ${new Date().toISOString().split("T")[0]}.`
      : isIncome
      ? `You are a financial document parser specializing in bank statements and invoices. Extract all incoming payments/deposits/credits you can identify. For each transaction extract: client (who paid), description, amount (as a positive number), date (as YYYY-MM-DD), and invoiceNumber (if visible). If you can't determine the date, use today's date. Return ONLY valid JSON.`
      : `You are a financial document parser specializing in bank statements and receipts. Extract all transactions/line items you can identify. For each transaction extract: description, amount (as a number), date (as YYYY-MM-DD), and category. Categories should be one of: Travel, Gear Rental, Consumables, Fuel, Meals, Lodging, Labor, Insurance, Software, Tools, Entertainment, Medical, Rent, IATSE Union Dues, Other. If you can't determine the category, use "Other". If you can't determine the date, use today's date. Return ONLY valid JSON.`;

    const userPrompt = isTimesheet
      ? "Extract all work sessions/time entries from this handwritten note, timesheet, call sheet, or schedule image. Calculate hours from any clock-in/clock-out times. Return structured time entries."
      : isIncome
      ? "Extract all income/payment/deposit transactions from this bank statement or invoice image. Return a JSON array of objects with fields: client, description, amount, date, invoiceNumber."
      : "Extract all expense transactions from this bank statement or receipt image. Return a JSON array of objects with fields: description, amount, date, category.";

    const toolDef = isTimesheet
      ? {
          type: "function" as const,
          function: {
            name: "extract_time_entries",
            description: "Extract time/work entries from a timesheet, note, or schedule image",
            parameters: {
              type: "object",
              properties: {
                entries: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      date: { type: "string", description: "YYYY-MM-DD format" },
                      hours: { type: "number", description: "Hours worked (after subtracting walk-away breaks)" },
                      startTime: { type: "string", description: "Clock-in / call time in HH:MM AM/PM format, empty string if not found" },
                      endTime: { type: "string", description: "Clock-out / wrap time in HH:MM AM/PM format, empty string if not found" },
                      client: { type: "string", description: "Client or company name" },
                      jobName: { type: "string", description: "Job or project name" },
                      venue: { type: "string", description: "Location or venue name, empty string if not found" },
                      steward: { type: "string", description: "Steward or supervisor name if written, empty string if not found" },
                      description: { type: "string", description: "Description of work done" },
                      rate: { type: "number", description: "Hourly rate if visible, 0 otherwise" },
                      mealPenalties: { type: "number", description: "Number of meal penalties (MP), 0 if none" },
                    },
                    required: ["date", "hours", "client", "description"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["entries"],
              additionalProperties: false,
            },
          },
        }
      : isIncome
      ? {
          type: "function" as const,
          function: {
            name: "extract_income",
            description: "Extract income/payment transactions from a bank statement or invoice",
            parameters: {
              type: "object",
              properties: {
                transactions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      client: { type: "string" },
                      description: { type: "string" },
                      amount: { type: "number" },
                      date: { type: "string", description: "YYYY-MM-DD format" },
                      invoiceNumber: { type: "string" },
                    },
                    required: ["client", "description", "amount", "date"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["transactions"],
              additionalProperties: false,
            },
          },
        }
      : {
          type: "function" as const,
          function: {
            name: "extract_expenses",
            description: "Extract expense transactions from a bank statement or receipt",
            parameters: {
              type: "object",
              properties: {
                transactions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      description: { type: "string" },
                      amount: { type: "number" },
                      date: { type: "string", description: "YYYY-MM-DD format" },
                      category: {
                        type: "string",
                        enum: ["Travel", "Gear Rental", "Consumables", "Fuel", "Meals", "Lodging", "Labor", "Insurance", "Software", "Tools", "Entertainment", "Medical", "Rent", "IATSE Union Dues", "Other"],
                      },
                    },
                    required: ["description", "amount", "date", "category"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["transactions"],
              additionalProperties: false,
            },
          },
        };

    const toolName = isTimesheet ? "extract_time_entries" : isIncome ? "extract_income" : "extract_expenses";

    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GEMINI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gemini-2.0-flash",
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: userPrompt,
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:${mimeType || "image/jpeg"};base64,${imageBase64}`,
                },
              },
            ],
          },
        ],
        tools: [toolDef],
        tool_choice: { type: "function", function: { name: toolName } },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add funds." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      return new Response(JSON.stringify({ error: "Failed to analyze image" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    console.log("AI response:", JSON.stringify(data));

    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      // Fallback: try parsing content as JSON
      const content = data.choices?.[0]?.message?.content;
      if (content) {
        try {
          const parsed = JSON.parse(content);
          const transactions = Array.isArray(parsed) ? parsed : parsed.transactions || [];
          return new Response(JSON.stringify({ transactions }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        } catch {
          return new Response(JSON.stringify({ error: "Could not parse transactions from image", raw: content }), {
            status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
      return new Response(JSON.stringify({ error: "No transactions found in image" }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = JSON.parse(toolCall.function.arguments);
    const responseBody = isTimesheet
      ? { entries: result.entries }
      : { transactions: result.transactions };
    return new Response(JSON.stringify(responseBody), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("parse-statement error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
