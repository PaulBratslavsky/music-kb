// /theory — standalone music-theory tools page. Hosts the Circle of Fifths
// visualizer and friends in the "Tools" tab, the full instrument
// visualizer (piano + guitar + push) in the "Visualizer" tab — the same
// component the /learn/$videoId Theory tab uses — and the generated
// cheat sheet in the "Reference" tab.

import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { z } from 'zod';
import { CircleOfFifths } from '#/components/CircleOfFifths';
import { ChordSubstitutions } from '#/components/ChordSubstitutions';
import { IntervalCalculator } from '#/components/IntervalCalculator';
import { StringPairs } from '#/components/StringPairs';
import { PatternMirror } from '#/components/PatternMirror';
import { ViewTabs } from '#/components/ViewTabs';
import TheoryCompanion from '#/lib/music/TheoryCompanion';
import { parseTheoryParam } from '#/lib/music/deep-link';
import { ProgressionPlayer } from '#/components/practice/ProgressionPlayer';
import { EarTrainer } from '#/components/practice/EarTrainer';
import { RomanAnalyzer } from '#/components/practice/RomanAnalyzer';
import { ScaleChordFinder } from '#/components/practice/ScaleChordFinder';
import { Composer } from '#/components/compose/Composer';
import { TheoryReference } from '#/components/TheoryReference';
import {
  CIRCLE_MAJORS,
  CIRCLE_MAJOR_DISPLAY,
  CIRCLE_MINOR_DISPLAY,
  type CircleDirection,
} from '#/lib/music/circle-of-fifths';

const TheorySearchSchema = z.object({
  tab: z.enum(['tools', 'practice', 'visualizer', 'compose', 'reference']).optional(),
});

export const Route = createFileRoute('/theory')({
  component: TheoryPage,
  validateSearch: TheorySearchSchema,
  head: () => ({ meta: [{ title: 'Music theory · Music KB' }] }),
});

type TheoryTab = 'tools' | 'practice' | 'visualizer' | 'compose' | 'reference';

const TABS: Array<{ id: TheoryTab; label: string }> = [
  { id: 'tools', label: 'Theory tools' },
  { id: 'practice', label: 'Practice' },
  { id: 'visualizer', label: 'Visualizer' },
  { id: 'compose', label: 'Compose' },
  { id: 'reference', label: 'Reference' },
];

function TheoryPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const activeTab: TheoryTab = search.tab ?? 'tools';

  // Tonic state is shared between the Circle and the Substitutions panel —
  // clicking a wedge on the wheel re-pivots both the diatonic family
  // shown on the circle and the substitution suggestions below. It also
  // seeds the Visualizer tab's initial scale when the user switches over.
  const [tonicIdx, setTonicIdx] = useState(0);
  // The embedded Circle in the Guitar Tuning section gets its own
  // direction state, defaulted to 'fourths' (the entire point of that
  // section). User can still toggle it back to fifths from the embedded
  // header for side-by-side comparison.
  const [guitarCircleDir, setGuitarCircleDir] = useState<CircleDirection>('fourths');

  const setTab = (id: TheoryTab) => {
    // Keep tab=tools out of the URL (default) so links to /theory stay clean.
    navigate({ search: id === 'tools' ? {} : { tab: id }, replace: true });
  };

  // /theory drops the shared `.page-wrap` (which caps at 1120px) so the
  // visualizer + side-by-side tools can use the full viewport width.
  // Only side padding keeps the content off the chrome edges.
  return (
    <main className="mx-auto w-full px-4 py-8 sm:px-8 sm:py-12 xl:px-12">
      <header className="mb-6">
        <h1 className="display-title text-3xl text-[var(--ink)] sm:text-4xl">
          Music theory
        </h1>
        <p className="mt-2 text-sm text-[var(--ink-soft)]">
          Interactive theory tools that work independently of any video or
          instrument. Click around to explore — or jump to{' '}
          <strong className="text-[var(--ink)]">Reference</strong> when you
          just need to look a formula up.
        </p>
        <div className="mt-4">
          <ViewTabs<TheoryTab>
            active={activeTab}
            tabs={TABS}
            onChange={setTab}
          />
        </div>
      </header>

      {activeTab === 'visualizer' ? (
        <VisualizerTab tonicIdx={tonicIdx} />
      ) : activeTab === 'practice' ? (
        <PracticeTab />
      ) : activeTab === 'compose' ? (
        <ComposeTab tonicIdx={tonicIdx} />
      ) : activeTab === 'reference' ? (
        <TheoryReference />
      ) : (
        <ToolsTab
          tonicIdx={tonicIdx}
          setTonicIdx={setTonicIdx}
          guitarCircleDir={guitarCircleDir}
          setGuitarCircleDir={setGuitarCircleDir}
        />
      )}
    </main>
  );
}

