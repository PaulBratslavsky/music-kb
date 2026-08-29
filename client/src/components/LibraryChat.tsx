import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import type { UIMessage } from '@tanstack/ai';
import { localStoragePersistence } from '@tanstack/ai-react';
import { Button } from '#/components/ui/button';
import { Chat } from '#/components/chat/Chat';
import { messageText } from '#/lib/services/ui-message';
import type { Citation } from '#/lib/services/citations';

// Library-wide ask. Global FAB when closed; right-side drawer when open.
//
// The DRAWER is a container — FAB, ⌘K, Esc, backdrop, close. What it contains
// is the same <Chat> the other two surfaces use.
//
// Citations are the reason this surface looked un-unifiable. /api/ask
// retrieves before it generates, so it emits its citations AHEAD of the answer
// they ground, as a raw CITATIONS frame. <Chat>'s `captureFrames` reads them
// out of the stream and binds them to the message that follows, so they arrive
// here keyed by message id with no server change. See capture-frames.ts.

const STORAGE_KEY = 'ytkb:library-chat:v2';

export function LibraryChat() {
  const [isOpen, setIsOpen] = useState(false);
  // Citations by message id, populated by the frame interceptor below.
  const [citationsById, setCitationsById] = useState<Map<string, Citation[]>>(
    () => new Map(),
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Cmd/Ctrl+K opens / toggles.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsOpen((v) => !v);
        return;
      }
      if (e.key === 'Escape') setIsOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const captureFrames = useMemo(
    () => ({
      match: (frame: Record<string, unknown>) =>
        frame.type === 'CITATIONS' && Array.isArray(frame.citations)
          ? (frame.citations as Citation[])
          : null,
      onCapture: (messageId: string, citations: unknown) => {
        setCitationsById((prev) => new Map(prev).set(messageId, citations as Citation[]));
      },
    }),
    [],
  );

  const renderBelowBody = useCallback(
    (message: UIMessage, isStreaming: boolean) => (
      <CitationDisclosure
        content={messageText(message)}
        citations={citationsById.get(message.id) ?? []}
        isStreaming={isStreaming}
      />
    ),
    [citationsById],
  );

  return (
    <>
      {!isOpen && <LibraryChatFAB onClick={() => setIsOpen(true)} />}
      {isOpen && (
        <div className="fixed inset-0 z-40 flex justify-end pointer-events-none">
          {/* Subtle backdrop — click to close. Pointer-events-none above so
              the backdrop only activates when it specifically handles clicks. */}
          <button
            type="button"
            aria-label="Close chat"
            onClick={() => setIsOpen(false)}
            className="pointer-events-auto absolute inset-0 bg-black/10 backdrop-blur-[1px] transition-opacity"
          />
          <aside
            className="pointer-events-auto relative flex h-full w-full max-w-xl flex-col border-l border-[var(--line)] bg-[var(--card)] px-5 py-4 shadow-[-4px_0_24px_rgba(9,9,11,0.1)]"
            aria-label="Library chat"
          >
            <Chat
              surface="library-ask"
              endpoint="/api/ask"
              scope={EMPTY_SCOPE}
              // Persisted per browser, so the conversation survives a reload.
              // Swapping this adapter for one backed by a server function is
              // the whole change needed to make it cross-device — getItem and
              // setItem are allowed to be async.
              threadId={STORAGE_KEY}
              persistence={localStoragePersistence()}
              captureFrames={captureFrames}
              chrome={{
                ariaLabel: 'Ask your library',
                title: 'Ask your library',
                subtitle: 'Cites videos with clickable timestamps. Press Esc to close.',
                placeholder: 'Ask anything about your library…',
              }}
              emptyState={<EmptyState />}
              headerExtras={() => (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsOpen(false)}
                  aria-label="Close"
                >
                  ✕
                </Button>
              )}
              // Rewrites `[N]` markers into linked citation chips before the
              // markdown renderer sees them. Needs the message, because the
              // citations are held per message id out here.
              transformMarkdown={(text, message) =>
                annotateCitations(text, citationsById.get(message.id) ?? [])
              }
              renderBelowBody={renderBelowBody}
              className="min-h-0 flex-1"
            />
          </aside>
        </div>
      )}
    </>
  );
}

/** Stable identity: this surface has no per-conversation scope of its own. */
const EMPTY_SCOPE = {};

/**
 * Citations for one answer: inline `[N]` chips plus an expandable source list.
 *
 * While the answer is still streaming the whole retrieval pool is shown, so
 * the panel is not empty during the typing animation. Once it settles, this
 * drops to exactly what the model actually cited — an uncited answer shows no
 * dangling "5 videos · 15 passages".
 */
function CitationDisclosure({
  content,
  citations,
  isStreaming,
}: Readonly<{ content: string; citations: Citation[]; isStreaming: boolean }>) {
  if (citations.length === 0) return null;
  const referenced = collectReferencedCitationIndices(content, citations);
  const shown = isStreaming ? citations : citations.filter((c) => referenced.has(c.index));
  if (shown.length === 0) return null;

  return (
    <details className="mt-3 rounded-lg border border-[var(--line)] bg-[var(--bg-subtle)] p-3">
      <summary className="cursor-pointer text-xs font-medium text-[var(--ink-muted)]">
        {formatCitationSummary(shown)}
      </summary>
      <div className="mt-3 grid gap-2">
        {shown.map((c) => (
          <CitationCard key={c.index} citation={c} />
        ))}
      </div>
    </details>
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
