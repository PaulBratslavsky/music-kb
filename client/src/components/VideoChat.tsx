import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchServerSentEvents, useChat } from '@tanstack/ai-react';
import type { UIMessage } from '@tanstack/ai';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Accordion } from 'radix-ui';
import { buildMarkdownComponents, stripInlineTimecodes } from './TimecodeMarkdown';
import { usePlayerControl } from '#/components/player';
import {
  friendlyStreamError,
} from '#/lib/services/chat-stream';
import { Button } from '#/components/ui/button';
import { ModelPicker } from '#/components/ModelPicker';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu';
import { getChatResponseEvidence } from '#/data/server-functions/videos';
import { summarizeToNote } from '#/data/server-functions/notes';
import { listSkills, type Skill } from '#/lib/skills';
import type { EvidenceCitation } from '#/lib/services/transcript';
import { messageText, messageToolCalls } from '#/lib/services/ui-message';

export type ToolCallRecord = {
  /** Stream-provided unique id for this tool call. */
  id: string;
  /** Tool name (e.g., "kb_web_search"). */
  name: string;
  /** Final parsed input args (from TOOL_CALL_END). Null until the call completes. */
  input: unknown | null;
  /** Tool execution result, serialized. Null until complete. */
  result: string | null;
  /** Status: running while args are streaming, done after END. */
  status: 'running' | 'done';
};

// No local Message type: useChat owns the transcript as UIMessage[], and
// evidence is held beside it in a Map keyed by message id (see the hook) so
// transcript excerpts are never replayed to the model.

type Props = {
  videoId: string;
  /** Called after a conversation is successfully saved as a note, so the
   * parent can refresh any note-list UI that's currently open. */
  onNoteCreated?: (noteDocumentId: string) => void;
  className?: string;
};

// Rewrite slash-prefixed commands into explicit natural-language
// instructions that reliably trigger the corresponding tool. Gemma's tool
// reliability is probabilistic; these wrappers make intent unambiguous.
function transformSlashCommand(input: string): string {
  const webMatch = input.match(/^\/web\s+(.+)$/i);
  if (webMatch) {
    const query = webMatch[1].trim();
    return `Use the kb_web_search tool with the exact query "${query}", then summarize the top results in 2-3 short paragraphs. Cite each source URL inline. Do NOT answer from the transcript for this request — I explicitly want web search results.`;
  }
  return input;
}

// Fallback prompts for the default Q&A skill (no skillSlug). Skills with
// `suggestedPrompts` of their own override these. Tuned for music-tutorial
// videos — the library is a music KB.
const DEFAULT_SUGGESTED_PROMPTS = [
  'What chords or progressions does this lesson cover?',
  'What key and tonal center is this in?',
  'What techniques does the player demonstrate, with timestamps?',
  'Summarize the music-theory concepts in plain language',
];

// Issue the chat request and yield typed events from the response stream.
// Wire framing + AG-UI parsing live in `chat-stream.ts`; this wrapper
// owns only the request shape (URL, body, headers) for the per-video
// chat endpoint.
/**
 * A skill's opening line, as a UIMessage.
 *
 * Seeded directly into the transcript rather than sent through the model:
 * it is a fixed string from the skill registry, so a round trip would cost a
 * generation and could return something else.
 */
function greetingMessage(greeting: string): UIMessage {
  return {
    id: `greeting-${greeting.slice(0, 24)}`,
    role: 'assistant',
    parts: [{ type: 'text', content: greeting }],
  };
}

