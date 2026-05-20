import { useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '#/components/ui/button';
import {
  useLibraryChat,
  type ChatMessage,
  type Citation,
} from '#/lib/hooks/useLibraryChat';

// Root-mounted, route-independent library chat. FAB bottom-right when
// closed; right-side drawer when open. State persists via localStorage
// so the conversation survives navigation AND refresh. Cmd/Ctrl+K
// toggles from any page; Esc closes.
export function LibraryChat() {
  const chat = useLibraryChat();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Cmd/Ctrl+K opens / toggles.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        chat.toggle();
        return;
      }
      // Esc closes.
      if (e.key === 'Escape' && chat.isOpen) {
        chat.close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [chat]);

  return (
    <>
      {!chat.isOpen && <LibraryChatFAB onClick={chat.open} />}
      {chat.isOpen && <LibraryChatPanel chat={chat} />}
    </>
  );
}

function LibraryChatFAB({ onClick }: Readonly<{ onClick: () => void }>) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Ask your library"
      title="Ask your library (⌘K / Ctrl K)"
      className="fixed bottom-6 left-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--ink)] text-[var(--card)] shadow-[0_8px_24px_rgba(9,9,11,0.25)] transition hover:bg-[var(--ink-soft)]"
    >
      <svg
        viewBox="0 0 24 24"
        width="22"
        height="22"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    </button>
  );
}

function LibraryChatPanel({
  chat,
}: Readonly<{ chat: ReturnType<typeof useLibraryChat> }>) {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [chat.messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = input.trim();
    if (!q || chat.isStreaming) return;
    setInput('');
    void chat.ask(q);
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end pointer-events-none">
      {/* Subtle backdrop — click to close. Pointer-events-none above so
          the backdrop only activates when it specifically handles clicks. */}
      <button
        type="button"
        aria-label="Close chat"
        onClick={chat.close}
        className="pointer-events-auto absolute inset-0 bg-black/10 backdrop-blur-[1px] transition-opacity"
      />
      <aside
        className="pointer-events-auto relative flex h-full w-full max-w-xl flex-col border-l border-[var(--line)] bg-[var(--card)] shadow-[-4px_0_24px_rgba(9,9,11,0.1)]"
        aria-label="Library chat"
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--ink)]">
              Ask your library
            </h2>
            <p className="mt-0.5 text-[0.7rem] text-[var(--ink-muted)]">
              Cites videos with clickable timestamps. Local Gemma. Press Esc to
              close.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {chat.messages.length > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={chat.clear}
                disabled={chat.isStreaming}
              >
                Clear
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={chat.close}
              aria-label="Close"
            >
              ✕
            </Button>
          </div>
        </header>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {chat.messages.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="grid gap-5">
              {chat.messages.map((m) => (
                <MessageRow key={m.id} message={m} />
              ))}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        <form
          onSubmit={handleSubmit}
          className="shrink-0 border-t border-[var(--line)] px-5 py-4"
        >
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask anything about your library…"
              disabled={chat.isStreaming}
              autoFocus
              className="h-11 min-w-0 flex-1 rounded-full border border-[var(--line)] bg-[var(--bg-subtle)] px-4 text-sm text-[var(--ink)] placeholder:text-[var(--ink-muted)] focus:border-[var(--line-strong)] focus:outline-none disabled:opacity-50"
            />
            <Button
              type="submit"
              size="pill"
              disabled={chat.isStreaming || !input.trim()}
            >
              {chat.isStreaming ? 'Thinking…' : 'Ask'}
            </Button>
          </div>
        </form>
      </aside>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="mx-auto max-w-md py-10 text-center">
      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
        Library Q&amp;A
      </p>
      <h3 className="display-title mt-3 text-2xl text-[var(--ink)]">
        What should I ask?
      </h3>
      <p className="mt-3 text-sm text-[var(--ink-soft)]">
        Questions that span multiple videos work best. Answers cite source
        videos with clickable timestamps — click a chip to jump to that moment.
      </p>
      <ul className="mt-4 grid gap-2 text-left text-[0.75rem] text-[var(--ink-muted)]">
        <li className="rounded-md border border-[var(--line)] bg-[var(--bg-subtle)] px-3 py-2">
          “What do my videos say about the tradeoffs between K-quants and
          EXL2?”
        </li>
        <li className="rounded-md border border-[var(--line)] bg-[var(--bg-subtle)] px-3 py-2">
          “Which videos cover MCP and what are the main takeaways?”
        </li>
        <li className="rounded-md border border-[var(--line)] bg-[var(--bg-subtle)] px-3 py-2">
          “How do the speakers I&apos;ve watched differ on AI agent design?”
        </li>
      </ul>
    </div>
  );
}

function MessageRow({ message }: Readonly<{ message: ChatMessage }>) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl bg-[var(--ink)] px-4 py-2 text-sm text-[var(--cream)]">
          {message.content}
        </div>
      </div>
    );
  }
  return <AssistantMessage message={message} />;
}

