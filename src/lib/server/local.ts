/**
 * A model served on your own machine, through the OpenAI-compatible chat API that Ollama, LM Studio, llama.cpp's server
 * and vLLM all speak. Nothing leaves your network and nothing is billed; it is slower and less sharp than Haiku.
 *
 *   DRAWER_LOCAL_URL    http://localhost:11434/v1 (Ollama's default)
 *   DRAWER_LOCAL_MODEL  e.g. qwen3.6:35b, or qwen3.5:9b on a smaller machine; one that handles tools and JSON output
 *   DRAWER_LOCAL_KEY    only if the server wants one
 *
 * Ollama's default context window (4k tokens) is too short: the librarian's prompt, its tools and a search's results
 * go past it, and Ollama then silently drops the start of the conversation, instructions first. Start Ollama with
 * OLLAMA_CONTEXT_LENGTH=16384 (README.md).
 */

export interface LocalOptions {
  baseUrl: string;
  model: string;
  apiKey?: string | null;
  /** Send pictures along (only for models that see images). */
  vision?: boolean;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export type ChatContent = string | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[];

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export type ChatMessage =
  | { role: 'system' | 'user'; content: ChatContent }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface ToolSpec {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ChatRequest {
  messages: ChatMessage[];
  tools?: ToolSpec[];
  /** A JSON schema the answer must follow. */
  schema?: { name: string; schema: Record<string, unknown> };
  maxTokens?: number;
  /** Cancels the call, e.g. when a whole question has run out of time. */
  signal?: AbortSignal;
}

export interface ChatReply {
  message: { content: string | null; tool_calls?: ToolCall[] };
  usage: { input_tokens: number; output_tokens: number };
  finish: string | null;
}

export function localChat(options: LocalOptions) {
  const doFetch = options.fetch ?? fetch;
  const url = `${options.baseUrl.replace(/\/+$/, '')}/chat/completions`;

  return async function chat(request: ChatRequest): Promise<ChatReply> {
    const body: Record<string, unknown> = {
      model: options.model,
      messages: request.messages,
      max_tokens: request.maxTokens ?? 1500,
      stream: false,
      // Filing a note doesn't need a model to think out loud first; servers that don't know the field ignore it.
      reasoning_effort: 'none',
    };
    if (request.tools?.length) body.tools = request.tools;
    if (request.schema) body.response_format = { type: 'json_schema', json_schema: { name: request.schema.name, strict: true, schema: request.schema.schema } };

    const response = await doFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}) },
      body: JSON.stringify(body),
      signal: request.signal
        ? AbortSignal.any([request.signal, AbortSignal.timeout(options.timeoutMs ?? 300_000)])
        : AbortSignal.timeout(options.timeoutMs ?? 300_000),
    });
    const json = (await response.json().catch(() => null)) as {
      choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] }; finish_reason?: string }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      error?: { message?: string } | string;
    } | null;
    if (!response.ok || !json?.choices?.[0]?.message) {
      const reason = typeof json?.error === 'string' ? json.error : json?.error?.message;
      throw new Error(`The local model at ${options.baseUrl} answered ${response.status}${reason ? `: ${reason}` : ''}`);
    }
    const choice = json.choices[0]!;
    return {
      message: { content: choice.message!.content ?? null, tool_calls: choice.message!.tool_calls?.length ? choice.message!.tool_calls : undefined },
      usage: { input_tokens: json.usage?.prompt_tokens ?? 0, output_tokens: json.usage?.completion_tokens ?? 0 },
      finish: choice.finish_reason ?? null,
    };
  };
}

export type LocalChat = ReturnType<typeof localChat>;

/**
 * A reply without the model thinking out loud: whole <think>…</think> blocks, the reasoning before a lone </think>
 * (templates that open the block in the prompt) and a block cut off before it closed.
 */
export function stripThinking(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/^[\s\S]*<\/think>/, '')
    .replace(/<think>[\s\S]*$/, '')
    .trim();
}

/** The answer as JSON, forgiving a model that thinks first, wraps it in a code fence or says a word around it. */
export function parseJson(text: string | null): unknown {
  if (!text) return null;
  const trimmed = stripThinking(text).replace(/^```(?:json)?\s*|\s*```$/g, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    // The object starts at one of the braces and ends at the last one.
    const end = trimmed.lastIndexOf('}');
    for (let start = trimmed.indexOf('{'); start >= 0 && start < end; start = trimmed.indexOf('{', start + 1)) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        /* try the next brace */
      }
    }
    return null;
  }
}

/** A zod schema as the plain JSON schema these servers expect (no $schema line, which some chat templates trip on). */
export function jsonSchema(schema: import('zod').ZodType): Record<string, unknown> {
  const { $schema: _, ...rest } = (schema.toJSONSchema() as Record<string, unknown>) ?? {};
  return rest;
}
