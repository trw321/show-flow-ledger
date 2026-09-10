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
  _opts: { runId?: string } = {},
): Promise<Record<string, unknown>> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  const userMessageContent =
    typeof userContent === "string" ? userContent : userContent.map(toChatContentPart);

  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: GATEWAY_MODEL,
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