export function VideoChat({ videoId, onNoteCreated, className }: Readonly<Props>) {
  const [input, setInput] = useState('');
  const [summarizing, setSummarizing] = useState(false);
  const [summaryMsg, setSummaryMsg] = useState<string | null>(null);
  // Skills are code modules (see `#/lib/skills`), resolved synchronously
  // at render time — no DB round-trip, no loading state. Memoized so the
  // registry lookup isn't repeated on every render.
  const skills = useMemo<Skill[]>(() => listSkills('video-chat'), []);
  const [skillSlug, setSkillSlug] = useState<string | null>(null);
  // Per-conversation model choice. 'default' preserves the previous behaviour
  // exactly: the surface's configured local model.
  const [modelChoice, setModelChoice] = useState<string>('default');
  // Everything the server needs for THIS conversation. Chat-level rather than
  // per-send: useChat re-reads it through an effect whenever the object
  // identity changes (use-chat.js:203 `client.updateOptions`), and only
  // chat-level props are replayed by `reload()` — a retry that dropped
  // skillSlug would answer in the wrong persona with no error.
  const forwardedProps = useMemo(
    () => ({ videoId, skillSlug: skillSlug ?? undefined, modelChoice }),
    [videoId, skillSlug, modelChoice],
  );

  // Evidence lives HERE, keyed by message id, not on the message.
  //
  // It is fetched after the answer completes (a second server call that
  // matches the model's cited timecodes to real transcript chunks), and it is
  // large. Putting it in message metadata would send every prior message's
  // transcript excerpts back up the wire on every subsequent turn.
  const [evidenceById, setEvidenceById] = useState<Map<string, EvidenceCitation[]>>(
    () => new Map(),
  );

  const {
    messages,
    sendMessage,
    isLoading: pending,
    error,
    setMessages,
  } = useChat({
    // `threadId` scopes the conversation to this video, so navigating between
    // videos does not bleed one transcript's chat into another's.
    threadId: videoId,
    connection: fetchServerSentEvents('/api/chat'),
    forwardedProps,
    onFinish: (message) => {
      // Best-effort: the answer has already rendered. Callbacks are read
      // through useChat's options ref, so `videoId` here is never stale.
      const text = messageText(message).trim();
      if (text.length === 0) return;
      void getChatResponseEvidence({ data: { videoId, responseText: text } })
        .then((evidence) => {
          if (evidence.length === 0) return;
          setEvidenceById((prev) => new Map(prev).set(message.id, evidence));
        })
        .catch(() => {
          // Evidence is an enhancement; its failure must not disturb the chat.
        });
    },
  });

  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  // Switching skills auto-primes the conversation with the skill's
  // `defaultGreeting` (if any) — BUT only while the user hasn't
  // engaged yet. Presence of a single auto-primer greeting doesn't
  // count as engagement; only a user message does. This lets the user
  // pick a skill, see the greeting, switch to a different skill, and
  // see THAT greeting — without locking them into the first pick.
  //
  // Once the user sends even one message, we preserve conversation
  // history on skill switch and let the new persona take over on the
  // next assistant turn.
  const changeSkill = (nextSlug: string | null) => {
    if (pending) return;
    setSkillSlug(nextSlug);
    const hasUserMessages = messages.some((m) => m.role === 'user');
    if (hasUserMessages) return;
    const selected = nextSlug
      ? skills.find((s) => s.slug === nextSlug)
      : null;
    const greeting = selected?.defaultGreeting?.trim();
    setMessages(greeting ? [greetingMessage(greeting)] : []);
    // Prime the input with the skill's first suggested prompt so Send
    // is immediately enabled — the user can hit Send, edit the text,
    // or click a different chip below to swap. Falls back to clearing
    // the input for skills (or the default Q&A) without explicit
    // prompts.
    const firstPrompt = selected?.suggestedPrompts?.[0] ?? '';
    setInput(firstPrompt);
  };

  const clear = () => {
    if (pending) return;
    setSummaryMsg(null);
    // If the active skill has a greeting, re-seed it so the conversation
    // starts from the same opening after Clear. Otherwise truly empty.
    const active = skillSlug ? skills.find((s) => s.slug === skillSlug) : null;
    const greeting = active?.defaultGreeting?.trim();
    setMessages(greeting ? [greetingMessage(greeting)] : []);
  };

  const summarize = async () => {
    if (pending || summarizing) return;
    setSummarizing(true);
    setSummaryMsg(null);
    const payload = messages
      .filter((m): m is typeof m & { role: 'user' | 'assistant' } =>
        m.role === 'user' || m.role === 'assistant',
      )
      .map((m) => ({ role: m.role, content: messageText(m).trim() }))
      .filter((m) => m.content.length > 0);
    const res = await summarizeToNote({
      data: {
        videoIds: [videoId],
        messages: payload,
        source: 'chat',
        skillSlug: skillSlug ?? undefined,
      },
    });
    setSummarizing(false);
    if (res.status === 'ok') {
      setSummaryMsg('Saved to notes.');
      onNoteCreated?.(res.noteDocumentId);
      // Clear the banner after a beat so it doesn't linger.
      window.setTimeout(() => setSummaryMsg(null), 2500);
    } else {
      setSummaryMsg(`Save failed: ${res.error}`);
    }
  };

  const sendPrompt = (promptText: string) => {
    if (pending) return;
    const trimmed = promptText.trim();
    if (!trimmed) return;

    // Slash commands: deterministic triggers that rewrite the user's
    // message into an explicit tool-use prompt, bypassing the model's
    // sometimes-flaky decision to call a tool. `/web <query>` forces
    // the kb_web_search tool. Extend the switch when we add more tools.
    setInput('');
    void sendMessage(transformSlashCommand(trimmed));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void sendPrompt(input);
  };

  return (
    <section
      className={`flex min-h-0 min-w-0 flex-col ${className ?? 'mb-12'}`}
      aria-label="Chat with this video"
    >
      <header className="shrink-0 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
              Ask about this video
            </h2>
            <p className="mt-1 text-xs text-[var(--ink-muted)]">
              Answers come from the transcript. Timestamps seek the player.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ModelPicker
              surface="video-chat"
              value={modelChoice}
              onChange={setModelChoice}
              disabled={pending}
            />
            {skills.length > 0 && (
              <SkillPicker
                skills={skills}
                value={skillSlug}
                onChange={changeSkill}
                disabled={pending}
              />
            )}
            {messages.length > 0 && (
              <>
                {messages.filter((m) => messageText(m).trim().length > 0).length >= 2 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void summarize()}
                    disabled={pending || summarizing}
                  >
                    {summarizing ? 'Saving…' : 'Summarize to note'}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={clear}
                  disabled={pending || summarizing}
                >
                  Clear
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      <div
        ref={scrollRef}
        className="min-h-0 min-w-0 flex-1 overflow-y-auto"
      >
        {/* Show suggested-prompt chips while the user hasn't engaged yet.
            "Engaged" = sent at least one user message. A skill's greeting
            counts as an assistant message but NOT engagement, so the chips
            stay available after picking a skill. Each skill can declare
            its own `suggestedPrompts`; falls back to a generic Q&A set
            for the default (no-skill) path. */}
        {(() => {
          const hasUserMessages = messages.some((m) => m.role === 'user');
          if (hasUserMessages) return null;
          const activeSkill = skillSlug
            ? skills.find((s) => s.slug === skillSlug)
            : null;
          const prompts = activeSkill?.suggestedPrompts ?? DEFAULT_SUGGESTED_PROMPTS;
          if (prompts.length === 0) return null;
          return (
            <div className="flex flex-wrap gap-2 pb-4">
              {prompts.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => void sendPrompt(p)}
                  disabled={pending}
                  className="rounded-full border border-[var(--line)] bg-[var(--bg-subtle)] px-3 py-1 text-xs text-[var(--ink-muted)] transition hover:border-[var(--line-strong)] hover:text-[var(--ink)] disabled:opacity-50"
                >
                  {p}
                </button>
              ))}
            </div>
          );
        })()}

        <div className="grid gap-4 pb-4">
          {messages.map((msg, i) => (
            <MessageRow
              key={msg.id ?? i}
              message={msg}
              evidence={evidenceById.get(msg.id) ?? null}
              streaming={
                pending && i === messages.length - 1 && msg.role === 'assistant'
              }
            />
          ))}
          <div ref={bottomRef} />
        </div>
      </div>

      {summaryMsg && (
        <div
          role="status"
          className="mb-3 rounded-lg border border-[var(--line)] bg-[var(--bg-subtle)] px-3 py-2 text-xs text-[var(--ink-muted)]"
        >
          {summaryMsg}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mb-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          <svg
            viewBox="0 0 16 16"
            width="12"
            height="12"
            aria-hidden="true"
            className="mt-0.5 flex-none"
          >
            <path
              fill="currentColor"
              d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zm.5 9v1.5h-1V10.5h1zm0-6v5h-1v-5h1z"
            />
          </svg>
          {/* Run failures arrive pre-translated by the model that answered
              (stream-errors.ts); transport failures translate here. */}
          <span>{friendlyStreamError(error, 'Chat failed')}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="shrink-0 flex gap-2 pt-3">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about this video…  (/web <query> to force web search)"
          disabled={pending}
          className="h-10 min-w-0 flex-1 rounded-full border border-[var(--line)] bg-[var(--bg-subtle)] px-4 text-sm text-[var(--ink)] placeholder:text-[var(--ink-muted)] focus:border-[var(--line-strong)] focus:outline-none disabled:opacity-50"
        />
        <Button
          type="submit"
          size="pill"
          disabled={pending || !input.trim()}
        >
          {pending ? 'Thinking…' : 'Send'}
        </Button>
      </form>
    </section>
  );
}

function MessageRow({
  message,
  evidence,
  streaming,
}: Readonly<{
  message: UIMessage;
  /** Held outside the message so transcript excerpts never ride the wire. */
  evidence: EvidenceCitation[] | null;
  streaming: boolean;
}>) {
  // useChat keeps an ordered `parts` array; text and tool calls are derived.
  const content = messageText(message);
  const toolCalls = messageToolCalls(message);

  if (message.role === 'user') {
    return (
      <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-[var(--accent)]/10 px-4 py-2.5 text-sm text-[var(--ink)]">
        {content}
      </div>
    );
  }

  const isEmpty = content.length === 0 && streaming;

  return (
    <div className="mr-auto min-w-0 max-w-[95%]">
      {toolCalls.length > 0 && (
        <div className="mb-2">
          <ToolCallsPanel toolCalls={toolCalls} />
        </div>
      )}
      {isEmpty ? (
        <div className="inline-flex items-center gap-2 rounded-2xl rounded-bl-sm border border-[var(--line)] bg-[var(--bg-subtle)] px-4 py-3 text-sm text-[var(--ink-muted)]">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--ink-muted)]" />
          <span>Thinking…</span>
        </div>
      ) : (
        <div className="chat-md min-w-0 rounded-2xl rounded-bl-sm border border-[var(--line)] bg-[var(--bg-subtle)] px-4 py-3 text-sm leading-relaxed text-[var(--ink)]">
          {/* Strip inline `[mm:ss]` / `(mm:ss)` timecodes from the chat body
              — the Sources accordion below shows each citation with its
              transcript excerpt, so inline chips are redundant. */}
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={buildMarkdownComponents()}
          >
            {stripInlineTimecodes(content)}
          </ReactMarkdown>
          {streaming && (
            <span
              aria-hidden="true"
              className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-[var(--ink-muted)] align-middle"
            />
          )}
          {!streaming && evidence && evidence.length > 0 && (
            <EvidencePanel evidence={evidence} />
          )}
        </div>
      )}
    </div>
  );
}

