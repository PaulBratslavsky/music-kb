// MusicExtractionPanel — the "AI heard" card at the top of the learn page's
// Theory tab. Renders the per-video `musicExtraction` blob (key, chords,
// techniques, referenced songs) and the manual "Analyze music (AI)" trigger.
//
// Purely presentational: analyze state, errors, seeking, and visualizer
// hydration all live in the route (learn.$videoId.tsx) and arrive as props,
// matching how LoopBuilder receives its callbacks from the same host.
//
// Three states, keyed off the stored blob:
//   1. missing      → analyze button (one Ollama pass over the transcript)
//   2. present+empty → "analyzed, nothing found" line + Re-analyze
//   3. present+data  → compact card with key / chord / technique / song rows

import { Button } from '#/components/ui/button';
import type { ExtractedMusicData } from '#/lib/services/videos';

// NOTE: `musicExtractionStatus` in lib/services/music-extraction is the
// authoritative current/stale/missing check, but that module imports
// @tanstack/ai + the Ollama adapter + server env — importing it here would
// drag server-only deps into the client bundle. Client-side we only need
// "is there a blob at all": version/model staleness is a server concern
// (Re-analyze always overwrites), so any structurally-valid blob counts
// as present.
function isExtractionPresent(
  blob: ExtractedMusicData | null,
): blob is ExtractedMusicData {
  return blob != null && typeof blob === 'object' && Array.isArray(blob.chords);
}

function formatSeconds(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

// Confidence shading for the key chip — subtle: high gets the accent
// treatment (same as LoopBuilder's key chip), medium/low step down to
// neutral surfaces so an uncertain key doesn't read as authoritative.
const KEY_CHIP_BY_CONFIDENCE: Record<'high' | 'medium' | 'low', string> = {
  high: 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--ink)]',
  medium: 'border-[var(--line-strong)] bg-[var(--bg-subtle)] text-[var(--ink)]',
  low: 'border-[var(--line)] bg-[var(--bg-subtle)] text-[var(--ink-soft)]',
};

export type MusicExtractionPanelProps = {
  extraction: ExtractedMusicData | null;
  /** True while the manual analyze server-fn round-trip is in flight. */
  analyzing: boolean;
  /** Inline error from the last analyze attempt — already piped through
   *  friendlyOllamaError by the host (ADR 0007). Null when clear. */
  error: string | null;
  onAnalyze: () => void;
  onDismissError: () => void;
  /** Seek the page's YouTube player (host passes usePlayerControl().seekTo). */
  onSeek: (seconds: number) => void;
  /** Hydrate the theory visualizer from the extracted key — host mirrors
   *  the saved-loop reload flow (scale mode at the key's root). */
  onLoadKey: (key: { root: string; type: string }) => void;
};