function AssistantMessage({ message }: Readonly<{ message: ChatMessage }>) {
  const allCitations = message.citations ?? [];
  // Disclosure reflects only citations actually referenced in the
  // answer. Two forms:
  //   [N]       → specific passage, citation.index matches N
  //   [Video N] → whole candidate, maps to that video's anchor
  // While streaming, show the retrieval pool so the UI isn't empty
  // during the typing animation. Once done, drop to exactly what was
  // cited — an empty set means the disclosure hides (no dangling
  // "5 videos · 15 passages" when the model answered without citing).
  const referenced = collectReferencedCitationIndices(
    message.content,
    allCitations,
  );
  const citations =
    message.status === 'done'
      ? allCitations.filter((c) => referenced.has(c.index))
      : allCitations;
  if (message.status === 'pending') {
    return (
      <div className="max-w-full">
        <span className="inline-flex items-center gap-2 text-xs text-[var(--ink-muted)]">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--ink-muted)]" />
          Retrieving passages…
        </span>
      </div>
    );
  }
  if (message.status === 'error') {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
        Couldn&apos;t complete: {message.error}
      </div>
    );
  }
  const components = {
    // Replace bare text fragments containing [N] citation markers with
    // linked chips. Anchored to word boundaries so inline prose like
    // "[foo]" isn't rewritten.
    p: (props: React.HTMLAttributes<HTMLParagraphElement>) => (
      <p
        {...props}
        className="mb-2 text-sm leading-relaxed text-[var(--ink)]"
      />
    ),
  };
  return (
    <div className="max-w-full">
      <div className="prose prose-sm dark:prose-invert max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
          {annotateCitations(message.content, citations)}
        </ReactMarkdown>
      </div>
      {citations.length > 0 && message.status === 'done' && (
        <details className="mt-3 rounded-lg border border-[var(--line)] bg-[var(--bg-subtle)] p-3">
          <summary className="cursor-pointer text-xs font-medium text-[var(--ink-muted)]">
            {formatCitationSummary(citations)}
          </summary>
          <div className="mt-3 grid gap-2">
            {citations.map((c) => (
              <CitationCard key={c.index} citation={c} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

// Build the "Video N → anchor citation" lookup. Citations arrive in
// rank order grouped by video (video 1's passages, then video 2's, …),
// so the first citation per youtubeVideoId is that video's anchor.
function buildVideoAnchorIndex(citations: Citation[]): Citation[] {
  const seen = new Set<string>();
  const anchors: Citation[] = [];
  for (const c of citations) {
    if (seen.has(c.youtubeVideoId)) continue;
    seen.add(c.youtubeVideoId);
    anchors.push(c);
  }
  return anchors;
}

// Collect citation indices the model actually referenced. `[N]` maps
// directly to citation.index; `[Video N]` maps to the Nth candidate's
// anchor citation so the disclosure has something to show.
function collectReferencedCitationIndices(
  text: string,
  citations: Citation[],
): Set<number> {
  const seen = new Set<number>();
  const anchors = buildVideoAnchorIndex(citations);
  const re = /\[(Video\s+)?(\d+)\]/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const n = parseInt(m[2], 10);
    if (Number.isNaN(n)) continue;
    if (m[1]) {
      const anchor = anchors[n - 1];
      if (anchor) seen.add(anchor.index);
    } else {
      seen.add(n);
    }
  }
  return seen;
}

// Walk the streamed answer text and replace citation markers with
// markdown links. `[N]` → deep-link to that passage's timestamp.
// `[Video N]` → link to the candidate's learn page (no timestamp,
// since the claim is about the video as a whole).
function annotateCitations(text: string, citations: Citation[]): string {
  if (citations.length === 0) return text;
  const byIndex = new Map(citations.map((c) => [c.index, c]));
  const anchors = buildVideoAnchorIndex(citations);
  return text.replace(
    /\[(Video\s+)?(\d+)\]/gi,
    (match, prefix: string | undefined, numStr: string) => {
      const n = parseInt(numStr, 10);
      if (prefix) {
        const v = anchors[n - 1];
        if (!v) return match;
        return `[${match}](/learn/${v.youtubeVideoId})`;
      }
      const c = byIndex.get(n);
      if (!c) return match;
      const startSec = Math.max(0, Math.floor(c.startSec));
      return `[${match}](/learn/${c.youtubeVideoId}?t=${startSec})`;
    },
  );
}

function CitationCard({ citation }: Readonly<{ citation: Citation }>) {
  const startSec = Math.max(0, Math.floor(citation.startSec));
  const title = citation.videoTitle ?? citation.youtubeVideoId;
  const ts = formatMmss(citation.startSec);
  return (
    <Link
      to="/learn/$videoId"
      params={{ videoId: citation.youtubeVideoId }}
      search={{ t: startSec }}
      className="group flex gap-3 rounded-md border border-[var(--line)] bg-[var(--card)] p-2 no-underline transition hover:border-[var(--line-strong)]"
    >
      <span className="mt-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--ink)] px-1.5 text-[0.6rem] font-semibold tabular-nums text-[var(--cream)]">
        {citation.index}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-xs font-medium text-[var(--ink)] group-hover:text-[var(--accent)]">
            {title}
          </span>
          <span className="shrink-0 text-[0.65rem] tabular-nums text-[var(--ink-muted)]">
            {ts}
          </span>
        </div>
        <p className="mt-0.5 line-clamp-2 text-[0.7rem] leading-snug text-[var(--ink-soft)]">
          {citation.text}
        </p>
      </div>
    </Link>
  );
}

function formatCitationSummary(citations: Citation[]): string {
  const videos = new Set(citations.map((c) => c.videoDocumentId)).size;
  const passages = citations.length;
  return `${videos} ${videos === 1 ? 'video' : 'videos'} · ${passages} ${passages === 1 ? 'passage' : 'passages'}`;
}

function formatMmss(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const rest = s % 60;
  if (m < 60) return `${m}:${String(rest).padStart(2, '0')}`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}:${String(mm).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}