function formatMmss(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function EvidencePanel({
  evidence,
}: Readonly<{ evidence: EvidenceCitation[] }>) {
  const { seekTo } = usePlayerControl();
  // Outer accordion collapses the whole Sources block into a single-row
  // summary ("Sources — N citations") until expanded. Matches Claude's
  // "References" disclosure pattern — keeps the chat scroll clean.
  return (
    <Accordion.Root type="single" collapsible className="mt-4">
      <Accordion.Item
        value="sources"
        className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--bg-subtle)]"
      >
        <Accordion.Header className="flex">
          <Accordion.Trigger className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--ink-muted)] hover:bg-[var(--card)]">
            <svg viewBox="0 0 16 16" width="10" height="10" fill="currentColor" aria-hidden="true">
              <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zm.5 9V7.5h-1V10.5h1zm0-5v1h-1v-1h1z" />
            </svg>
            Sources — {evidence.length} citation{evidence.length === 1 ? '' : 's'}
            <span className="ml-auto">
              <svg
                viewBox="0 0 16 16"
                width="10"
                height="10"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="transition-transform duration-200 [[data-state=open]_&]:rotate-180"
                aria-hidden="true"
              >
                <path d="M4 6l4 4 4-4" />
              </svg>
            </span>
          </Accordion.Trigger>
        </Accordion.Header>
        <Accordion.Content className="overflow-hidden">
          <div className="grid gap-1 border-t border-[var(--line)] p-2">
            <Accordion.Root type="multiple" className="grid gap-1">
              {evidence.map((ev, i) => {
          const hasGrounding = ev.groundedTimeSec !== null && ev.groundedSnippet;
          const seekSec = ev.groundedTimeSec ?? ev.citedTimeSec;
          return (
            <Accordion.Item
              key={`${ev.citedTimecode}-${i}`}
              value={`ev-${i}`}
              className="overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--card)]"
            >
              <Accordion.Header className="flex">
                <Accordion.Trigger className="flex w-full flex-col gap-1 px-3 py-2 text-left text-xs hover:bg-[var(--bg-subtle)]">
                  <div className="flex w-full items-center gap-2">
                    {/* Nested <button> inside the Accordion.Trigger button
                        is invalid HTML (hydration error). Render as a
                        role="button" span with click + keyboard handlers
                        and stopPropagation so clicking the chip seeks
                        without toggling the accordion. */}
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        seekTo(seekSec);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          e.stopPropagation();
                          seekTo(seekSec);
                        }
                      }}
                      className="inline-flex h-5 cursor-pointer items-center gap-1 rounded-full bg-[var(--ink)] px-1.5 text-[0.65rem] font-semibold text-[var(--cream)]"
                    >
                      <svg viewBox="0 0 16 16" width="8" height="8" aria-hidden="true">
                        <path fill="currentColor" d="M4 2v12l9-6z" />
                      </svg>
                      {ev.citedTimecode}
                    </span>
                    {ev.drift && hasGrounding && (
                      <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 text-[0.6rem] font-medium text-amber-600 dark:text-amber-400">
                        may drift · transcript match at {formatMmss(ev.groundedTimeSec as number)}
                      </span>
                    )}
                    {!hasGrounding && (
                      <span className="rounded-full border border-[var(--line)] bg-[var(--bg-subtle)] px-1.5 py-0.5 text-[0.6rem] text-[var(--ink-muted)]">
                        no strong match
                      </span>
                    )}
                    <span className="ml-auto text-[var(--ink-muted)]">
                      <svg
                        viewBox="0 0 16 16"
                        width="10"
                        height="10"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        className="transition-transform duration-200 [[data-state=open]_&]:rotate-180"
                        aria-hidden="true"
                      >
                        <path d="M4 6l4 4 4-4" />
                      </svg>
                    </span>
                  </div>
                  {hasGrounding && ev.groundedSnippet && (
                    // Preview of the grounded transcript snippet — shown on
                    // the collapsed header so users see WHAT was matched
                    // without having to expand every row. Clamped to 2
                    // lines; full text still visible when expanded.
                    <p className="line-clamp-2 pl-1 text-[0.7rem] leading-snug text-[var(--ink-soft)]">
                      {ev.groundedSnippet}
                    </p>
                  )}
                </Accordion.Trigger>
              </Accordion.Header>
              <Accordion.Content className="overflow-hidden text-xs data-[state=closed]:animate-none">
                <div className="border-t border-[var(--line)] px-3 py-2.5">
                  <p className="mb-1.5 text-[0.65rem] font-medium uppercase tracking-wide text-[var(--ink-muted)]">
                    Transcript around {hasGrounding ? formatMmss(ev.groundedTimeSec as number) : ev.citedTimecode}
                  </p>
                  <p className="whitespace-pre-wrap leading-relaxed text-[var(--ink-soft)]">
                    {hasGrounding ? ev.groundedSnippet : '(No matching transcript chunk found at this timecode.)'}
                  </p>
                </div>
              </Accordion.Content>
            </Accordion.Item>
          );
        })}
            </Accordion.Root>
          </div>
        </Accordion.Content>
      </Accordion.Item>
    </Accordion.Root>
  );
}

