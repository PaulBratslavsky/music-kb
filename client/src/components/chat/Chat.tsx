// The one chat component.
//
// WHY THIS EXISTS. Three surfaces — per-video chat, cross-video digest chat,
// and library ask — each carried their own copy of the same shell: a header
// with a model picker, a scrolling transcript, suggested prompts, an error
// banner, and a composer. The copies had already drifted in placeholder text,
// disabled states, and error handling. `useChat` removed the duplicated
// *state machines*; this removes the duplicated *markup*.
//
// WHAT IS DELIBERATELY NOT UNIFIED. Everything below the markdown body. A
// citation on the digest page is a router `<Link>` to another video; on the
// per-video page it is a player seek with a grounded transcript excerpt. Those
// are three real UIs, so `renderBelowBody` is a render prop rather than a
// boolean — extraction is shared, presentation is not. The four system-prompt
// builders stay server-side and this component never learns they exist.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { fetchServerSentEvents, useChat } from '@tanstack/ai-react';
import { createCapturingFetcher, type CaptureConfig } from './capture-frames';
import type { UIMessage } from '@tanstack/ai';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '#/components/ui/button';
import { ModelPicker } from '#/components/ModelPicker';
import { friendlyStreamError } from '#/lib/services/chat-errors';
import { messageText, messageToolCalls, type ToolCallRecord } from '#/lib/services/ui-message';
import type { SwitchableSurface } from '#/lib/services/model-policy';

/**
 * What a caller can see and do with the conversation.
 *
 * Passed to the render props rather than exposed through a ref, so a caller
 * that needs the transcript (to summarise it) or needs to reseed it (on a
 * skill switch) can do so without owning the hook.
 */
export type ChatContext = {
  messages: UIMessage[];
  isStreaming: boolean;
  setMessages: (messages: UIMessage[]) => void;
  /** Reset to empty, or to whatever `onClear` seeds instead. */
  clear: () => void;
};

/**
 * Persistence and `threadId` travel together, mirroring the SDK's own pairing:
 * a stored transcript needs a key to store it under. Expressed as a union so
 * passing one without the other is a type error here rather than a runtime
 * surprise inside useChat.
 */
type Durability =
  | {
      /**
       * Durable transcript. A storage adapter caches it in the browser; its
       * getItem/setItem may be async, so an adapter backed by a server
       * function makes the same conversation cross-device without touching
       * this component.
       */
      persistence: NonNullable<Parameters<typeof useChat>[0]['persistence']>;
      threadId: string;
    }
  | {
      persistence?: never;
      /** Scopes correlation. Omit for an ephemeral conversation. */
      threadId?: string;
    };

export type ChatProps = Durability & {
  /** Selects the ModelPicker's policy key. Never a model id. */
  surface: SwitchableSurface;
  /** The route this surface posts to. */
  endpoint: string;
  /**
   * Conversation-scoped values the server needs (videoId, videoIds, skillSlug).
   *
   * Merged into CHAT-LEVEL `forwardedProps` together with the model choice —
   * not per-send `body` — because only chat-level props are replayed by
   * `reload()`. Memoize it in the caller; its identity is what tells the hook
   * to update.
   */
  scope: Record<string, unknown>;


  chrome: {
    title: string;
    subtitle?: ReactNode;
    placeholder: string;
    /** Labels the landmark for assistive tech and for e2e selectors. */
    ariaLabel: string;
  };

  /** Chips shown until the user has spoken. Clicking one sends it. */
  suggestedPrompts?: string[];
  /** Shown in place of an empty transcript, above any suggested prompts. */
  emptyState?: ReactNode;
  /** Extra header controls (skill picker, summarise) that need chat state. */
  headerExtras?: (ctx: ChatContext) => ReactNode;
  /** Replaces the default empty-transcript reset (e.g. re-seed a greeting). */
  onClear?: (ctx: ChatContext) => void;

  /** Rewrites the raw input before sending, e.g. the `/web` slash command. */
  transformInput?: (raw: string) => string;
  /**
   * Rewrites the assistant body before markdown — stripping timecodes, or
   * turning `[N]` citation markers into links. Receives the message so a
   * caller can look up data it holds per message id.
   */
  transformMarkdown?: (text: string, message: UIMessage) => string;
  /** Custom markdown renderers, e.g. clickable timecodes. */
  markdownComponents?: Components;

  /** Rendered above the body — the tool-call panel. */
  renderAboveBody?: (message: UIMessage, toolCalls: ToolCallRecord[]) => ReactNode;
  /** Rendered inside the body, after the prose — citations or evidence. */
  renderBelowBody?: (message: UIMessage, isStreaming: boolean) => ReactNode;

  /** Fires when a run completes, with the finished message (and its id). */
  onFinish?: (message: UIMessage) => void;

  /** A transient status line above the composer, e.g. "Saved to notes". */
  banner?: ReactNode;
  /** Extra classes on the scrolling transcript, e.g. drawer padding. */
  bodyClassName?: string;

  /**
   * Pull custom SSE frames out of the stream and bind them to the message
   * they belong to — how /api/ask's pre-message CITATIONS frame reaches the
   * UI without a server change. See capture-frames.ts.
   */
  captureFrames?: CaptureConfig<unknown>;

  className?: string;
};

