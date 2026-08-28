import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchServerSentEvents, useChat } from '@tanstack/ai-react';
import type { UIMessage } from '@tanstack/ai';
import { ModelPicker } from '#/components/ModelPicker';
import { Link } from '@tanstack/react-router';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { StrapiVideo } from '#/lib/services/videos';
import { Button } from '#/components/ui/button';
import { friendlyStreamError } from '#/lib/services/chat-stream';
import { messageText, messageToolCalls } from '#/lib/services/ui-message';

// Chat UI for the /digest page. Simpler than VideoChat: no timecode seek
// (no embedded player), no evidence accordion (chunks come from N videos
// so the per-citation plumbing would be heavier than worth it for v1),
// no slash commands. Just send → stream → render markdown → repeat.

const SUGGESTED_PROMPTS = [
  'What do these videos agree on?',
  'Where do they disagree?',
  'Which video goes deepest on the technical details?',
  'Summarize the throughline across all of them',
];

export function DigestChat({
  videos,
  className,
}: Readonly<{ videos: StrapiVideo[]; className?: string }>) {
  // Per-conversation model choice. 'default' preserves prior behaviour.
  const [modelChoice, setModelChoice] = useState<string>('default');
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const videoIds = useMemo(() => videos.map((v) => v.youtubeVideoId), [videos]);

  // CHAT-LEVEL forwardedProps, not per-send `body`.
  //
  // Both reach the server, but only chat-level props are replayed by
  // `reload()`. A retry that dropped videoIds would 400, and one that dropped
  // modelChoice would silently answer from a different model than the picker
  // shows — the same stale-value class of bug this codebase has already
  // shipped once. Memoized on `videos` so the identity is stable between
  // renders; `modelChoice` is a primitive the hook reads fresh.
  const forwardedProps = useMemo(
    () => ({ videoIds, modelChoice }),
    [videoIds, modelChoice],
  );

  const {
    messages,
    sendMessage,
    isLoading: isStreaming,
    error,
    setMessages,
  } = useChat({
    // The connection adapter assembles the AG-UI RunAgentInput body itself.
    // Hand-rolling that JSON is how the old client and this route drifted
    // apart in the first place; the server validates the same contract with
    // chatParamsFromRequestBody.
    connection: fetchServerSentEvents('/api/digest-chat'),
    forwardedProps,
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;
    setInput('');
    void sendMessage(trimmed);
  };

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    send(input);
  };

  const clear = () => {
    if (isStreaming) return;
    setMessages([]);
  };

  return (
    <section
      className={`flex min-h-0 flex-col ${className ?? ''}`}
      aria-label="Cross-video chat"
    >
      <header className="shrink-0 flex items-center justify-between gap-3 pb-4">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
            Ask across these videos
          </h2>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">
            Answered using retrieved passages from all {videos.length} videos.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ModelPicker
            surface="digest-chat"
            value={modelChoice}
            onChange={setModelChoice}
            disabled={isStreaming}
          />
          {messages.length > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={clear}
              disabled={isStreaming}
            >
              Clear
            </Button>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {messages.length === 0 && (
          <div className="flex flex-wrap gap-2 pb-4">
            {SUGGESTED_PROMPTS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => void send(p)}
                disabled={isStreaming}
                className="rounded-full border border-[var(--line)] bg-[var(--bg-subtle)] px-3 py-1 text-xs text-[var(--ink-muted)] transition hover:border-[var(--line-strong)] hover:text-[var(--ink)] disabled:opacity-50"
              >
                {p}
              </button>
            ))}
          </div>
        )}

        <div className="grid gap-4 pb-4">
          {messages.map((m, i) => (
            <MessageBubble key={m.id ?? `msg-${i}`} message={m} videos={videos} />
          ))}
          <div ref={bottomRef} />
        </div>
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {/* Run failures arrive pre-translated by the model that answered
              (stream-errors.ts); transport failures translate here. */}
          {friendlyStreamError(error, 'Chat failed')}
        </div>
      )}

      <form onSubmit={onSubmit} className="shrink-0 flex gap-2 pt-3">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about these videos…"
          disabled={isStreaming}
          className="h-10 min-w-0 flex-1 rounded-full border border-[var(--line)] bg-[var(--bg-subtle)] px-4 text-sm text-[var(--ink)] placeholder:text-[var(--ink-muted)] focus:border-[var(--line-strong)] focus:outline-none disabled:opacity-50"
        />
        <Button
          type="submit"
          size="pill"
          disabled={isStreaming || !input.trim()}
        >
          {isStreaming ? 'Thinking…' : 'Send'}
        </Button>
      </form>
    </section>
  );
}