export function MusicExtractionPanel({
  extraction,
  analyzing,
  error,
  onAnalyze,
  onDismissError,
  onSeek,
  onLoadKey,
}: Readonly<MusicExtractionPanelProps>) {
  // ---- State 1: never analyzed → manual trigger ---------------------------
  if (!isExtractionPresent(extraction)) {
    return (
      <div className="mb-6 rounded-2xl border border-dashed border-[var(--line)] bg-[var(--card)] p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
              AI heard
            </h3>
            <p className="mt-1 text-sm text-[var(--ink-soft)]">
              Extract the key, chords, techniques, and referenced songs from
              this video's transcript.
            </p>
            <p className="mt-1 text-xs text-[var(--ink-muted)]">
              One local AI pass over the whole transcript — usually takes
              10–60 seconds.
            </p>
          </div>
          <Button
            type="button"
            size="pill"
            variant="outline"
            onClick={onAnalyze}
            disabled={analyzing}
            className="shrink-0"
          >
            {analyzing ? 'Analyzing…' : 'Analyze music (AI)'}
          </Button>
        </div>
        {error && <ErrorLine message={error} onDismiss={onDismissError} />}
      </div>
    );
  }

  const { key, chords, techniques, songs } = extraction;
  const isEmpty =
    key == null &&
    chords.length === 0 &&
    techniques.length === 0 &&
    songs.length === 0;

  // ---- State 2: analyzed, nothing found (non-music video) -----------------
  if (isEmpty) {
    return (
      <div className="mb-6 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-[var(--ink-muted)]">
            No music data detected in this video.
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onAnalyze}
            disabled={analyzing}
            className="shrink-0"
          >
            {analyzing ? 'Re-analyzing…' : 'Re-analyze'}
          </Button>
        </div>
        {error && <ErrorLine message={error} onDismiss={onDismissError} />}
      </div>
    );
  }

  // ---- State 3: extraction with data → compact card -----------------------
  return (
    <section className="mb-6 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5">
      <header className="flex flex-wrap items-center gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
          AI heard
        </h3>
        {key && (
          <>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium ${KEY_CHIP_BY_CONFIDENCE[key.confidence]}`}
              title={`AI key estimate — ${key.confidence} confidence`}
            >
              {key.root} {key.type}
              {key.confidence !== 'high' && (
                <span className="text-[0.6rem] font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
                  {key.confidence}
                </span>
              )}
            </span>
            <button
              type="button"
              onClick={() => onLoadKey({ root: key.root, type: key.type })}
              title="Flip the visualizer into scale mode at this key"
              className="rounded-full border border-[var(--accent)] bg-[var(--card)] px-3 py-1 text-xs font-medium text-[var(--accent)] transition hover:bg-[var(--accent-soft)]"
            >
              Load into visualizer
            </button>
          </>
        )}
        <button
          type="button"
          onClick={onAnalyze}
          disabled={analyzing}
          className="ml-auto text-xs text-[var(--ink-muted)] underline-offset-2 hover:text-[var(--ink)] hover:underline disabled:opacity-50"
        >
          {analyzing ? 'analyzing…' : 're-analyze'}
        </button>
      </header>

      {error && <ErrorLine message={error} onDismiss={onDismissError} />}

      {chords.length > 0 && (
        <div className="mt-4">
          <span className="block text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
            Chords
          </span>
          <ul className="mt-2 flex flex-wrap items-center gap-1.5">
            {chords.map((c, i) => {
              // Same display idiom as LoopBuilder progression chips:
              // 'maj' quality is implied by the bare root.
              const label = `${c.root}${c.quality === 'maj' ? '' : c.quality}`;
              const hasTime = typeof c.timeSec === 'number';
              return (
                <li key={`${i}-${c.root}-${c.quality}`}>
                  {hasTime ? (
                    <button
                      type="button"
                      onClick={() => onSeek(c.timeSec as number)}
                      title={c.context || undefined}
                      aria-label={`Jump to ${label} at ${formatSeconds(c.timeSec as number)}`}
                      className="inline-flex h-6 items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--bg-subtle)] px-2 font-mono text-xs font-semibold text-[var(--ink)] transition hover:bg-[var(--ink)] hover:text-[var(--cream)]"
                    >
                      <span>{label}</span>
                      <span className="inline-flex items-center gap-0.5 text-[0.65rem]">
                        <svg viewBox="0 0 16 16" width="9" height="9" aria-hidden="true">
                          <path fill="currentColor" d="M4 2v12l9-6z" />
                        </svg>
                        {formatSeconds(c.timeSec as number)}
                      </span>
                    </button>
                  ) : (
                    <span
                      title={c.context || undefined}
                      className="inline-flex h-6 items-center rounded-full border border-[var(--line)] bg-[var(--bg-subtle)] px-2 font-mono text-xs font-semibold text-[var(--ink)]"
                    >
                      {label}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {techniques.length > 0 && (
        <div className="mt-4">
          <span className="block text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
            Techniques
          </span>
          <ul className="mt-2 grid gap-2">
            {techniques.map((t, i) => (
              <li
                key={`${i}-${t.name}`}
                className="flex items-start justify-between gap-3 rounded-xl border border-[var(--line)] bg-[var(--bg-subtle)] px-3 py-2"
              >
                <div className="min-w-0">
                  <span
                    className="text-sm font-medium text-[var(--ink)]"
                    title={t.context || undefined}
                  >
                    {t.name}
                  </span>
                  {t.description && (
                    <p className="mt-0.5 text-xs leading-relaxed text-[var(--ink-muted)]">
                      {t.description}
                    </p>
                  )}
                </div>
                {typeof t.timeSec === 'number' && (
                  <SeekChip seconds={t.timeSec} context={t.context} onSeek={onSeek} />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {songs.length > 0 && (
        <div className="mt-4">
          <span className="block text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
            Songs referenced
          </span>
          <ul className="mt-2 grid gap-2">
            {songs.map((s, i) => (
              <li
                key={`${i}-${s.title}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-[var(--line)] bg-[var(--bg-subtle)] px-3 py-2"
              >
                <span
                  className="min-w-0 truncate text-sm text-[var(--ink)]"
                  title={s.context || undefined}
                >
                  <span className="font-medium">{s.title}</span>
                  {s.artist && (
                    <span className="text-[var(--ink-muted)]"> — {s.artist}</span>
                  )}
                </span>
                {typeof s.timeSec === 'number' && (
                  <SeekChip seconds={s.timeSec} context={s.context} onSeek={onSeek} />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <footer className="mt-4 border-t border-[var(--line)] pt-3 text-[0.7rem] text-[var(--ink-muted)]">
        Extracted{' '}
        {extraction.generatedAt
          ? new Date(extraction.generatedAt).toLocaleDateString()
          : '—'}
        {extraction.model ? ` · ${extraction.model}` : ''} · timecodes are
        grounded against the transcript, not trusted from the model.
      </footer>
    </section>
  );
}

// Timecode seek chip — same look as TimecodeMarkdown's inline chips, on a
// card surface so it reads against the bg-subtle technique/song rows.
function SeekChip({
  seconds,
  context,
  onSeek,
}: Readonly<{
  seconds: number;
  context: string;
  onSeek: (seconds: number) => void;
}>) {
  const label = formatSeconds(seconds);
  return (
    <button
      type="button"
      onClick={() => onSeek(seconds)}
      title={context || undefined}
      aria-label={
        context
          ? `Jump to ${label}. Context: ${context.slice(0, 120)}`
          : `Jump to ${label} in the video`
      }
      className="inline-flex h-6 flex-none items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--card)] px-2 text-[0.7rem] font-semibold text-[var(--ink)] transition hover:bg-[var(--ink)] hover:text-[var(--cream)]"
    >
      <svg viewBox="0 0 16 16" width="9" height="9" aria-hidden="true">
        <path fill="currentColor" d="M4 2v12l9-6z" />
      </svg>
      {label}
    </button>
  );
}

// Inline, dismissible error — same destructive surface as the page's other
// inline AI errors (FailedState, VerdictBlock).
function ErrorLine({
  message,
  onDismiss,
}: Readonly<{ message: string; onDismiss: () => void }>) {
  return (
    <div className="mt-3 flex items-start justify-between gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2">
      <p className="text-xs text-destructive">{message}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss error"
        className="text-xs leading-4 text-destructive/70 transition hover:text-destructive"
      >
        ×
      </button>
    </div>
  );
}