function ToolsTab({
  tonicIdx,
  setTonicIdx,
  guitarCircleDir,
  setGuitarCircleDir,
}: {
  tonicIdx: number;
  setTonicIdx: (idx: number) => void;
  guitarCircleDir: CircleDirection;
  setGuitarCircleDir: (d: CircleDirection) => void;
}) {
  // Audio toggle is shared across both Circle instances on this tab —
  // mute on one, mute on both. Defaults to sound-on so the click-to-play
  // feature is discoverable.
  const [audioMuted, setAudioMuted] = useState(false);
  return (
    <>
      <section>
        <h2 className="text-base font-semibold text-[var(--ink)]">
          Circle of fifths
        </h2>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          Pick any key as the tonic — the diatonic chord family (I-IV-V plus
          relative minors) lights up, and the wheel shows the key signature.
        </p>
        <div className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,560px)_1fr] lg:items-start">
            {/* Left column: the wheel itself. */}
            <div>
              <CircleOfFifths
            tonicIdx={tonicIdx}
            onTonicChange={setTonicIdx}
            audioMuted={audioMuted}
            onAudioMutedChange={setAudioMuted}
          />
            </div>
            {/* Right column: contextual side panel — deep-links to /builder
                for the picked tonic, plus a short legend so a first-time
                visitor knows what the rings + highlights mean without
                trial-and-error clicking.

                Sharp-side tonics (C..F#) link with sharp spellings; flat-side
                keys are still passed as sharps since /builder's parser only
                accepts the sharp form (Db → C#, Bb → A#, etc.). */}
            <aside className="flex flex-col gap-5 lg:pt-2">
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                  View on fretboard
                </h3>
                <div className="flex flex-col gap-2 text-xs">
                  <Link
                    to="/builder"
                    search={{ theory: `scale:${CIRCLE_MAJORS[tonicIdx]}:major` }}
                    className="inline-flex items-center justify-between gap-2 rounded-full border border-[var(--accent)] bg-[var(--accent-soft)] px-3 py-1.5 font-medium text-[var(--accent)] no-underline hover:bg-[var(--accent)] hover:text-white"
                  >
                    <span>{CIRCLE_MAJOR_DISPLAY[tonicIdx]} major scale</span>
                    <span aria-hidden>→</span>
                  </Link>
                  <Link
                    to="/builder"
                    search={{ theory: `scale:${CIRCLE_MAJORS[tonicIdx]}:minor` }}
                    className="inline-flex items-center justify-between gap-2 rounded-full border border-[var(--accent)] bg-[var(--accent-soft)] px-3 py-1.5 font-medium text-[var(--accent)] no-underline hover:bg-[var(--accent)] hover:text-white"
                    title={`Relative minor: ${CIRCLE_MINOR_DISPLAY[tonicIdx]}`}
                  >
                    <span>{CIRCLE_MINOR_DISPLAY[tonicIdx]} natural minor</span>
                    <span aria-hidden>→</span>
                  </Link>
                  <Link
                    to="/builder"
                    search={{ theory: `chord:${CIRCLE_MAJORS[tonicIdx]}:maj` }}
                    className="inline-flex items-center justify-between gap-2 rounded-full border border-[var(--accent)] bg-[var(--accent-soft)] px-3 py-1.5 font-medium text-[var(--accent)] no-underline hover:bg-[var(--accent)] hover:text-white"
                  >
                    <span>{CIRCLE_MAJOR_DISPLAY[tonicIdx]} chord</span>
                    <span aria-hidden>→</span>
                  </Link>
                </div>
              </div>
              <div className="rounded-lg border border-[var(--line)] bg-[var(--bg-subtle)] p-3 text-xs text-[var(--ink-muted)]">
                <p className="mb-1 font-semibold text-[var(--ink)]">
                  How to read this
                </p>
                <ul className="ml-4 list-disc space-y-1">
                  <li>
                    <strong className="text-[var(--ink)]">Outer ring</strong> =
                    major keys. Click a wedge to set tonic + major mode.
                  </li>
                  <li>
                    <strong className="text-[var(--ink)]">Inner ring</strong> =
                    relative minors. Click to set tonic + minor mode.
                  </li>
                  <li>
                    Highlighted wedges are the seven diatonic chords (I, ii,
                    iii, IV, V, vi, vii°).
                  </li>
                  <li>
                    One step clockwise = up a fifth — or up a fourth when the
                    Fourths toggle is on.
                  </li>
                </ul>
              </div>
            </aside>
          </div>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-base font-semibold text-[var(--ink)]">
          Chord substitutions
        </h2>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          Common reharmonization options for the diatonic chords of the
          selected key — replacement chords, secondary dominants, and
          modal interchange (borrowed from the parallel minor). Click any
          chord name to view it on the fretboard.
        </p>
        <div className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
          <ChordSubstitutions tonicIdx={tonicIdx} />
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-base font-semibold text-[var(--ink)]">
          Interval calculator
        </h2>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          Pick two notes — see the interval name, semitone count, and what
          it inverts to. Hit Hear it to audition the pair.
        </p>
        <div className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
          <IntervalCalculator />
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-base font-semibold text-[var(--ink)]">
          Guitar tuning theory
        </h2>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          Why patterns repeat on the fretboard — and why one spot always
          throws you off. The guitar is tuned in 4ths except for one step
          (G→B is a 3rd), so the strings cluster into three pairs that
          mirror each other. Everything below — the Circle of Fourths,
          the string-pair lanes, and the pattern mirror — is self-contained
          so you don't have to scroll back up.
        </p>
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,520px)_1fr] lg:items-start">
          {/* Left column: Circle of fourths. Sticky on lg+ so it stays in
              view while the user scrolls the (taller) right column. */}
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6 lg:sticky lg:top-6">
            <h3 className="mb-1 text-sm font-semibold text-[var(--ink)]">
              Circle of fourths (guitar-friendly view)
            </h3>
            <p className="mb-4 text-xs text-[var(--ink-muted)]">
              Same tonic as the wheel at the top of this page, but rendered
              with clockwise = up a 4th instead of up a 5th. Now V sits to
              the left of the tonic and IV to the right — matching how
              shapes shift across the four-tuned string pairs to the right.
            </p>
            <CircleOfFifths
              tonicIdx={tonicIdx}
              onTonicChange={setTonicIdx}
              direction={guitarCircleDir}
              onDirectionChange={setGuitarCircleDir}
              audioMuted={audioMuted}
              onAudioMutedChange={setAudioMuted}
            />
          </div>
          {/* Right column: String Pairs + Pattern Mirror. They sit together
              so when the user clicks a wedge on the Circle (left), the
              shape on the fretboard (right) updates without scrolling. */}
          <div className="flex flex-col gap-6">
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
              <h3 className="mb-3 text-sm font-semibold text-[var(--ink)]">
                String pairs
              </h3>
              <StringPairs />
            </div>
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
              <h3 className="mb-3 text-sm font-semibold text-[var(--ink)]">
                Pattern mirror — one idea, three voices
              </h3>
              <PatternMirror
                tonicCircleIdx={tonicIdx}
                direction={guitarCircleDir}
              />
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

