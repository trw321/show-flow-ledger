// Shared OpenAI helper (Chat Completions API, /v1/chat/completions).
// Direct OpenAI implementation behind the same interface the Lovable AI
// Gateway version used, so callers don't need to change.

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
export const GATEWAY_MODEL = "gpt-4o";

export type UserPart =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string; detail?: "auto" | "low" | "high" };

export interface GatewayToolDef {
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
}

export class GatewayError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Recursively drop null/undefined values so downstream code sees omitted fields
 *  exactly like it did before strict schemas forced every property to be present. */
export function stripNulls<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => stripNulls(v)).filter((v) => v !== null && v !== undefined) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === null || v === undefined) continue;
      out[k] = stripNulls(v);
    }
    return out as unknown as T;
  }
  return value;
}

export type ReasoningEffort = "none" | "low" | "medium" | "high";

/** Models that can read an image and return a strict tool call. Deliberately a
 *  short list — most of the ~130 models the API exposes are speech, embedding
 *  or image models that cannot do this job at all. */
export const PARSER_MODELS = [
  "gpt-4o",
  "gpt-4.1",
  "gpt-5",
  "gpt-5.4",
  "gpt-5.5",
  "gpt-5.6-sol",
  "gpt-5.6-luna",
  "gpt-5.6-terra",
] as const;

export const supportsReasoning = (model: string) => /^gpt-5/.test(model);

/** The reasoning path. /v1/responses shapes tools and output differently from
 *  chat completions, so it gets its own call rather than a pile of branches. */
async function callViaResponses(
  apiKey: string,
  model: string,
  effort: ReasoningEffort,
  systemPrompt: string,
  userContent: string | UserPart[],
  tool: GatewayToolDef,
): Promise<Record<string, unknown>> {
  const content = typeof userContent === "string"
    ? userContent
    : userContent.map((p) =>
      p.type === "input_text"
        ? { type: "input_text", text: p.text }
        : { type: "input_image", image_url: p.image_url, detail: p.detail ?? "auto" }
    );

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      reasoning: { effort },
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content },
      ],
      tools: [{ type: "function", name: tool.name, description: tool.description, parameters: tool.parameters, strict: true }],
      tool_choice: { type: "function", name: tool.name },
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    console.error("OpenAI responses error:", res.status, t);
    throw new GatewayError(res.status, "OpenAI API error");
  }

  const data = await res.json();
  const call = (data.output ?? []).find((o: { type?: string }) => o.type === "function_call");
  const raw = call?.arguments;
  if (!raw) return {};
  try {
    return stripNulls(JSON.parse(raw)) as Record<string, unknown>;
  } catch (e) {
    console.error("Failed to parse tool arguments:", e, String(raw).slice(0, 500));
    return {};
  }
}

function toChatContentPart(part: UserPart): Record<string, unknown> {
  if (part.type === "input_text") return { type: "text", text: part.text };
  return { type: "image_url", image_url: { url: part.image_url, detail: part.detail ?? "auto" } };
}

/**
 * Calls OpenAI's Chat Completions API with a single forced function tool and
 * returns the parsed tool arguments.
 */
export async function callToolWithGateway(
  systemPrompt: string,
  userContent: string | UserPart[],
  tool: GatewayToolDef,
  opts: { runId?: string; model?: string; reasoningEffort?: ReasoningEffort } = {},
): Promise<Record<string, unknown>> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  const model = opts.model ?? GATEWAY_MODEL;
  const isReasoningModel = /^gpt-5/.test(model);
  const effort = opts.reasoningEffort ?? (isReasoningModel ? "none" : undefined);

  // gpt-5.x refuses function tools on /v1/chat/completions unless reasoning is
  // off, so actually thinking before answering has to go through /v1/responses.
  if (isReasoningModel && effort && effort !== "none") {
    return await callViaResponses(apiKey, model, effort, systemPrompt, userContent, tool);
  }

  const userMessageContent =
    typeof userContent === "string" ? userContent : userContent.map(toChatContentPart);

  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      ...(effort ? { reasoning_effort: effort } : {}),
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessageContent },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
            strict: true,
          },
        },
      ],
      tool_choice: { type: "function", function: { name: tool.name } },
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    console.error("OpenAI API error:", res.status, t);
    throw new GatewayError(res.status, "OpenAI API error");
  }

  const data = await res.json();
  const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
  const raw = toolCall?.function?.arguments;
  if (!raw) return {};
  try {
    return stripNulls(JSON.parse(raw)) as Record<string, unknown>;
  } catch (e) {
    console.error("Failed to parse tool arguments:", e, String(raw).slice(0, 500));
    return {};
  }
}
