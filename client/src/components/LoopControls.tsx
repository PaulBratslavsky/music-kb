// LoopControls — A/B loop UI for the right-column video.
//
// Sits below the YouTube player. Inputs:
//   • Set A / Set B — buttons that capture currentSeconds (rough — for
//                     "grab it while it's going by")
//   • The [m:ss → m:ss] display is two editable text fields. Type a
//                     value, blur or press Enter to commit. Lets you
//                     nail an exact start/end the buttons would miss.
//   • Loop          — toggles the auto-seek engine on/off (only enabled
//                     when both A and B are set and A < B)
//
// State lives in PlayerProvider; this component is purely presentational.
// When the user crosses B during playback, the provider's effect seeks
// the player back to A — no work needed here.

import { useEffect, useState } from 'react';
import { usePlayerControl } from './player';

// Format seconds as m:ss for display in the inputs.
function formatSec(sec: number | null): string {
  if (sec == null) return '';
  const total = Math.max(0, Math.floor(sec));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Parse a free-form timestamp string into seconds. Accepts:
//   "65"        → 65
//   "1:05"      → 65
//   "1:23:45"   → 5025
//   ""          → null (clears the endpoint)
// Returns undefined on a parse failure so the caller can leave state untouched.
function parseSec(raw: string): number | null | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const parts = trimmed.split(':');
  if (parts.length > 3) return undefined;
  for (const p of parts) {
    if (!/^\d+(\.\d+)?$/.test(p)) return undefined;
  }
  const nums = parts.map(Number);
  let sec = 0;
  if (nums.length === 1) sec = nums[0];
  else if (nums.length === 2) sec = nums[0] * 60 + nums[1];
  else sec = nums[0] * 3600 + nums[1] * 60 + nums[2];
  if (sec < 0 || sec > 86_400) return undefined;
  return Math.floor(sec);
}

// Editable timestamp field. Mirrors the controlled `value` from props but
// holds its own draft string while focused so partial input ("1:") doesn't
// thrash the parsed state on every keystroke. Commits on blur or Enter.
function TimestampInput({
  value,
  onCommit,
  placeholder,
  ariaLabel,
}: {
  value: number | null;
  onCommit: (sec: number | null) => void;
  placeholder: string;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState(formatSec(value));
  const [focused, setFocused] = useState(false);
  const [bad, setBad] = useState(false);

  // Re-sync from props when the input isn't being edited (e.g. user
  // clicked Set A and the parent state changed).
  useEffect(() => {
    if (!focused) setDraft(formatSec(value));
  }, [value, focused]);

  const commit = () => {
    const parsed = parseSec(draft);
    if (parsed === undefined) {
      setBad(true);
      return;
    }
    setBad(false);
    onCommit(parsed);
    setDraft(formatSec(parsed));
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      aria-label={ariaLabel}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => {
        setDraft(e.target.value);
        if (bad) setBad(false);
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
      }}
      className={`w-14 rounded border bg-[var(--bg-subtle)] px-1.5 py-0.5 text-center font-mono text-xs text-[var(--ink)] focus:outline-none focus:ring-1 ${
        bad
          ? 'border-destructive ring-destructive'
          : 'border-[var(--line)] focus:border-[var(--accent)] focus:ring-[var(--accent)]'
      }`}
    />
  );
}

export function LoopControls() {
  const {
    currentSeconds,
    isReady,
    loopStartSec,
    loopEndSec,
    loopActive,
    setLoopStart,
    setLoopEnd,
    toggleLoopActive,
    clearLoop,
  } = usePlayerControl();

  const hasValidRegion =
    loopStartSec != null && loopEndSec != null && loopEndSec > loopStartSec;

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-[var(--line)] bg-[var(--card)] px-4 py-3 text-sm sm:px-6">
      <span className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
        Loop
      </span>

      <button
        type="button"
        disabled={!isReady}
        onClick={() => setLoopStart(currentSeconds)}
        className="inline-flex items-center gap-1 rounded-md border border-[var(--line)] bg-[var(--bg-subtle)] px-2.5 py-1 text-xs font-medium text-[var(--ink)] transition hover:border-[var(--line-strong)] disabled:opacity-50"
        title="Mark the loop start at the current playback time"
      >
        Set A
      </button>

      <button
        type="button"
        disabled={!isReady}
        onClick={() => setLoopEnd(currentSeconds)}
        className="inline-flex items-center gap-1 rounded-md border border-[var(--line)] bg-[var(--bg-subtle)] px-2.5 py-1 text-xs font-medium text-[var(--ink)] transition hover:border-[var(--line-strong)] disabled:opacity-50"
        title="Mark the loop end at the current playback time"
      >
        Set B
      </button>

      <span className="font-mono text-xs text-[var(--ink-soft)]">[</span>
      <TimestampInput
        value={loopStartSec}
        onCommit={setLoopStart}
        placeholder="0:00"
        ariaLabel="Loop start (m:ss)"
      />
      <span className="font-mono text-xs text-[var(--ink-soft)]">→</span>
      <TimestampInput
        value={loopEndSec}
        onCommit={setLoopEnd}
        placeholder="0:00"
        ariaLabel="Loop end (m:ss)"
      />
      <span className="font-mono text-xs text-[var(--ink-soft)]">]</span>

      <button
        type="button"
        disabled={!hasValidRegion}
        onClick={toggleLoopActive}
        className={`ml-auto inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
          loopActive
            ? 'border border-[var(--accent)] bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]'
            : 'border border-[var(--line)] bg-[var(--bg-subtle)] text-[var(--ink)] hover:border-[var(--line-strong)]'
        }`}
        title={
          hasValidRegion
            ? loopActive
              ? 'Turn loop off'
              : 'Turn loop on — player will seek A → B → A'
            : 'Set both A and B (with B after A) to enable looping'
        }
      >
        {loopActive ? '◉ Looping' : '◯ Loop'}
      </button>

      {(loopStartSec != null || loopEndSec != null || loopActive) && (
        <button
          type="button"
          onClick={clearLoop}
          className="text-xs text-[var(--ink-muted)] underline-offset-2 hover:text-[var(--ink)] hover:underline"
          title="Clear A and B"
        >
          clear
        </button>
      )}
    </div>
  );
}