function PracticeTab() {
  return (
    <div className="flex flex-col gap-10">
      <section>
        <h2 className="text-base font-semibold text-[var(--ink)]">
          Find the chords in a scale
        </h2>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          Pick a key and a box, then go find that chord inside the shape on
          your own instrument before revealing it. Triads are the three-note
          chords hiding in every scale position; power chords strip them to
          root and fifth. Boxes are the same ones the rest of the app uses,
          transcribed from guitarscale.org.
        </p>
        <div className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
          <ScaleChordFinder />
        </div>
      </section>

      <section>
        <h2 className="text-base font-semibold text-[var(--ink)]">
          Progression Player
        </h2>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          Pick a key, click the diatonic chord chips to build a progression,
          then loop it at your chosen tempo. Audio plays through the same
          synth as the Circle's wedge-click feature.
        </p>
        <div className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
          <ProgressionPlayer />
        </div>
      </section>

      <section>
        <h2 className="text-base font-semibold text-[var(--ink)]">
          Ear Trainer
        </h2>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          Three drill modes — interval ID, chord-quality ID, cadence ID.
          Listen, pick, see if you got it. Streak resets on a wrong guess.
        </p>
        <div className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
          <EarTrainer />
        </div>
      </section>

      <section>
        <h2 className="text-base font-semibold text-[var(--ink)]">
          Roman Numeral Analyzer
        </h2>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          Paste a progression, pick a key — each chord gets a Roman numeral
          plus functional category (tonic / pre-dominant / dominant /
          chromatic). Detects diatonic, secondary dominants, and common
          modal-interchange chords.
        </p>
        <div className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
          <RomanAnalyzer />
        </div>
      </section>
    </div>
  );
}

