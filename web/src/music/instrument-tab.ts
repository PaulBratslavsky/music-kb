// Which of the four instrument boards the Builder page is showing.
//
// The boards used to stack down the page, which read well but cost most of a
// screen before you reached the chord builder. They are a tab set now, and
// this module owns the one piece of state that outlives a render: which tab
// you had open last.
//
// It is deliberately NOT in the URL. `useAppState` puts the selection there
// because a link to "?mode=chord&root=C" should reproduce what the sender was
// looking at; the tab is a per-viewer convenience, and a shared link should
// not impose the sender's choice of instrument on the recipient.

/**
 * The tab keys double as the `data-board` attribute on each panel, which is
 * how ChordBuilderPanel finds a board's SVG to export
 * (`[data-board="<key>"] svg.instrument-svg`). Renaming one without renaming
 * the attribute silently breaks that board's export button.
 */
export const INSTRUMENT_TABS = [
  { key: 'piano', label: 'Piano' },
  { key: 'guitar', label: 'Guitar' },
  { key: 'bass', label: 'Bass' },
  { key: 'push', label: 'Push' },
] as const;

export type InstrumentTab = (typeof INSTRUMENT_TABS)[number]['key'];

export const DEFAULT_INSTRUMENT_TAB: InstrumentTab = 'guitar';

const KEY = 'tv:instrument-tab';

function isInstrumentTab(v: string | null): v is InstrumentTab {
  return INSTRUMENT_TABS.some((t) => t.key === v);
}

/**
 * The tab to open on. Anything unexpected — no window (SSR), a throwing
 * localStorage (private window, blocked site data), an absent key, or a value
 * written by a build that had different boards — resolves to the default
 * rather than propagating. A bad read here would render an empty panel with
 * no tab selected and no way back to a real one.
 */
export function readInstrumentTab(): InstrumentTab {
  if (typeof window === 'undefined') return DEFAULT_INSTRUMENT_TAB;
  try {
    const raw = window.localStorage.getItem(KEY);
    return isInstrumentTab(raw) ? raw : DEFAULT_INSTRUMENT_TAB;
  } catch {
    return DEFAULT_INSTRUMENT_TAB;
  }
}

/** Remember the open tab. Failure is not worth surfacing — the tab still
 *  works for this visit, it just will not be restored on the next one. */
export function writeInstrumentTab(tab: InstrumentTab): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, tab);
  } catch {
    /* quota or private mode — the choice simply is not remembered */
  }
}