function MessageBubble({
  message,
  videos,
}: Readonly<{ message: UIMessage; videos: StrapiVideo[] }>) {
  // useChat keeps an ordered `parts` array rather than a flat string, so text
  // and tool calls are derived here. See ui-message.ts.
  const content = messageText(message);
  const toolCalls = messageToolCalls(message);

  if (message.role === 'user') {
    return (
      <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-[var(--accent)]/10 px-4 py-2.5 text-sm text-[var(--ink)]">
        {content}
      </div>
    );
  }

  // Assistant — render markdown + optionally tool-call chips
  return (
    <div className="mr-auto max-w-[95%]">
      {toolCalls.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {toolCalls.map((tc) => (
            <span
              key={tc.id}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--bg-subtle)] px-2.5 py-0.5 text-[0.65rem] font-medium text-[var(--ink-muted)]"
            >
              {tc.status === 'running' ? '⋯' : '✓'} {tc.name}
            </span>
          ))}
        </div>
      )}
      {content ? (
        <div className="chat-md rounded-2xl rounded-bl-sm border border-[var(--line)] bg-[var(--bg-subtle)] px-4 py-3 text-sm leading-relaxed text-[var(--ink)]">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          <CitationFooter content={content} videos={videos} />
        </div>
      ) : (
        <div className="inline-flex items-center gap-2 rounded-2xl rounded-bl-sm border border-[var(--line)] bg-[var(--bg-subtle)] px-4 py-3 text-sm text-[var(--ink-muted)]">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--ink-muted)]" />
          <span>Thinking…</span>
        </div>
      )}
    </div>
  );
}

// Extract `[<title> mm:ss]` citations from the response and render as
// clickable chips that link to the source video's learn page. The chat
// bubble shows the raw text inline; this footer adds navigation.
function CitationFooter({
  content,
  videos,
}: Readonly<{ content: string; videos: StrapiVideo[] }>) {
  const regex = /\[([^\]]+?)\s+(\d{1,2}:\d{2}(?::\d{2})?)\]/g;
  const seen = new Set<string>();
  const cites: Array<{ title: string; timecode: string; video: StrapiVideo }> = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    const title = match[1].trim();
    const timecode = match[2];
    const video = videos.find(
      (v) =>
        (v.videoTitle ?? '').toLowerCase().includes(title.toLowerCase()) ||
        title.toLowerCase().includes((v.videoTitle ?? '').toLowerCase()),
    );
    if (!video) continue;
    const key = `${video.youtubeVideoId}-${timecode}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cites.push({ title, timecode, video });
  }

  if (cites.length === 0) return null;

  return (
    <div className="mt-3 flex flex-wrap gap-1.5 border-t border-[var(--line)] pt-3">
      <span className="text-[0.65rem] font-medium uppercase tracking-wider text-[var(--ink-muted)]">
        Sources:
      </span>
      {cites.map((c, i) => (
        <Link
          key={`${c.video.youtubeVideoId}-${i}`}
          to="/learn/$videoId"
          params={{ videoId: c.video.youtubeVideoId }}
          className="inline-flex max-w-[200px] items-center rounded-full border border-[var(--line)] bg-[var(--card)] px-2.5 py-0.5 text-[0.65rem] font-medium text-[var(--ink-muted)] transition hover:border-[var(--line-strong)] hover:text-[var(--ink)]"
        >
          <span className="truncate">
            {c.video.videoTitle ?? c.video.youtubeVideoId} · {c.timecode}
          </span>
        </Link>
      ))}
    </div>
  );
}