function ComposeTab({ tonicIdx }: { tonicIdx: number }) {
  // Seed the composer's key with the tonic picked on the Circle (Tools
  // tab). CIRCLE_MAJORS stores sharp-side PitchClass names, which is
  // exactly what Composition.key.root expects.
  return (
    <section>
      <h2 className="text-base font-semibold text-[var(--ink)]">
        Progression composer
      </h2>
      <p className="mt-1 text-sm text-[var(--ink-muted)]">
        Sketch an 8-bar progression in scale degrees. Pick a key, click a
        bar then a chord to place it, and loop it at your chosen tempo.
        Everything is stored relative to the key, so changing the key
        transposes the whole sketch.
      </p>
      <div className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-6">
        <Composer initialRoot={CIRCLE_MAJORS[tonicIdx]} />
      </div>
    </section>
  );
}

function VisualizerTab({ tonicIdx }: { tonicIdx: number }) {
  // Seed the visualizer with the tonic the user picked on the Circle so
  // switching tabs feels continuous. We build a `scale:<pc>:major`
  // shorthand and let parseTheoryParam construct the AppState — same code
  // path /builder uses for deep-links.
  //
  // parseTheoryParam only accepts sharp spellings (PITCH_CLASSES). The
  // CIRCLE_MAJORS array already stores sharp-side names (C, G, ... F#, C#,
  // G#, D#, A#, F), so it lines up without conversion.
  const initialState =
    parseTheoryParam(`scale:${CIRCLE_MAJORS[tonicIdx]}:major`) ?? undefined;

  return (
    <section>
      <p className="mb-4 text-sm text-[var(--ink-muted)]">
        Full instrument visualizer — piano, guitar, and Push grid for the
        scale or chord you pick. Same view as the Theory tab on a video
        page, but standalone. Seeded with{' '}
        <span className="font-medium text-[var(--ink)]">
          {CIRCLE_MAJOR_DISPLAY[tonicIdx]} major
        </span>{' '}
        from the Circle on the Tools tab — change scale or mode from the
        controls below.
      </p>
      <TheoryCompanion initialState={initialState} />
    </section>
  );
}
