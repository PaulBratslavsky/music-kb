// Reading `UIMessage` — the shape @tanstack/ai-react's `useChat` hands the UI.
//
// WHY THIS EXISTS. Before useChat, each chat surface kept its own reducer that
// folded AG-UI frames into a local `{ role, content, toolCalls }` record, and
// the three copies had already drifted from each other. useChat keeps that
// state itself, as `UIMessage.parts` — an ORDERED array where text, thinking,
// tool calls and tool results interleave in the order the model produced them.
//
// A chat surface therefore needs two things from a message: the prose to
// render, and the tool calls to show as cards. Both are derived here so the
// surfaces stay presentational, and so a new part type (`structured-output`,
// `image`, …) is handled in one place rather than silently dropped in three.

import type { ModelMessage, UIMessage } from '@tanstack/ai';

/**
 * A tool call flattened for rendering.
 *
 * Deliberately the same shape the hand-rolled reducers produced, so the
 * existing tool-card JSX renders unchanged: this migration is about deleting
 * state machines, not redesigning the UI.
 */
export type ToolCallRecord = {
  id: string;
  name: string;
  input: unknown | null;
  result: string | null;
  status: 'running' | 'done';
};

/**
 * The visible prose of a message.
 *
 * Handles BOTH message shapes, which is not defensive padding — the two are
 * genuinely different objects that arrive at different places:
 *
 *   UIMessage   `parts: [...]`  — what useChat holds on the client
 *   ModelMessage `content: ...` — what the AG-UI wire carries, and therefore
 *                                 what chatParamsFromRequestBody returns
 *
 * `chatParamsFromRequestBody` is typed `Array<UIMessage | ModelMessage>` and
 * returns the latter for a plain text turn. Casting that to UIMessage[] and
 * reading `.parts` throws `Cannot read properties of undefined` at runtime,
 * with types that looked fine.
 *
 * `thinking` parts are excluded: they are the model's scratchpad, and these
 * surfaces have never shown them. That is a decision, not an omission —
 * surfacing reasoning is a product change.
 */
export function messageText(message: UIMessage | ModelMessage): string {
  const parts = (message as UIMessage).parts;
  if (Array.isArray(parts)) {
    return parts
      .filter((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text')
      .map((p) => p.content)
      .join('');
  }

  const content = (message as ModelMessage).content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    // Multimodal turn: text parts use `content`, matching TextPart.
    return content
      .filter((c): c is Extract<typeof c, { type: 'text' }> => c?.type === 'text')
      .map((c) => c.content)
      .join('');
  }
  return '';
}

/**
 * The tool calls of a message, with their results attached.
 *
 * Results arrive as separate `tool-result` parts keyed by the call's id, so
 * this pairs them up. A call with no matching result is still 'running' —
 * which is exactly what should render while the tool is executing.
 */
export function messageToolCalls(message: UIMessage | ModelMessage): ToolCallRecord[] {
  // Only UIMessages carry tool calls as parts. A wire ModelMessage represents
  // them as separate assistant/tool turns, which the SDK reassembles itself —
  // this helper is for rendering, and rendering only ever sees UIMessages.
  const parts = (message as UIMessage).parts;
  if (!Array.isArray(parts)) return [];

  const results = new Map<string, string>();
  for (const part of parts) {
    if (part.type !== 'tool-result') continue;
    // `content` is a string for our server tools, but the type admits
    // structured content parts; stringify rather than render "[object Object]".
    const id = (part as { toolCallId?: string }).toolCallId;
    if (!id) continue;
    results.set(
      id,
      typeof part.content === 'string' ? part.content : JSON.stringify(part.content),
    );
  }

  const calls: ToolCallRecord[] = [];
  for (const part of parts) {
    if (part.type !== 'tool-call') continue;
    const result = results.get(part.id) ?? null;
    calls.push({
      id: part.id,
      name: part.name,
      // `input` is undefined until the arguments finish streaming; the raw
      // `arguments` string is the documented fallback.
      input: part.input ?? safeParse(part.arguments),
      result,
      // 'complete' is the SDK's terminal state; anything else is still moving.
      status: result !== null || part.state === 'complete' ? 'done' : 'running',
    });
  }
  return calls;
}

function safeParse(raw: string | undefined): unknown | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/**
 * The text of the most recent user turn.
 *
 * Retrieval runs against this, so it reads the LAST user message rather than
 * concatenating the thread: seeding retrieval with the whole conversation
 * drowns the current question in prior topics.
 */
export function latestUserText(
  messages: ReadonlyArray<UIMessage | ModelMessage>,
): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'user') return messageText(m).trim();
  }
  return '';
}
