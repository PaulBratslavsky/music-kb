import { useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { StrapiVideo } from '#/lib/services/videos';
import { Button } from '#/components/ui/button';
import { streamChatSSE, type StreamEvent } from '#/lib/services/chat-stream';
import { friendlyOllamaError } from '#/lib/services/ollama-errors';

// Chat UI for the /digest page. Simpler than VideoChat: no timecode seek
// (no embedded player), no evidence accordion (chunks come from N videos
// so the per-citation plumbing would be heavier than worth it for v1),
// no slash commands. Just send → stream → render markdown → repeat.

type ToolCallRecord = {
  id: string;
  name: string;
  input: unknown | null;
  result: string | null;
  status: 'running' | 'done';
};

type Message = {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCallRecord[];
};

// Issue the digest-chat request and yield typed events from the
// response stream. Wire framing + AG-UI parsing live in
// `chat-stream.ts`; this wrapper owns only the request shape for the
// cross-video digest endpoint.
async function* streamDigestChat(
  videoIds: string[],
  messages: Message[],
): AsyncGenerator<StreamEvent, void, void> {
  const res = await fetch('/api/digest-chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ videoIds, messages }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`digest-chat (${res.status}): ${text || 'request failed'}`);
  }
  yield* streamChatSSE(res);
}

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
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const videoIds = videos.map((v) => v.youtubeVideoId);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;

    setError(null);
    const userMsg: Message = { role: 'user', content: trimmed };
    const nextMessages = [...messages, userMsg];
    setMessages([...nextMessages, { role: 'assistant', content: '' }]);
    setInput('');
    setIsStreaming(true);

    try {
      let assistantText = '';
      const toolCalls: ToolCallRecord[] = [];
      for await (const event of streamDigestChat(videoIds, nextMessages)) {
        if (event.kind === 'text') {
          assistantText += event.delta;
          setMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last && last.role === 'assistant') {
              next[next.length - 1] = {
                ...last,
                content: assistantText,
                toolCalls: [...toolCalls],
              };
            }
            return next;
          });
        } else if (event.kind === 'tool_start') {
          toolCalls.push({
            id: event.id,
            name: event.name,
            input: null,
            result: null,
            status: 'running',
          });
        } else if (event.kind === 'tool_end') {
          const idx = toolCalls.findIndex((t) => t.id === event.id);
          if (idx >= 0) {
            toolCalls[idx] = {
              ...toolCalls[idx],
              input: event.input,
              // Keep any result already delivered: TOOL_CALL_RESULT can
              // arrive before this frame, and 0.45's tool_end carries none.
              result: event.result ?? toolCalls[idx].result,
              status: 'done',
            };
          }
        } else if (event.kind === 'tool_result') {
          // 0.45 delivers the result on its own frame — merge, don't replace,
          // since name and input arrived on the earlier events.
          const idx = toolCalls.findIndex((t) => t.id === event.id);
          if (idx >= 0) {
            toolCalls[idx] = { ...toolCalls[idx], result: event.result };
          }
        }
      }
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Chat failed';
      setError(friendlyOllamaError(raw));
      // Drop the empty assistant placeholder if nothing streamed.
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === 'assistant' && !last.content) next.pop();
        return next;
      });
    } finally {
      setIsStreaming(false);
    }
  };

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void send(input);
  };

  const clear = () => {
    if (isStreaming) return;
    setMessages([]);
    setError(null);
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
            <MessageBubble key={`msg-${i}`} message={m} videos={videos} />
          ))}
          <div ref={bottomRef} />
        </div>
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
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
}: Readonly<{ message: Message; videos: StrapiVideo[] }>) {
  if (message.role === 'user') {
    return (
      <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-[var(--accent)]/10 px-4 py-2.5 text-sm text-[var(--ink)]">
        {message.content}
      </div>
    );
  }

  // Assistant — render markdown + optionally tool-call chips
  return (
    <div className="mr-auto max-w-[95%]">
      {message.toolCalls && message.toolCalls.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {message.toolCalls.map((tc) => (
            <span
              key={tc.id}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--bg-subtle)] px-2.5 py-0.5 text-[0.65rem] font-medium text-[var(--ink-muted)]"
            >
              {tc.status === 'running' ? '⋯' : '✓'} {tc.name}
            </span>
          ))}
        </div>
      )}
      {message.content ? (
        <div className="chat-md rounded-2xl rounded-bl-sm border border-[var(--line)] bg-[var(--bg-subtle)] px-4 py-3 text-sm leading-relaxed text-[var(--ink)]">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {message.content}
          </ReactMarkdown>
          <CitationFooter content={message.content} videos={videos} />
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
