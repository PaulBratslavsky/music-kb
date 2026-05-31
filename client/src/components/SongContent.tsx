// SongContent — editable tab + lyrics panel for music-type videos.
//
// Lives on /video/$documentId. Toggles between display mode (read-only,
// monospace blocks for tab + chord-bracket-aware lyrics rendering) and
// edit mode (two textareas + Save / Cancel).
//
// Chord-bracket convention for lyrics:
//
//   [Am]Hey there [G]Delilah, what's it like in [F]New York City
//   I'm a thousand [E]miles away, but girl tonight you look so [Am]pretty
//
// Brackets render as small chord chips (clickable in the future to open
// in /builder); the rest of the line is plain text.

import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Button } from '#/components/ui/button';
import { saveSongContent } from '#/data/server-functions/videos';

type SongContentProps = {
  documentId: string;
  initialTab: string | null;
  initialLyrics: string | null;
  initialSourceUrl: string | null;
};

export function SongContent({
  documentId,
  initialTab,
  initialLyrics,
  initialSourceUrl,
}: SongContentProps) {
  const [tab, setTab] = useState(initialTab ?? '');
  const [lyrics, setLyrics] = useState(initialLyrics ?? '');
  const [sourceUrl, setSourceUrl] = useState(initialSourceUrl ?? '');
  // Whether we're in edit mode. Auto-enables when the user has nothing
  // saved yet (empty card → invites editing instead of showing a wall
  // of dead UI).
  const empty =
    !initialTab?.trim() && !initialLyrics?.trim();
  const [editing, setEditing] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync local state when the loader-provided initial values change
  // (route invalidation after a successful save).
  useEffect(() => {
    setTab(initialTab ?? '');
    setLyrics(initialLyrics ?? '');
    setSourceUrl(initialSourceUrl ?? '');
  }, [initialTab, initialLyrics, initialSourceUrl]);

  const save = async () => {
    setSaving(true);
    setError(null);
    const result = await saveSongContent({
      data: {
        documentId,
        // Treat blank textareas as "clear the field" — null on the wire
        // so Strapi nulls the column instead of storing an empty string.
        tabContent: tab.trim() ? tab : null,
        lyricsContent: lyrics.trim() ? lyrics : null,
        tabSourceUrl: sourceUrl.trim() ? sourceUrl : null,
      },
    });
    setSaving(false);
    if (result.status === 'error') {
      setError(result.error);
      return;
    }
    setEditing(false);
  };

  const cancel = () => {
    setTab(initialTab ?? '');
    setLyrics(initialLyrics ?? '');
    setSourceUrl(initialSourceUrl ?? '');
    setError(null);
    setEditing(false);
  };

  return (
    <section className="rounded-2xl border border-[var(--line)] bg-[var(--card)]">
      <header className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--ink)]">
            Tab & lyrics
          </h2>
          <p className="mt-0.5 text-xs text-[var(--ink-muted)]">
            Paste tabs and lyrics for the song. Chord brackets like{' '}
            <code className="rounded bg-[var(--bg-subtle)] px-1 font-mono text-[11px]">
              [Am]
            </code>{' '}
            in lyrics render as chips.
          </p>
        </div>
        {!editing && (
          <Button
            type="button"
            size="pill"
            variant="outline"
            onClick={() => setEditing(true)}
          >
            {empty ? 'Add tabs / lyrics' : 'Edit'}
          </Button>
        )}
      </header>

      {editing ? (
        <div className="grid gap-4 px-5 py-4">
          <label className="grid gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
              Tab (monospace, free-form)
            </span>
            <textarea
              value={tab}
              onChange={(e) => setTab(e.target.value)}
              placeholder={'e|--0-2-3----|\nB|----------3-|\nG|-----------|'}
              rows={10}
              spellCheck={false}
              className="w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--bg-subtle)] px-3 py-2 font-mono text-xs leading-relaxed text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
              Lyrics (use [ChordName] for inline chord chips)
            </span>
            <textarea
              value={lyrics}
              onChange={(e) => setLyrics(e.target.value)}
              placeholder={'[Am]Hey there [G]Delilah\nWhat\'s it like in [F]New York City'}
              rows={8}
              spellCheck={false}
              className="w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--bg-subtle)] px-3 py-2 font-mono text-xs leading-relaxed text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
              Source URL (optional)
            </span>
            <input
              type="url"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://tabs.ultimate-guitar.com/..."
              className="w-full rounded-lg border border-[var(--line)] bg-[var(--bg-subtle)] px-3 py-1.5 text-sm text-[var(--ink)] focus:border-[var(--accent)] focus:outline-none"
            />
          </label>
          {error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="pill"
              onClick={cancel}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="pill"
              onClick={save}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-5 px-5 py-4">
          {tab.trim() && <TabBlock content={tab} />}
          {lyrics.trim() && <LyricsBlock content={lyrics} />}
          {!tab.trim() && !lyrics.trim() && (
            <p className="py-6 text-center text-sm text-[var(--ink-muted)]">
              No tabs or lyrics yet. Click "Add tabs / lyrics" to start.
            </p>
          )}
          {sourceUrl.trim() && (
            <p className="text-xs text-[var(--ink-muted)]">
              Source:{' '}
              <a
                href={sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-[var(--ink)]"
              >
                {prettyUrl(sourceUrl)}
              </a>
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function TabBlock({ content }: { content: string }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
        Tab
      </h3>
      <pre className="overflow-x-auto rounded-lg border border-[var(--line)] bg-[var(--bg-subtle)] px-3 py-2 font-mono text-xs leading-relaxed text-[var(--ink)]">
        {content}
      </pre>
    </div>
  );
}

/** Lyrics renderer. Each line is parsed for `[ChordName]` brackets and
 *  rendered as plain text with inline chord chips. Lines that look like
 *  chord-only lines (e.g. "Am  G  F  E") are rendered as their own chip
 *  row above the next lyric line — common chord-chart convention. */
function LyricsBlock({ content }: { content: string }) {
  const lines = content.split('\n');
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
        Lyrics
      </h3>
      <div className="space-y-1.5 text-sm leading-relaxed text-[var(--ink)]">
        {lines.map((line, i) => (
          <LyricsLine key={i} line={line} />
        ))}
      </div>
    </div>
  );
}

function LyricsLine({ line }: { line: string }) {
  if (line.trim() === '') return <div className="h-3" />;
  // Tokenize: `[Chord]` → chip; everything else → plain text.
  const parts: Array<{ kind: 'text'; value: string } | { kind: 'chord'; value: string }> = [];
  let cursor = 0;
  const re = /\[([^\]]+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(line)) !== null) {
    if (match.index > cursor) {
      parts.push({ kind: 'text', value: line.slice(cursor, match.index) });
    }
    parts.push({ kind: 'chord', value: match[1] });
    cursor = match.index + match[0].length;
  }
  if (cursor < line.length) {
    parts.push({ kind: 'text', value: line.slice(cursor) });
  }
  if (parts.length === 0) {
    return <div>{line}</div>;
  }
  return (
    <div className="leading-relaxed">
      {parts.map((p, i) =>
        p.kind === 'chord' ? (
          <ChordChip key={i} name={p.value} />
        ) : (
          <span key={i}>{p.value}</span>
        ),
      )}
    </div>
  );
}

/** Render a chord name as a small accent-color chip. Clicking opens
 *  the chord on /builder for fretboard exploration. Parses simple chord
 *  spellings — falls back to plain text if unrecognized. */
function ChordChip({ name }: { name: string }) {
  const parsed = parseChordChip(name);
  if (!parsed) {
    return (
      <span className="mx-0.5 inline-block rounded bg-[var(--bg-subtle)] px-1.5 py-0.5 align-middle font-mono text-[10px] font-semibold text-[var(--ink-muted)]">
        {name}
      </span>
    );
  }
  return (
    <Link
      to="/builder"
      search={{ theory: `chord:${parsed.root}:${parsed.quality}` }}
      className="mx-0.5 inline-block rounded bg-[var(--accent-soft)] px-1.5 py-0.5 align-middle font-mono text-[10px] font-semibold text-[var(--accent)] no-underline hover:bg-[var(--accent)] hover:text-white"
      title={`Open ${name} on the fretboard`}
    >
      {name}
    </Link>
  );
}

/** Light chord-symbol parser. Recognizes the suffix conventions our
 *  /builder deep-link accepts. Returns null for anything unrecognized
 *  (slash chords, exotic alterations, typos) so the renderer can fall
 *  back to plain text. */
function parseChordChip(symbol: string): { root: string; quality: string } | null {
  const m = symbol.trim().match(/^([A-G])([#b♭♯]?)(.*)$/);
  if (!m) return null;
  const [, letter, accRaw, rest] = m;
  // Normalize accidentals to sharp form (/builder's parser only accepts
  // sharps; flats are mapped to enharmonic sharps).
  const acc = accRaw === '♭' ? 'b' : accRaw === '♯' ? '#' : accRaw;
  const FLAT_TO_SHARP: Record<string, string> = {
    Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#',
  };
  const sharpLetter = acc === 'b' ? FLAT_TO_SHARP[letter + acc] : letter + acc;
  if (!sharpLetter) return null;
  const root = sharpLetter;
  // Quality suffix — match the most common shorthand to our enum.
  const suffix = rest.trim().toLowerCase();
  const QUALITY_MAP: Record<string, string> = {
    '': 'maj',
    m: 'min',
    min: 'min',
    '-': 'min',
    maj: 'maj',
    M: 'maj',
    dim: 'dim',
    'o': 'dim',
    '°': 'dim',
    aug: 'aug',
    '+': 'aug',
    '7': 'dom7',
    'm7': 'min7',
    min7: 'min7',
    maj7: 'maj7',
    M7: 'maj7',
    sus2: 'sus2',
    sus4: 'sus4',
    '5': '5',
    '6': '6',
    m6: 'm6',
    m7b5: 'm7b5',
    'ø': 'm7b5',
    dim7: 'dim7',
  };
  const quality = QUALITY_MAP[suffix];
  if (!quality) return null;
  return { root, quality };
}

function prettyUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '') + u.pathname;
  } catch {
    return url;
  }
}
