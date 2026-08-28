// Turn a follow-up question plus its conversation history into a STANDALONE
// query, before retrieval runs.
//
// WHY THIS EXISTS. `/api/ask` retrieves against the user's latest message. That
// is correct on turn 1 and wrong on turn 3: "tell me more about the second one"
// contains none of the words that would find the passages it refers to. Sending
// history to the model without fixing retrieval is worse than not sending it —
// the model would gain the context to sound confident while the seed passages
// stayed unrelated, turning a visibly-confused answer into a confidently
// grounded wrong one.
//
// This is the standard condensation step from retrieval-augmented chat: rewrite
// the follow-up into a question that stands on its own, retrieve with that, and
// answer with the original.
//
// It runs on `query-rewrite`, which is a LOCAL_ONLY surface — condensation is
// never billed and never leaves the machine, whatever tier answers the question
// itself.
//
// FAILS OPEN, ALWAYS. Every failure path returns the original question. A
// condenser that throws, hangs, or returns nonsense must degrade to today's
// behaviour rather than break the ask.

import { chat } from '@tanstack/ai';
import { resolveModel } from '#/lib/services/model-policy';

/** Only these roles carry conversational meaning for condensation. */
export type CondensableMessage = { role: 'user' | 'assistant'; content: string };

/**
 * How many prior turns to show the condenser.
 *
 * Four is two exchanges. The referent of a follow-up is almost always in the
 * immediately preceding turn, and this runs on a small local model whose
 * instruction-following degrades as the prompt grows — a longer window makes
 * the rewrite worse, not better.
 */
const HISTORY_TURNS = 4;

/** Prior turns are truncated: the condenser needs their topic, not their prose. */
const MAX_CHARS_PER_TURN = 400;

/**
 * Hard ceiling on condensation latency. It sits in front of retrieval, which
 * sits in front of the answer, so a slow rewrite delays every token. Past this
 * we retrieve with the raw question instead.
 */
const TIMEOUT_MS = 4000;

const SYSTEM = [
  'You rewrite a follow-up question into a standalone search query.',
  'Resolve pronouns and references ("it", "that one", "the second") using the conversation.',
  'Keep the user\'s own wording wherever it is already specific.',
  'Output ONLY the rewritten query — no preamble, no quotes, no explanation.',
  'If the question already stands alone, output it unchanged.',
].join('\n');

/**
 * How many prior turns a caller should keep, and how much of each.
 *
 * Exported so the transport boundary and the condenser agree on one number
 * rather than drifting apart in two files.
 */
export const MAX_HISTORY_TURNS = 4;
export const MAX_HISTORY_CHARS = 2000;

/**
 * Narrow untrusted client-supplied history to well-formed turns.
 *
 * This is a trust boundary, not a convenience: `history` arrives in a POST
 * body, and an unbounded or malformed array would be replayed verbatim into a
 * small local context. Anything that is not a non-empty user/assistant string
 * is dropped, the newest MAX_HISTORY_TURNS are kept, and each is truncated.
 */
export function sanitizeHistory(input: unknown): CondensableMessage[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter(
      (m): m is CondensableMessage =>
        !!m &&
        typeof m === 'object' &&
        ((m as CondensableMessage).role === 'user' ||
          (m as CondensableMessage).role === 'assistant') &&
        typeof (m as CondensableMessage).content === 'string' &&
        (m as CondensableMessage).content.trim().length > 0,
    )
    .slice(-MAX_HISTORY_TURNS)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_HISTORY_CHARS) }));
}

function transcript(history: readonly CondensableMessage[]): string {
  return history
    .slice(-HISTORY_TURNS)
    .map((m) => {
      const text = m.content.trim().slice(0, MAX_CHARS_PER_TURN);
      return `${m.role === 'user' ? 'User' : 'Assistant'}: ${text}`;
    })
    .join('\n');
}

/**
 * Reject a rewrite that is obviously worse than the original.
 *
 * Small models sometimes answer the question instead of rewriting it, or emit a
 * preamble. Length is a crude but effective guard: a standalone rephrasing of a
 * short follow-up is not five times longer than the whole exchange.
 */
function isUsable(rewritten: string, original: string): boolean {
  const t = rewritten.trim();
  if (t.length < 3) return false;
  if (t.length > 300) return false;
  if (t.split('\n').length > 2) return false;
  // A rewrite that dropped every content word of the original is suspect only
  // when the original had specific words to keep; anaphoric follow-ups
  // legitimately share almost nothing with their rewrite, so no overlap check.
  if (t.toLowerCase() === original.trim().toLowerCase()) return true;
  return true;
}

/**
 * Rewrite `question` into a standalone query using `history`.
 *
 * Returns the original unchanged when there is no history, when the model
 * fails, times out, or returns something unusable. The caller never has to
 * branch on failure.
 */
export async function condenseQuestion(
  question: string,
  history: readonly CondensableMessage[],
): Promise<{ query: string; condensed: boolean }> {
  const original = question.trim();
  // Turn 1 needs no condensation, and paying for a model call here would add
  // latency to the most common case for no benefit.
  if (original.length === 0 || history.length === 0) {
    return { query: original, condensed: false };
  }

  // The timer must be cleared on every exit path. An uncleared `setTimeout`
  // keeps the event loop alive for TIMEOUT_MS after the ask has already been
  // answered — invisible in a long-lived server, a held-open invocation
  // anywhere that tears down per request.
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const model = resolveModel('query-rewrite');
    const text = (await Promise.race([
      chat({
        adapter: model.adapter,
        messages: [
          { role: 'system', content: SYSTEM },
          {
            role: 'user',
            content: `Conversation so far:\n${transcript(history)}\n\nFollow-up question: ${original}\n\nStandalone query:`,
          },
        ] as never,
        stream: false,
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('condense timeout')), TIMEOUT_MS);
      }),
    ])) as string;

    const rewritten = String(text ?? '')
      .split('\n')
      .map((l) => l.replace(/^[-•\d.)\s"'`]+/, '').replace(/["'`]+$/, '').trim())
      .find((l) => l.length > 0);

    if (!rewritten || !isUsable(rewritten, original)) {
      return { query: original, condensed: false };
    }
    return { query: rewritten, condensed: rewritten !== original };
  } catch {
    // Deliberately swallowed. Retrieval with the raw question is exactly
    // today's behaviour, so a broken condenser is a no-op, not an outage.
    return { query: original, condensed: false };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
