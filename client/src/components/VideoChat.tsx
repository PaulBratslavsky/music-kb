import { useMemo, useState } from 'react';
import type { UIMessage } from '@tanstack/ai';
import { Accordion } from 'radix-ui';
import { usePlayerControl } from '#/components/player';
import { buildMarkdownComponents, stripInlineTimecodes } from './TimecodeMarkdown';
import { Button } from '#/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu';
import { Chat, type ChatContext } from '#/components/chat/Chat';
import type { EvidenceCitation } from '#/lib/services/transcript';
import { messageText, type ToolCallRecord } from '#/lib/services/ui-message';
import { getChatResponseEvidence } from '#/data/server-functions/videos';
import { summarizeToNote } from '#/data/server-functions/notes';
import { listSkills, type Skill } from '#/lib/skills';

// Per-video chat.
//
// The shell — transcript, composer, model picker, tool state, error banner —
// is <Chat>. What stays here is what is genuinely specific to talking to ONE
// video: skills and their greetings, summarising the conversation to a note,
// the `/web` slash command, timecodes that seek the player, and the evidence
// accordion that grounds each cited timecode against the real transcript.

type Props = {
  videoId: string;
  onNoteCreated?: (noteDocumentId: string) => void;
  className?: string;
};

// Slash commands: deterministic triggers that rewrite the user's message into
// an explicit tool-use prompt, bypassing the model's sometimes-flaky decision
// to call a tool. Extend the switch when we add more tools.
function transformSlashCommand(input: string): string {
  const web = /^\/web\s+(.+)$/i.exec(input.trim());
  if (web) {
    return `Use the kb_web_search tool to search for "${web[1].trim()}", then answer using what it returns.`;
  }
  return input;
}

const DEFAULT_SUGGESTED_PROMPTS = [
  'What are the key takeaways?',
  'Explain the main concept simply',
  'What should I practice first?',
];

/**
 * A skill's opening line, as a UIMessage.
 *
 * Seeded directly into the transcript rather than sent through the model: it
 * is a fixed string from the skill registry, so a round trip would cost a
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
  const skills = useMemo(() => listSkills('video-chat'), []);
  const [skillSlug, setSkillSlug] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [summaryMsg, setSummaryMsg] = useState<string | null>(null);

  // Evidence lives HERE, keyed by message id, not on the message. It is
  // fetched after the answer completes and it is large: in message metadata
  // it would round-trip every prior answer's transcript excerpts back to the
  // model on every later turn.
  const [evidenceById, setEvidenceById] = useState<Map<string, EvidenceCitation[]>>(
    () => new Map(),
  );

  const activeSkill = skillSlug ? skills.find((s) => s.slug === skillSlug) : null;

  const scope = useMemo(
    () => ({ videoId, skillSlug: skillSlug ?? undefined }),
    [videoId, skillSlug],
  );

  // Switching skills auto-primes the conversation with the skill's greeting —
  // but only while the user hasn't engaged. A greeting is an assistant message
  // and does NOT count as engagement, so the user can pick a skill, read the
  // greeting, switch again, and see THAT greeting. Once they send anything,
  // history is preserved and the new persona takes over on the next turn.
  const changeSkill = (ctx: ChatContext, nextSlug: string | null) => {
    if (ctx.isStreaming) return;
    setSkillSlug(nextSlug);
    if (ctx.messages.some((m) => m.role === 'user')) return;
    const greeting = (nextSlug ? skills.find((s) => s.slug === nextSlug) : null)
      ?.defaultGreeting?.trim();
    ctx.setMessages(greeting ? [greetingMessage(greeting)] : []);
  };

  const summarize = async (ctx: ChatContext) => {
    if (ctx.isStreaming || summarizing) return;
    setSummarizing(true);
    setSummaryMsg(null);
    const payload = ctx.messages
      .filter((m): m is typeof m & { role: 'user' | 'assistant' } =>
        m.role === 'user' || m.role === 'assistant',
      )
      .map((m) => ({ role: m.role, content: messageText(m).trim() }))
      .filter((m) => m.content.length > 0);
    try {
      const res = await summarizeToNote({
        data: {
          videoIds: [videoId],
          messages: payload,
          source: 'chat',
          skillSlug: skillSlug ?? undefined,
        },
      });
      if (res.status === 'ok') {
        setSummaryMsg('Saved to notes.');
        onNoteCreated?.(res.noteDocumentId);
        window.setTimeout(() => setSummaryMsg(null), 2500);
      } else {
        setSummaryMsg(`Save failed: ${res.error}`);
      }
    } catch (err) {
      // A REJECTION, not an `{ status: 'error' }` result — a dropped network
      // or a 500. Without this the flag stays true, so the button sits
      // disabled reading "Saving…" forever with nothing explaining why.
      setSummaryMsg(`Save failed: ${err instanceof Error ? err.message : 'request failed'}`);
    } finally {
      setSummarizing(false);
    }
  };

  return (
    <Chat
      surface="video-chat"
      endpoint="/api/chat"
      scope={scope}
      // Scopes the conversation to this video, so navigating between videos
      // does not bleed one transcript's chat into another's.
      threadId={videoId}
      className={className ?? 'mb-12'}
      chrome={{
        ariaLabel: 'Chat with this video',
        title: 'Ask about this video',
        subtitle: 'Answers come from the transcript. Timestamps seek the player.',
        placeholder: 'Ask about this video…  (/web <query> to force web search)',
      }}
      suggestedPrompts={activeSkill?.suggestedPrompts ?? DEFAULT_SUGGESTED_PROMPTS}
      transformInput={transformSlashCommand}
      transformMarkdown={stripInlineTimecodes}
      markdownComponents={buildMarkdownComponents()}
      banner={summaryMsg}
      headerExtras={(ctx) => (
        <>
          {skills.length > 0 && (
            <SkillPicker
              skills={skills}
              value={skillSlug}
              onChange={(next) => changeSkill(ctx, next)}
              disabled={ctx.isStreaming}
            />
          )}
          {ctx.messages.filter((m) => messageText(m).trim().length > 0).length >= 2 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void summarize(ctx)}
              disabled={ctx.isStreaming || summarizing}
            >
              {summarizing ? 'Saving…' : 'Summarize to note'}
            </Button>
          )}
        </>
      )}
      onClear={(ctx) => {
        setSummaryMsg(null);
        // Re-seed the active skill's greeting so the conversation restarts
        // from the same opening. Otherwise truly empty.
        const greeting = activeSkill?.defaultGreeting?.trim();
        ctx.setMessages(greeting ? [greetingMessage(greeting)] : []);
      }}
      onFinish={(message) => {
        // Best-effort: the answer has already rendered. Resolves each cited
        // timecode against the real transcript so the user can verify it.
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
      }}
      renderAboveBody={(_message, toolCalls) =>
        toolCalls.length > 0 ? (
          <div className="mb-2">
            <ToolCallsPanel toolCalls={toolCalls} />
          </div>
        ) : null
      }
      renderBelowBody={(message, isStreaming) => {
        const evidence = evidenceById.get(message.id);
        if (isStreaming || !evidence || evidence.length === 0) return null;
        return <EvidencePanel evidence={evidence} />;
      }}
    />
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