export function Chat({
  surface,
  endpoint,
  scope,
  threadId,
  persistence,
  chrome,
  suggestedPrompts,
  emptyState,
  headerExtras,
  onClear,
  transformInput,
  transformMarkdown,
  markdownComponents,
  renderAboveBody,
  renderBelowBody,
  onFinish,
  banner,
  captureFrames,
  className,
  bodyClassName,
}: Readonly<ChatProps>) {
  const [modelChoice, setModelChoice] = useState<string>('default');
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const forwardedProps = useMemo(
    () => ({ ...scope, modelChoice }),
    [scope, modelChoice],
  );

  const {
    messages,
    sendMessage,
    isLoading: isStreaming,
    error,
    setMessages,
    // Assembled then asserted once: ChatProps' `Durability` union already
    // guarantees the persistence/threadId pairing the SDK's own union
    // requires, but that guarantee does not survive being spread here.
  } = useChat({
    ...(threadId ? { threadId } : {}),
    ...(persistence ? { persistence } : {}),
    // Default: the connection adapter assembles the AG-UI RunAgentInput body,
    // because hand-writing that JSON is how the old clients and routes drifted
    // apart. A surface that emits custom frames swaps in a fetcher that reads
    // them out on the way through — same body, one extra pass.
    ...(captureFrames
      ? { fetcher: createCapturingFetcher(endpoint, captureFrames) }
      : { connection: fetchServerSentEvents(endpoint) }),
    forwardedProps,
    ...(onFinish ? { onFinish } : {}),
  } as Parameters<typeof useChat>[0]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  const ctx: ChatContext = {
    messages,
    isStreaming,
    setMessages,
    clear: () => {
      if (isStreaming) return;
      setMessages([]);
    },
  };

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;
    setInput('');
    void sendMessage(transformInput ? transformInput(trimmed) : trimmed);
  };

  const handleClear = () => {
    if (isStreaming) return;
    if (onClear) onClear(ctx);
    else setMessages([]);
  };

  return (
    <section
      className={`flex min-h-0 flex-col ${className ?? ''}`}
      aria-label={chrome.ariaLabel}
    >
      <header className="shrink-0 flex items-start justify-between gap-3 pb-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
            {chrome.title}
          </h2>
          {chrome.subtitle && (
            <p className="mt-1 text-xs text-[var(--ink-muted)]">{chrome.subtitle}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ModelPicker
            surface={surface}
            value={modelChoice}
            onChange={setModelChoice}
            disabled={isStreaming}
          />
          {headerExtras?.(ctx)}
          {messages.length > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleClear}
              disabled={isStreaming}
            >
              Clear
            </Button>
          )}
        </div>
      </header>

      <div className={`min-h-0 flex-1 overflow-y-auto ${bodyClassName ?? ''}`}>
        {emptyState && messages.length === 0 && emptyState}
        {/* Prompts stay available until the user actually engages. A skill's
            greeting is an assistant message but is not engagement, so testing
            `messages.length === 0` would hide the chips the moment a skill was
            picked — the exact affordance they exist to offer. */}
        {!messages.some((m) => m.role === 'user') &&
          suggestedPrompts &&
          suggestedPrompts.length > 0 && (
            <div className="flex flex-wrap gap-2 pb-4">
              {suggestedPrompts.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => send(p)}
                  disabled={isStreaming}
                  className="rounded-full border border-[var(--line)] bg-[var(--bg-subtle)] px-3 py-1 text-xs text-[var(--ink-muted)] transition hover:border-[var(--line-strong)] hover:text-[var(--ink)] disabled:opacity-50"
                >
                  {p}
                </button>
              ))}
            </div>
          )}

        <div className="grid gap-4 pb-4">
          {messages.map((message, i) => (
            <MessageBubble
              key={message.id ?? `msg-${i}`}
              message={message}
              // Only the final assistant turn is still arriving.
              isStreaming={isStreaming && i === messages.length - 1 && message.role === 'assistant'}
              transformMarkdown={transformMarkdown}
              markdownComponents={markdownComponents}
              renderAboveBody={renderAboveBody}
              renderBelowBody={renderBelowBody}
            />
          ))}
          <div ref={bottomRef} />
        </div>
      </div>

      {banner && (
        <output
          className="mb-3 rounded-lg border border-(--line) bg-(--bg-subtle) px-3 py-2 text-xs text-(--ink-muted)"
        >
          {banner}
        </output>
      )}

      {error && (
        <div
          role="alert"
          className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {/* Run failures arrive pre-translated by the model that answered
              (stream-errors.ts); transport failures translate here. */}
          {friendlyStreamError(error, 'Chat failed')}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="shrink-0 flex gap-2 pt-3"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={chrome.placeholder}
          disabled={isStreaming}
          className="h-10 min-w-0 flex-1 rounded-full border border-[var(--line)] bg-[var(--bg-subtle)] px-4 text-sm text-[var(--ink)] placeholder:text-[var(--ink-muted)] focus:border-[var(--line-strong)] focus:outline-none disabled:opacity-50"
        />
        <Button type="submit" size="pill" disabled={isStreaming || !input.trim()}>
          {isStreaming ? 'Thinking…' : 'Send'}
        </Button>
      </form>
    </section>
  );
}

