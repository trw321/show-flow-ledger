import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const { imageBase64, mimeType, type = "expense" } = await req.json();
    if (!imageBase64) throw new Error("No image provided");

    const isIncome = type === "income";

    const systemPrompt = isIncome
      ? `You are a financial document parser specializing in bank statements and invoices. Extract all incoming payments/deposits/credits you can identify. For each transaction extract: client (who paid), description, amount (as a positive number), date (as YYYY-MM-DD), and invoiceNumber (if visible). If you can't determine the date, use today's date. Return ONLY valid JSON.`
      : `You are a financial document parser specializing in bank statements and receipts. Extract all transactions/line items you can identify. For each transaction extract: description, amount (as a number), date (as YYYY-MM-DD), and category. Categories should be one of: Travel, Gear Rental, Consumables, Fuel, Meals, Lodging, Labor, Insurance, Software, Other. If you can't determine the category, use "Other". If you can't determine the date, use today's date. Return ONLY valid JSON.`;

    const userPrompt = isIncome
      ? "Extract all income/payment/deposit transactions from this bank statement or invoice image. Return a JSON array of objects with fields: client, description, amount, date, invoiceNumber."
      : "Extract all expense transactions from this bank statement or receipt image. Return a JSON array of objects with fields: description, amount, date, category.";

    const toolDef = isIncome
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
                        enum: ["Travel", "Gear Rental", "Consumables", "Fuel", "Meals", "Lodging", "Labor", "Insurance", "Software", "Other"],
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

    const toolName = isIncome ? "extract_income" : "extract_expenses";

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
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
    return new Response(JSON.stringify({ transactions: result.transactions }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("parse-statement error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
