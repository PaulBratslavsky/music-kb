// The four instrument boards as a tab set.
//
// They used to stack down the page, which reads well but spent most of a
// screen before you reached anything else. One at a time now.
//
// Every panel stays MOUNTED and the inactive ones are `hidden`, rather than
// rendering only the active tab. Two reasons, both load-bearing:
//
//  - The chord builder exports a board by querying the live DOM for
//    `[data-board="<key>"] svg.instrument-svg`. Unmounting the other three
//    would leave three of its four export buttons doing nothing at all, with
//    no error — the handler just finds no SVG and returns. Hiding is safe
//    because exportFretboardPng never measures layout: it reads the SVG's own
//    viewBox, and a cropped export reads the marker circles' attributes.
//    (`png-export.test.ts` pins that every board ships a viewBox.)
//  - Game mode is per-board state living in useAppState. Unmounting would not
//    clear it, but remounting would replay the board's entry animation and
//    throw away scroll position mid-drill.
//
// The cost is that all four boards render on every selection change even
// though three are invisible. At this size — four SVGs of a few hundred nodes
// — that is not worth the machinery to avoid, and the alternative costs
// correctness rather than milliseconds.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  INSTRUMENT_TABS,
  readInstrumentTab,
  writeInstrumentTab,
  type InstrumentTab,
} from '../music/instrument-tab';

export function InstrumentTabs({
  panels,
  boardsRef,
}: {
  /** Panel contents per board. The wrapper, `data-board` and the tabpanel
   *  semantics are this component's job; everything inside is the caller's. */
  panels: Record<InstrumentTab, ReactNode>;
  /** Forwarded to the container so the chord builder can scope its export
   *  queries to the boards. */
  boardsRef: React.RefObject<HTMLDivElement | null>;
}) {
  // Read on mount rather than during render: localStorage is unavailable
  // during SSR and the first client render has to match the server's.
  const [active, setActive] = useState<InstrumentTab>(() => readInstrumentTab());
  useEffect(() => setActive(readInstrumentTab()), []);

  const select = useCallback((tab: InstrumentTab) => {
    setActive(tab);
    writeInstrumentTab(tab);
  }, []);

  const tabRefs = useRef<Partial<Record<InstrumentTab, HTMLButtonElement | null>>>({});

  // Arrow keys move between tabs, which is what a tablist is expected to do
  // once it takes focus — without it the strip is a row of buttons you have
  // to Tab through one at a time.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const keys = INSTRUMENT_TABS.map((t) => t.key);
    const i = keys.indexOf(active);
    let next: InstrumentTab | null = null;
    if (e.key === 'ArrowRight') next = keys[(i + 1) % keys.length];
    else if (e.key === 'ArrowLeft') next = keys[(i - 1 + keys.length) % keys.length];
    else if (e.key === 'Home') next = keys[0];
    else if (e.key === 'End') next = keys[keys.length - 1];
    if (!next) return;
    e.preventDefault();
    select(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <div className="instruments" ref={boardsRef}>
      <div className="instrument-tablist" role="tablist" aria-label="Instrument" onKeyDown={onKeyDown}>
        {INSTRUMENT_TABS.map((t) => {
          const selected = t.key === active;
          return (
            <button
              key={t.key}
              ref={(el) => {
                tabRefs.current[t.key] = el;
              }}
              type="button"
              role="tab"
              id={`instrument-tab-${t.key}`}
              aria-controls={`instrument-panel-${t.key}`}
              aria-selected={selected}
              // Roving tabindex: the strip is one stop, arrows move within it.
              tabIndex={selected ? 0 : -1}
              className={`chip${selected ? ' active' : ''}`}
              onClick={() => select(t.key)}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {INSTRUMENT_TABS.map((t) => (
        <div
          key={t.key}
          className="panel instrument-tabpanel"
          data-board={t.key}
          role="tabpanel"
          id={`instrument-panel-${t.key}`}
          aria-labelledby={`instrument-tab-${t.key}`}
          hidden={t.key !== active}
        >
          {panels[t.key]}
        </div>
      ))}
    </div>
  );
}
