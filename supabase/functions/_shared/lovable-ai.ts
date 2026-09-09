// Shared Lovable AI Gateway helper (Responses API, /v1/responses).
// Mechanical replacement for direct OpenAI /v1/chat/completions calls:
// same prompts, same tool schemas (made strict-compatible), one forced tool call out.

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/responses";
export const GATEWAY_MODEL = "openai/gpt-6-astra";

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

/**
 * Calls the gateway Responses API with a single forced function tool and returns
 * the parsed tool arguments. Always streams (required for reasoning models),
 * consuming the SSE stream server-side.
 */
export async function callToolWithGateway(
  systemPrompt: string,
  userContent: string | UserPart[],
  tool: GatewayToolDef,
  opts: { runId?: string } = {},
): Promise<Record<string, unknown>> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) throw new Error("LOVABLE_API_KEY is not configured");

  const userParts: UserPart[] =
    typeof userContent === "string" ? [{ type: "input_text", text: userContent }] : userContent;

  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": apiKey,
      "X-Lovable-AIG-SDK": "fetch",
      ...(opts.runId ? { "X-Lovable-AIG-Run-ID": opts.runId } : {}),
    },
    body: JSON.stringify({
      model: GATEWAY_MODEL,
      stream: true,
      store: false,
      reasoning: { effort: "low", summary: "auto" },
      input: [
        { role: "system", content: [{ type: "input_text", text: systemPrompt }] },
        { role: "user", content: userParts },
      ],
      tools: [
        {
          type: "function",
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          strict: true,
        },
      ],
      tool_choice: { type: "function", name: tool.name },
    }),
  });

  if (!res.ok || !res.body) {
    const t = await res.text();
    console.error("AI gateway error:", res.status, t);
    throw new GatewayError(res.status, "AI gateway error");
  }

  // Read the SSE stream, accumulating the forced tool call's arguments.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let argsDelta = "";
  let finalArgs: string | null = null;

  const handleEvent = (payload: string) => {
    if (payload === "[DONE]") return;
    let evt: Record<string, unknown>;
    try {
      evt = JSON.parse(payload);
    } catch {
      return;
    }
    const type = evt.type as string | undefined;
    if (type === "response.function_call_arguments.delta" && typeof evt.delta === "string") {
      argsDelta += evt.delta;
    } else if (type === "response.function_call_arguments.done" && typeof evt.arguments === "string") {
      finalArgs = evt.arguments;
    } else if (type === "response.completed" || type === "response.incomplete") {
      const output = (evt.response as { output?: Array<Record<string, unknown>> } | undefined)?.output ?? [];
      const call = output.find((item) => item.type === "function_call");
      if (call && typeof call.arguments === "string") finalArgs = call.arguments;
    } else if (type === "error") {
      console.error("AI gateway stream error:", payload);
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      for (const line of chunk.split("\n")) {
        if (line.startsWith("data:")) handleEvent(line.slice(5).trim());
      }
    }
  }
  if (buffer.trim()) {
    for (const line of buffer.split("\n")) {
      if (line.startsWith("data:")) handleEvent(line.slice(5).trim());
    }
  }

  const raw = finalArgs ?? (argsDelta ? argsDelta : null);
  if (!raw) return {};
  try {
    return stripNulls(JSON.parse(raw)) as Record<string, unknown>;
  } catch (e) {
    console.error("Failed to parse tool arguments:", e, raw.slice(0, 500));
    return {};
  }
}