// Inline panel rendered above the assistant's message body when a tool
// (e.g., kb_web_search) was invoked. Each tool call is an accordion that
// expands to show the exact input args + the result the model received.
// Matches the Claude/ChatGPT pattern of surfacing agentic steps without
// cluttering the reading flow.
function ToolCallsPanel({ toolCalls }: Readonly<{ toolCalls: ToolCallRecord[] }>) {
  return (
    <div className="mb-3 grid gap-1.5">
      <Accordion.Root type="multiple" className="grid gap-1">
        {toolCalls.map((tc) => (
          <Accordion.Item
            key={tc.id}
            value={tc.id}
            className="overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--bg-subtle)]"
          >
            <Accordion.Header className="flex">
              <Accordion.Trigger className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-[var(--card)]">
                {tc.status === 'running' ? (
                  <span
                    aria-hidden="true"
                    className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[var(--line)] border-t-[var(--ink)]"
                  />
                ) : (
                  <svg
                    viewBox="0 0 16 16"
                    width="10"
                    height="10"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    className="flex-none text-[var(--ink)]"
                  >
                    <path d="M3 8l3.5 3.5L13 5" />
                  </svg>
                )}
                <span className="font-mono text-[0.7rem] font-semibold text-[var(--ink)]">
                  {tc.name}
                </span>
                {tc.status === 'running' ? (
                  <span className="text-[0.65rem] text-[var(--ink-muted)]">running…</span>
                ) : (
                  <span className="truncate text-[0.65rem] text-[var(--ink-muted)]">
                    {summarizeInput(tc.input)}
                  </span>
                )}
                <span className="ml-auto text-[var(--ink-muted)]">
                  <svg
                    viewBox="0 0 16 16"
                    width="10"
                    height="10"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="transition-transform duration-200 [[data-state=open]_&]:rotate-180"
                    aria-hidden="true"
                  >
                    <path d="M4 6l4 4 4-4" />
                  </svg>
                </span>
              </Accordion.Trigger>
            </Accordion.Header>
            <Accordion.Content className="overflow-hidden text-xs">
              <div className="border-t border-[var(--line)] px-3 py-2 text-[var(--ink-soft)]">
                <div className="mb-1.5 text-[0.6rem] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                  Input
                </div>
                <pre className="mb-2 overflow-x-auto whitespace-pre-wrap break-words rounded border border-[var(--line)] bg-[var(--card)] px-2 py-1.5 font-mono text-[0.65rem]">
                  {safeStringify(tc.input)}
                </pre>
                {tc.result !== null && (
                  <>
                    <div className="mb-1.5 text-[0.6rem] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                      Result
                    </div>
                    <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded border border-[var(--line)] bg-[var(--card)] px-2 py-1.5 font-mono text-[0.65rem]">
                      {formatResult(tc.result)}
                    </pre>
                  </>
                )}
              </div>
            </Accordion.Content>
          </Accordion.Item>
        ))}
      </Accordion.Root>
    </div>
  );
}

