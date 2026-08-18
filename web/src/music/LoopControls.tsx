// LoopControls — A/B loop UI for the music player. Inline-styled so it
// renders correctly in the standalone (no Tailwind).
//
// Layout (single horizontal row):
//   [Set A] [Set B] | [start input] → [end input] | … (spacer) … [● Looping] [clear]
//
// Set A / Set B capture currentSeconds. The two inputs let the user
// type an exact start/end (e.g. "1:23") if the button-press timing was
// rough. Loop toggle only enables when both endpoints are set and
// end > start; clear resets the lot.

import { useEffect, useState } from 'react';
import { usePlayerControl } from './Player';

function formatSec(sec: number | null): string {
  if (sec == null) return '';
  const total = Math.max(0, Math.floor(sec));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function parseSec(raw: string): number | null | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const m = trimmed.match(/^(\d+):(\d{1,2})$/);
  if (m) {
    const mins = Number(m[1]);
    const secs = Number(m[2]);
    if (secs > 59) return undefined;
    return mins * 60 + secs;
  }
  return undefined;
}

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
      style={{
        width: 60,
        padding: '4px 6px',
        textAlign: 'center',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 12,
        color: 'var(--text)',
        background: 'var(--panel-2)',
        border: `1px solid ${bad ? 'var(--root)' : 'var(--border)'}`,
        borderRadius: 6,
        outline: 'none',
      }}
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

  const effectiveStart = loopStartSec ?? 0;
  const hasValidRegion = loopEndSec != null && loopEndSec > effectiveStart;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        borderTop: '1px solid var(--border)',
        background: 'var(--panel)',
        padding: '8px 12px',
        flexWrap: 'wrap',
      }}
    >
      <button
        type="button"
        disabled={!isReady}
        onClick={() => setLoopStart(currentSeconds)}
        className="chip"
        title="Mark the loop start at the current playback time"
        style={{ padding: '4px 10px', fontSize: 12 }}
      >
        Set A
      </button>

      <button
        type="button"
        disabled={!isReady}
        onClick={() => setLoopEnd(currentSeconds)}
        className="chip"
        title="Mark the loop end at the current playback time"
        style={{ padding: '4px 10px', fontSize: 12 }}
      >
        Set B
      </button>

      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '0 6px',
        }}
      >
        <TimestampInput
          value={loopStartSec}
          onCommit={setLoopStart}
          placeholder="0:00"
          ariaLabel="Loop start (m:ss)"
        />
        <span
          style={{
            fontFamily: 'ui-monospace, monospace',
            fontSize: 12,
            color: 'var(--text-dim)',
          }}
        >
          →
        </span>
        <TimestampInput
          value={loopEndSec}
          onCommit={setLoopEnd}
          placeholder="0:00"
          ariaLabel="Loop end (m:ss)"
        />
      </div>

      <button
        type="button"
        disabled={!hasValidRegion}
        onClick={toggleLoopActive}
        className={`chip${loopActive ? ' active' : ''}`}
        title={
          hasValidRegion
            ? loopActive
              ? 'Turn loop off'
              : 'Turn loop on — player will seek A → B → A'
            : 'Set both A and B (with B after A) to enable looping'
        }
        style={{
          marginLeft: 'auto',
          padding: '4px 12px',
          fontSize: 12,
          borderRadius: 999,
        }}
      >
        {loopActive ? '● Looping' : '○ Loop'}
      </button>

      {(loopStartSec != null || loopEndSec != null || loopActive) && (
        <button
          type="button"
          onClick={clearLoop}
          title="Clear A and B"
          style={{
            all: 'unset',
            cursor: 'pointer',
            fontSize: 12,
            color: 'var(--text-dim)',
            textDecoration: 'underline',
            textUnderlineOffset: 2,
          }}
        >
          clear
        </button>
      )}
    </div>
  );
}
