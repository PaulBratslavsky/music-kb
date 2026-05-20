import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '#/components/ui/button';
import { findActiveRowIndex, usePlayerControl } from '#/components/player';
import type {
  StrapiTranscriptSegment,
  StrapiVideo,
} from '#/lib/services/videos';

// Read-only transcript view rendered in the left pane of /learn when the
// Transcript tab is active. Reads playback state from the player Module:
// click-to-seek, plus auto-highlight + auto-scroll of the active row.
//
// Raw segments from Strapi are usually 1–3 words each (one phrase per
// caption frame), which makes for a noisy wall of rows. We coalesce
// consecutive segments into roughly sentence-sized rows. The seek target
// for a coalesced row is the FIRST segment's startMs — that's the moment
// the speaker starts saying that sentence.

const MAX_ROW_DURATION_MS = 12_000;
const MAX_ROW_CHARS = 220;
const SENTENCE_END = /[.!?]["')\]]?$/;

type CoalescedRow = {
  startMs: number;
  text: string;
};

function coalesceSegments(
  segments: ReadonlyArray<StrapiTranscriptSegment>,
): CoalescedRow[] {
  const rows: CoalescedRow[] = [];
  let buffer: { startMs: number; parts: string[]; chars: number } | null = null;

  const flush = () => {
    if (!buffer) return;
    const text = buffer.parts.join(' ').replace(/\s+/g, ' ').trim();
    if (text) rows.push({ startMs: buffer.startMs, text });
    buffer = null;
  };

  for (const seg of segments) {
    const piece = seg.text?.trim();
    if (!piece) continue;
    if (!buffer) {
      buffer = { startMs: seg.startMs, parts: [piece], chars: piece.length };
    } else {
      buffer.parts.push(piece);
      buffer.chars += piece.length + 1;
    }
    const elapsed = seg.startMs - buffer.startMs;
    const endsSentence = SENTENCE_END.test(piece);
    if (
      endsSentence ||
      buffer.chars >= MAX_ROW_CHARS ||
      elapsed >= MAX_ROW_DURATION_MS
    ) {
      flush();
    }
  }
  flush();
  return rows;
}

function formatTimecode(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Splits a row's text on every case-insensitive occurrence of `query`,
// returning alternating non-match / match segments for the renderer to
// style. The empty-query branch is the hot path on every keystroke
// before the user finishes typing — kept cheap with an early return.
type TextSegment = { text: string; match: boolean };

function highlightMatches(text: string, query: string): TextSegment[] {
  if (!query) return [{ text, match: false }];
  const lower = text.toLowerCase();
  const needle = query.toLowerCase();
  const segments: TextSegment[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const at = lower.indexOf(needle, cursor);
    if (at === -1) {
      segments.push({ text: text.slice(cursor), match: false });
      break;
    }
    if (at > cursor) {
      segments.push({ text: text.slice(cursor, at), match: false });
    }
    segments.push({ text: text.slice(at, at + needle.length), match: true });
    cursor = at + needle.length;
  }
  return segments;
}

export function TranscriptPane({
  video,
}: Readonly<{ video: StrapiVideo }>) {
  const { seekTo, currentSeconds } = usePlayerControl();
  const segments = video.transcript?.rawSegments ?? null;
  const rows = useMemo(
    () => (segments && segments.length > 0 ? coalesceSegments(segments) : []),
    [segments],
  );

  // Search state. When non-empty, the row list is filtered to matches
  // and the playback-following auto-scroll is suspended — the user is
  // navigating the transcript by query, not by playback position. The
  // trimmed query is what we actually search/highlight against; the raw
  // value drives the controlled input.
  const [searchInput, setSearchInput] = useState('');
  const query = searchInput.trim();
  const isSearching = query.length > 0;

  const filteredRows = useMemo(() => {
    if (!isSearching) {
      return rows.map((row, originalIdx) => ({ row, originalIdx }));
    }
    const needle = query.toLowerCase();
    const out: { row: CoalescedRow; originalIdx: number }[] = [];
    for (let i = 0; i < rows.length; i += 1) {
      if (rows[i].text.toLowerCase().includes(needle)) {
        out.push({ row: rows[i], originalIdx: i });
      }
    }
    return out;
  }, [rows, query, isSearching]);

  const activeIdx = useMemo(
    () => findActiveRowIndex(rows, currentSeconds),
    [rows, currentSeconds],
  );
  const activeRowRef = useRef<HTMLLIElement>(null);

  // Anchor the active row near the top of the viewport on every change,
  // so the transcript reliably follows playback. `block: 'start'` makes
  // the scroll happen even when the row is already on-screen — `nearest`
  // (the previous default) skipped any row already in view, which read as
  // "the transcript isn't scrolling." `scroll-mt-24` on the row leaves
  // ~6rem of breathing room above the line for context.
  //
  // Suspend the autoscroll while a search is active — the user wants to
  // browse matches, not be yanked back to the playback position on every
  // tick. Resumes the moment the query is cleared.
  useEffect(() => {
    if (isSearching) return;
    if (activeIdx < 0) return;
    activeRowRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [activeIdx, isSearching]);

  const [copied, setCopied] = useState(false);

  const copy = async () => {
    const text = rows
      .map((row) => `[${formatTimecode(row.startMs)}] ${row.text}`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  if (rows.length === 0) {
    return (
      <section className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-8 text-center sm:p-10">
        <h2 className="display-title text-2xl text-[var(--ink)] sm:text-3xl">
          No transcript available
        </h2>
        <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-[var(--ink-muted)]">
          We don&apos;t have a captions transcript stored for this video yet.
          Transcripts are fetched alongside the summary — try regenerating the
          summary if this video should have one.
        </p>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-2xl">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="display-title text-xl text-[var(--ink)]">Transcript</h2>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">
            Click a line to jump the video to that moment.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={copy}>
          {copied ? 'Copied!' : 'Copy transcript'}
        </Button>
      </header>

      {/* Search controls. Substring (case-insensitive), filters rows
          and highlights matches inline. Esc clears so the user can
          escape back to playback-following. */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setSearchInput('');
            }}
            placeholder="Search transcript…"
            aria-label="Search transcript"
            className="h-9 w-full rounded-full border border-[var(--line)] bg-[var(--card)] px-4 text-sm text-[var(--ink)] placeholder:text-[var(--ink-muted)] focus:border-[var(--line-strong)] focus:outline-none"
          />
        </div>
        {isSearching && (
          <div className="flex items-center gap-2 text-xs text-[var(--ink-muted)]">
            <span>
              {filteredRows.length}{' '}
              {filteredRows.length === 1 ? 'match' : 'matches'}
            </span>
            <button
              type="button"
              onClick={() => setSearchInput('')}
              className="rounded-md px-2 py-0.5 text-xs text-[var(--ink-muted)] hover:bg-[var(--bg-subtle)] hover:text-[var(--ink)]"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {isSearching && filteredRows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[var(--line)] bg-[var(--bg-subtle)] px-4 py-6 text-center text-sm text-[var(--ink-muted)]">
          No lines match &ldquo;{query}&rdquo;.
        </p>
      ) : (
        <ul className="divide-y divide-[var(--line)] rounded-xl border border-[var(--line)] bg-[var(--card)]">
          {filteredRows.map(({ row, originalIdx }) => {
            const seconds = Math.floor(row.startMs / 1000);
            // Active highlighting only applies in playback-following
            // mode — when searching, the visual emphasis goes on
            // matches, not on the active playback row.
            const isActive = !isSearching && originalIdx === activeIdx;
            const segments = highlightMatches(row.text, query);
            return (
              <li
                key={`${row.startMs}-${originalIdx}`}
                ref={isActive ? activeRowRef : null}
                className="scroll-mt-24"
              >
                <button
                  type="button"
                  onClick={() => seekTo(seconds)}
                  className={`grid w-full grid-cols-[4.5rem_1fr] items-start gap-4 px-4 py-3 text-left transition focus:outline-none ${
                    isActive
                      ? 'bg-[var(--accent)]/10'
                      : 'hover:bg-[var(--bg-subtle)] focus:bg-[var(--bg-subtle)]'
                  }`}
                >
                  <span
                    className={`font-mono text-xs tabular-nums ${
                      isActive ? 'font-semibold text-[var(--accent)]' : 'text-[var(--accent)]'
                    }`}
                  >
                    {formatTimecode(row.startMs)}
                  </span>
                  <span
                    className={`text-sm leading-relaxed ${
                      isActive ? 'font-medium text-[var(--ink)]' : 'text-[var(--ink)]'
                    }`}
                  >
                    {segments.map((seg, i) =>
                      seg.match ? (
                        <mark
                          key={i}
                          className="rounded-sm bg-yellow-300/60 px-0.5 text-[var(--ink)] dark:bg-yellow-400/40"
                        >
                          {seg.text}
                        </mark>
                      ) : (
                        <span key={i}>{seg.text}</span>
                      ),
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