// One-line preview of a tool call's input args, shown in the accordion
// header so users get a sense of what was called without expanding.
function summarizeInput(input: unknown): string {
  if (input == null) return '…';
  if (typeof input === 'string') return input.slice(0, 80);
  if (typeof input === 'object') {
    try {
      const flat = Object.entries(input as Record<string, unknown>)
        .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
        .join(' · ');
      return flat.slice(0, 80);
    } catch {
      return '[object]';
    }
  }
  return String(input).slice(0, 80);
}

function safeStringify(value: unknown): string {
  if (value === null || value === undefined) return '(empty)';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

// Tool results come serialized as JSON strings. Try to parse + pretty-print;
// fall back to raw string if it's not JSON.
function formatResult(result: string): string {
  try {
    const parsed = JSON.parse(result);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return result;
  }
}

// Skill picker — styled DropdownMenu (shadcn/radix). Sized to sit
// inline with the chat's action buttons (Summarize / Clear) in the
// header row. The open state is fully themed (no native OS chrome).
function SkillPicker({
  skills,
  value,
  onChange,
  disabled,
}: Readonly<{
  skills: Skill[];
  value: string | null;
  onChange: (slug: string | null) => void;
  disabled: boolean;
}>) {
  const active = value ? skills.find((s) => s.slug === value) : null;
  const label = active?.name ?? 'Default';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        className={
          'inline-flex h-8 items-center gap-1 rounded-md border border-[var(--line)] bg-[var(--bg-subtle)] px-2.5 text-xs font-medium text-[var(--ink)] transition focus:outline-none focus:border-[var(--line-strong)] ' +
          (disabled
            ? 'cursor-not-allowed opacity-50'
            : 'cursor-pointer hover:border-[var(--line-strong)]')
        }
        aria-label={`Chat mode: ${label}`}
        title={active?.description ?? 'Default persona'}
      >
        <span>{label}</span>
        <svg
          viewBox="0 0 20 20"
          className="h-3 w-3 text-[var(--ink-muted)]"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M6 8l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[240px]">
        <DropdownMenuRadioGroup
          value={value ?? ''}
          onValueChange={(next) => onChange(next || null)}
        >
          {skills.map((skill) => (
            <DropdownMenuRadioItem
              key={skill.slug}
              value={skill.slug}
              className="flex flex-col items-start gap-0.5 px-2 py-1.5"
            >
              <span className="text-xs font-medium text-[var(--ink)]">
                {skill.name}
              </span>
              {skill.description && (
                <span className="text-[0.65rem] leading-snug text-[var(--ink-muted)]">
                  {skill.description}
                </span>
              )}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