function MessageBubble({
  message,
  isStreaming,
  transformMarkdown,
  markdownComponents,
  renderAboveBody,
  renderBelowBody,
}: Readonly<{
  message: UIMessage;
  isStreaming: boolean;
  transformMarkdown?: (text: string, message: UIMessage) => string;
  markdownComponents?: Components;
  renderAboveBody?: (message: UIMessage, toolCalls: ToolCallRecord[]) => ReactNode;
  renderBelowBody?: (message: UIMessage, isStreaming: boolean) => ReactNode;
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

  const body = transformMarkdown ? transformMarkdown(content, message) : content;
  // An assistant turn with nothing in it yet is the gap between send and first
  // token — show that it is working rather than an empty bubble.
  const isEmpty = content.length === 0 && isStreaming;

  return (
    <div className="mr-auto min-w-0 max-w-[95%]">
      {renderAboveBody?.(message, toolCalls)}
      {isEmpty ? (
        <div className="inline-flex items-center gap-2 rounded-2xl rounded-bl-sm border border-[var(--line)] bg-[var(--bg-subtle)] px-4 py-3 text-sm text-[var(--ink-muted)]">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-(--ink-muted)" />
          <span>Thinking…</span>
        </div>
      ) : (
        <div className="chat-md min-w-0 rounded-2xl rounded-bl-sm border border-(--line) bg-(--bg-subtle) px-4 py-3 text-sm leading-relaxed text-[var(--ink)]">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {body}
          </ReactMarkdown>
          {isStreaming && (
            <span
              aria-hidden="true"
              className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-(--ink-muted) align-middle"
            />
          )}
          {renderBelowBody?.(message, isStreaming)}
        </div>
      )}
    </div>
  );
}
