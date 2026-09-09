import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { callToolWithGateway, GatewayError, type GatewayToolDef, type UserPart } from "../_shared/lovable-ai.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
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
      ? `You are a financial document parser specializing in bank statements, invoices, and pay stub / payment notification emails. Extract all incoming payments/deposits/credits you can identify. For each transaction extract: client (who paid), description, amount (as a positive number), date (as YYYY-MM-DD), and invoiceNumber (if visible).

PAYMENT NOTE DATE/HOURS BREAKDOWN — payroll payment notes and stubs often itemize the hours covered by that one payment per date, e.g. "8/16 8 ST 1 OT, 8/17 8 ST, 8/18 8 ST" (ST = straight/standard time, OT = overtime, DT = double time). When you see this pattern, extract a "breakdown" array on that transaction: one entry per date+hour-type pair found, with date (YYYY-MM-DD, inferring the year from the payment date if not given), hours (the number), and type ("ST", "OT", or "DT"). This is the single most useful signal for matching a payment to the exact shifts it covers, so extract it whenever present — do not skip it just because the transaction already has other fields filled in. If no such breakdown is visible, omit the field entirely.

If you can't determine the date, use today's date. Return ONLY valid JSON.`
      : `You are a financial document parser specializing in bank statements and receipts. Extract all transactions/line items you can identify. For each transaction extract: description, amount (as a number), date (as YYYY-MM-DD), and category. Categories should be one of: Travel, Gear Rental, Consumables, Fuel, Meals, Lodging, Labor, Insurance, Software, Tools, Entertainment, Medical, Rent, IATSE Union Dues, Other. If you can't determine the category, use "Other". If you can't determine the date, use today's date. Return ONLY valid JSON.`;

    const userPrompt = isTimesheet
      ? "Extract all work sessions/time entries from this handwritten note, timesheet, call sheet, or schedule image. Calculate hours from any clock-in/clock-out times. Return structured time entries."
      : isIncome
      ? "Extract all income/payment/deposit transactions from this bank statement, invoice, or pay stub/payment notification image. Return a JSON array of objects with fields: client, description, amount, date, invoiceNumber, and breakdown (per-date ST/OT/DT hours) if the payment note itemizes which dates/hours it covers."
      : "Extract all expense transactions from this bank statement or receipt image. Return a JSON array of objects with fields: description, amount, date, category.";

    const toolDef: GatewayToolDef = isTimesheet
      ? {
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
                    startTime: { type: ["string", "null"], description: "Clock-in / call time in HH:MM AM/PM format, null if not found" },
                    endTime: { type: ["string", "null"], description: "Clock-out / wrap time in HH:MM AM/PM format, null if not found" },
                    client: { type: "string", description: "Client or company name" },
                    jobName: { type: ["string", "null"], description: "Job or project name" },
                    venue: { type: ["string", "null"], description: "Location or venue name, null if not found" },
                    steward: { type: ["string", "null"], description: "Steward or supervisor name if written, null if not found" },
                    description: { type: "string", description: "Description of work done" },
                    rate: { type: ["number", "null"], description: "Hourly rate if visible, null otherwise" },
                    mealPenalties: { type: ["number", "null"], description: "Number of meal penalties (MP), null if none" },
                  },
                  required: ["date", "hours", "startTime", "endTime", "client", "jobName", "venue", "steward", "description", "rate", "mealPenalties"],
                  additionalProperties: false,
                },
              },
            },
            required: ["entries"],
            additionalProperties: false,
          },
        }
      : isIncome
      ? {
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
                    invoiceNumber: { type: ["string", "null"] },
                    breakdown: {
                      type: ["array", "null"],
                      description: "Per-date hours breakdown from a payment note, e.g. '8/16 8 ST 1 OT' -> two entries for 2026-08-16. Null if the payment note doesn't itemize dates/hours.",
                      items: {
                        type: "object",
                        properties: {
                          date: { type: "string", description: "YYYY-MM-DD format" },
                          hours: { type: "number" },
                          type: { type: "string", enum: ["ST", "OT", "DT"] },
                        },
                        required: ["date", "hours", "type"],
                        additionalProperties: false,
                      },
                    },
                  },
                  required: ["client", "description", "amount", "date", "invoiceNumber", "breakdown"],
                  additionalProperties: false,
                },
              },
            },
            required: ["transactions"],
            additionalProperties: false,
          },
        }
      : {
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
        };

    const userContent: UserPart[] = [
      { type: "input_text", text: userPrompt },
      { type: "input_image", image_url: `data:${mimeType || "image/jpeg"};base64,${imageBase64}` },
    ];

    const result = await callToolWithGateway(systemPrompt, userContent, toolDef);

    const responseBody = isTimesheet
      ? { entries: result.entries ?? [] }
      : { transactions: result.transactions ?? [] };
    return new Response(JSON.stringify(responseBody), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("parse-statement error:", e);
    if (e instanceof GatewayError) {
      if (e.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (e.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add funds." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: e instanceof GatewayError ? e.status : 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
