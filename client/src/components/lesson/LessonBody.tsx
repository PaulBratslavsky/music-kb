// Renders a lesson's dynamic-zone blocks.
//
// The `default` branch returns null on purpose. An AI-generated lesson (phase
// 2) can name a block that does not exist; degrading to a gap keeps the rest
// of the lesson readable, where throwing would blank the page. Same stance
// chat-stream.ts takes toward unknown SSE events.

import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Link } from '@tanstack/react-router';
import { Step } from './Step';
import { MiniNeck, type NeckDot } from './MiniNeck';
import { MiniKeyboard } from './MiniKeyboard';
import { DegreeChips } from './DegreeChips';
import { ChordDiagram, type ChordStringState } from './ChordDiagram';
import { NaturalNotesStrings } from './NaturalNotesStrings';
import { NeckPatternPicker, type NeckPattern } from './NeckPatternPicker';
import {
  resolveDiagramDots,
  resolveDiagramMarks,
  type DiagramBlock,
  type KeyboardDiagramBlock,
} from '#/lib/lesson/diagram-params';
import type {
  JsonValue,
  LessonBlock,
  LessonParameter,
  LessonSourceVideo,
} from '#/lib/services/lessons';
import { PITCH_CLASSES } from '@music-kb/music/types';

const PITCH_OPTIONS = PITCH_CLASSES;

const CALLOUT_TONE: Record<
  string,
  { border: string; bg: string; label: string; labelClass: string }
> = {
  note: {
    border: 'border-l-[var(--line)]',
    bg: 'bg-[var(--bg-subtle)]',
    label: 'Note',
    labelClass: 'text-[var(--ink-muted)]',
  },
  tip: {
    border: 'border-l-[var(--band-green-dot)]',
    bg: 'bg-[var(--band-green-bg)]',
    label: 'Tip',
    labelClass: 'text-[var(--band-green-text)]',
  },
  warning: {
    border: 'border-l-[var(--band-yellow-dot)]',
    bg: 'bg-[var(--band-yellow-bg)]',
    label: 'Warning',
    labelClass: 'text-[var(--band-yellow-text)]',
  },
};

/** DOM id for a `lesson.heading` block, shared with LessonNav so its jump
 *  links land on the exact element LessonBody renders. `block.id` alone is
 *  enough — it comes from `components_lesson_headings`' own id sequence,
 *  so it is unique among headings even though it is NOT unique across
 *  different component types in the same body (see the `${__component}-
 *  ${id}` React key just below, which exists for that reason). */
export function headingAnchorId(blockId: number): string {
  return `lesson-heading-${blockId}`;
}

/** For each block, the heading level (`h2` or, deliberately, the implicit
 *  top-level default when no heading has appeared yet) of the section it
 *  currently sits inside — tracked by walking the body once and updating
 *  on every `lesson.heading` block. Steps use this to nest one level below
 *  their enclosing section (brief #1) instead of hardcoding `h2` and
 *  colliding with it. Exported for the same reason as headingAnchorId:
 *  pinned directly by a unit test rather than only exercised indirectly. */
export function deriveSectionLevels(blocks: LessonBlock[]): Array<'h2' | 'h3'> {
  const levels: Array<'h2' | 'h3'> = [];
  let current: 'h2' | 'h3' = 'h2';
  for (const b of blocks) {
    if (b.__component === 'lesson.heading') {
      current = b.level === 'h3' ? 'h3' : 'h2';
    }
    levels.push(current);
  }
  return levels;
}

// -- Citation de-duplication -------------------------------------------------
//
// Brief #2: the same citation repeating on up to nine consecutive blocks
// reads as noise, not evidence. Collapsed here at the render layer only —
// `block.source` is never modified, so the "Built from" section and every
// individual block's underlying data stay intact; a block that had its
// citation suppressed still carries the same `source` it always did.
//
// Comparison is against the IMMEDIATELY PRECEDING block only, not the last
// block that happened to carry a citation — a block with no source of its
// own (a heading, a table, a param-picker) breaks the run, so the citation
// after it shows again even if it would have matched the run before. That
// matches the reader's experience: something else appeared on the page in
// between, so the reminder of where a claim came from is welcome again.
const COMPARABLE_TIMESEC_WINDOW_SEC = 5;
// BM25 grounds each block's citation independently against transcript
// chunks. Two adjacent blocks landing within a few seconds of each other
// are, in practice, the model paraphrasing the same source passage across
// multiple blocks — not two different moments worth citing separately. A
// genuinely new moment in a longer explanation typically lands much
// farther away than this; 5s is a deliberately tight window so a real
// second citation is never swallowed by mistake.

type CitationKey = { videoId: string; timeSec?: number };

function citationKey(source: JsonValue | undefined): CitationKey | null {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  const record = source as Record<string, JsonValue>;
  const videoId = typeof record.videoId === 'string' ? record.videoId : '';
  if (!videoId) return null;
  const timeSec = typeof record.timeSec === 'number' ? record.timeSec : undefined;
  return { videoId, timeSec };
}

function citationsComparable(a: CitationKey, b: CitationKey | null): boolean {
  if (!b || a.videoId !== b.videoId) return false;
  if (a.timeSec === undefined && b.timeSec === undefined) return true;
  if (a.timeSec === undefined || b.timeSec === undefined) return false;
  return Math.abs(a.timeSec - b.timeSec) <= COMPARABLE_TIMESEC_WINDOW_SEC;
}

/** Per-block "suppress this block's citation" flags, derived by comparing
 *  each block's `source` against the block immediately before it. Exported
 *  for direct testing alongside deriveSectionLevels/headingAnchorId. */
export function deriveCitationSuppression(blocks: LessonBlock[]): boolean[] {
  return blocks.map((b, i) => {
    if (i === 0) return false;
    const cur = citationKey(b.source);
    if (!cur) return false;
    return citationsComparable(cur, citationKey(blocks[i - 1].source));
  });
}

export function LessonBody({
  blocks,
  parameter,
  sourceVideos = [],
}: Readonly<{
  blocks: LessonBlock[];
  parameter: LessonParameter | null;
  /** The lesson's resolved source videos (relation or block-derived
   * fallback — see getLessonBySlugWithStatus). Used to turn a block's
   * `source.videoId` into a real title + link; a citation naming a video
   * not in this set renders nothing rather than a broken link. */
  sourceVideos?: LessonSourceVideo[];
}>) {
  const [paramValue, setParamValue] = useState(parameter?.default ?? 'C');

  // Only videos with a known title are lookup-able — a citation for a
  // video we can't title is treated the same as one outside the lesson's
  // source set (render nothing), never a raw id. See SourceNote.
  const sourceVideoMap = useMemo(
    () =>
      new Map(
        sourceVideos
          .filter((v) => v.videoTitle)
          .map((v) => [v.youtubeVideoId, v] as const),
      ),
    [sourceVideos],
  );

  const sectionLevels = useMemo(() => deriveSectionLevels(blocks), [blocks]);
  const citationSuppressed = useMemo(() => deriveCitationSuppression(blocks), [blocks]);

  return (
    // gap-10, not the old gap-6: the block-to-block gap needs to read as
    // clearly bigger than the gap-1 used *inside* a block (prose/diagram/
    // table to its own caption or citation) — otherwise a citation floats
    // ambiguously between the block above it and the block below.
    <div className="flex flex-col gap-10">
      {blocks.map((b, i) => (
        <Block
          key={`${b.__component}-${b.id}`}
          block={b}
          parameter={parameter}
          paramValue={paramValue}
          onParamChange={setParamValue}
          sourceVideoMap={sourceVideoMap}
          stepHeadingLevel={sectionLevels[i] === 'h3' ? 'h4' : 'h3'}
          suppressCitation={citationSuppressed[i]}
        />
      ))}
    </div>
  );
}

// Small line beneath a block — supporting evidence, not content. Styled
// deliberately UNLIKE Caption below (brief #5): a diagram's caption
// explains the figure it sits under, a citation says where the claim it
// sits under was verified — different jobs, so they need to stop reading
// as one run of identical grey text. The "Source" kicker plus a step down
// in size (11px vs Caption's text-xs/12px) marks this as metadata, the
// same way a footnote or a byline reads differently from body copy.
//
// `source` is `{ videoId, timeSec? }` (lesson.source component); timeSec
// is optional (BM25 grounding deliberately omits it when there's no
// confident match) and must never serialize as a literal `t=undefined`.
//
// `target="_blank"` deliberately, not a same-tab TanStack `Link` nav:
// lessons are meant to be self-contained — the reader should never get
// thrown out of the lesson mid-read to go look at a citation. A citation
// opens alongside the lesson, never in place of it. TanStack Router's Link
// itself honors `target` (skips its own preventDefault/client-nav when
// target !== '_self', see node_modules/@tanstack/react-router link.js),
// so this is just letting the browser do native new-tab navigation.
function SourceNote({
  source,
  sourceVideoMap,
  suppressed = false,
}: Readonly<{
  source: JsonValue | undefined;
  sourceVideoMap: Map<string, LessonSourceVideo>;
  /** True when the immediately preceding block already showed this same
   *  citation (brief #2) — see deriveCitationSuppression. The underlying
   *  `source` data is untouched; this only skips the render. */
  suppressed?: boolean;
}>) {
  if (suppressed) return null;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  const record = source as Record<string, JsonValue>;
  const videoId = typeof record.videoId === 'string' ? record.videoId : '';
  if (!videoId) return null;
  const video = sourceVideoMap.get(videoId);
  if (!video) return null;
  const timeSec = typeof record.timeSec === 'number' ? record.timeSec : undefined;
  return (
    <p className="flex items-center gap-1.5 text-[11px] text-[var(--ink-muted)]">
      <span className="font-medium uppercase tracking-wide">Source</span>
      <Link
        to="/learn/$videoId"
        params={{ videoId }}
        search={timeSec !== undefined ? { t: timeSec } : undefined}
        target="_blank"
        rel="noopener noreferrer"
        className="hover:underline"
      >
        {video.videoTitle}
      </Link>
    </p>
  );
}

// A figure's caption — belongs to the visual it sits under, explains what
// it shows. Italic and a step darker (`ink-soft`) than SourceNote's
// `ink-muted`/uppercase-kicker treatment (brief #5): the two used to share
// one style (`text-xs text-[var(--ink-muted)]`) and read as a single run
// of grey text with no way to tell caption from citation at a glance.
function Caption({ text }: Readonly<{ text: string }>) {
  if (!text) return null;
  return <p className="text-xs italic text-[var(--ink-soft)]">{text}</p>;
}

// -- Block-payload coercion -------------------------------------------------
//
// Nested components arrive as plain JSON off a Strapi row, typed only as
// `JsonValue` — there is no shape guarantee at the schema level and an
// AI-authored lesson is exactly the kind of input that can arrive
// malformed. Same stance as the table block below: coerce forgivingly, let
// a bad entry degrade to a gap, never throw mid-render.

const NUMBER = (v: JsonValue | undefined): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

function asRecord(value: JsonValue): Record<string, JsonValue> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : null;
}

/** lesson.neck-dot[] → MiniNeck's NeckDot[]. Drops entries without a
 *  usable string/fret pair; carries all four style flags through. */
function toNeckDots(value: JsonValue | undefined): NeckDot[] {
  if (!Array.isArray(value)) return [];
  const dots: NeckDot[] = [];
  for (const entry of value) {
    const rec = asRecord(entry);
    if (!rec) continue;
    const string = NUMBER(rec.string);
    const fret = NUMBER(rec.fret);
    if (string === undefined || fret === undefined) continue;
    dots.push({
      string,
      fret,
      label: typeof rec.label === 'string' ? rec.label : undefined,
      root: rec.root === true,
      dim: rec.dim === true,
      hollow: rec.hollow === true,
      ringed: rec.ringed === true,
      light: rec.light === true,
    });
  }
  return dots;
}

/** lesson.chord-string[] → ChordDiagram's positional six-string array.
 *  Entries are addressed by their own `string` index, so order in the
 *  stored array doesn't matter and a missing string stays muted. A
 *  `fretted` entry at fret 0 is read as open — fret 0 IS the open string,
 *  and treating it as a silent no-op would be the more surprising reading. */
function toChordStrings(value: JsonValue | undefined): ChordStringState[] {
  const states: ChordStringState[] = Array.from({ length: 6 }, () => ({
    kind: 'muted',
  }));
  if (!Array.isArray(value)) return states;
  for (const entry of value) {
    const rec = asRecord(entry);
    if (!rec) continue;
    const index = NUMBER(rec.string);
    if (index === undefined || index < 0 || index > 5) continue;
    const fret = NUMBER(rec.fret) ?? 0;
    if (rec.state === 'fretted' && fret > 0) {
      states[index] = { kind: 'fretted', fret, isRoot: rec.root === true };
    } else if (rec.state === 'open' || (rec.state === 'fretted' && fret === 0)) {
      states[index] = { kind: 'open' };
    } else {
      states[index] = { kind: 'muted' };
    }
  }
  return states;
}

/** lesson.neck-pattern-item[] → NeckPatternPicker's patterns. A pattern
 *  with no drawable dots is dropped rather than shown as an empty pill. */
function toNeckPatterns(value: JsonValue | undefined): NeckPattern[] {
  if (!Array.isArray(value)) return [];
  const patterns: NeckPattern[] = [];
  value.forEach((entry, i) => {
    const rec = asRecord(entry);
    if (!rec) return;
    const dots = toNeckDots(rec.dots);
    if (dots.length === 0) return;
    patterns.push({
      label: typeof rec.label === 'string' && rec.label ? rec.label : `Pattern ${i + 1}`,
      sub: typeof rec.sub === 'string' ? rec.sub : undefined,
      dots,
    });
  });
  return patterns;
}

// Caption + citation, the trailing pair every visual block carries. Kept
// as one component so the two never drift back out of sync stylistically —
// see Caption and SourceNote above for why they look different now.
function BlockFooter({
  caption,
  source,
  sourceVideoMap,
  suppressCitation,
}: Readonly<{
  caption: string;
  source: JsonValue | undefined;
  sourceVideoMap: Map<string, LessonSourceVideo>;
  suppressCitation: boolean;
}>) {
  return (
    <>
      <Caption text={caption} />
      <SourceNote source={source} sourceVideoMap={sourceVideoMap} suppressed={suppressCitation} />
    </>
  );
}

function Block({
  block,
  parameter,
  paramValue,
  onParamChange,
  sourceVideoMap,
  stepHeadingLevel,
  suppressCitation,
}: Readonly<{
  block: LessonBlock;
  parameter: LessonParameter | null;
  paramValue: string;
  onParamChange: (v: string) => void;
  sourceVideoMap: Map<string, LessonSourceVideo>;
  /** The `<h3>`/`<h4>` a `lesson.step` in this position should title
   *  itself with — see deriveSectionLevels. Unused by every other case. */
  stepHeadingLevel: 'h3' | 'h4';
  /** Whether this block's own citation duplicates the block immediately
   *  before it — see deriveCitationSuppression. Passed to every case that
   *  renders a SourceNote/BlockFooter. */
  suppressCitation: boolean;
}>) {
  switch (block.__component) {
    case 'lesson.prose':
      return (
        <div className="flex flex-col gap-1">
          <div className="prose-lesson max-w-none text-sm text-[var(--ink-soft)]">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {String(block.body ?? '')}
            </ReactMarkdown>
          </div>
          <SourceNote
            source={block.source}
            sourceVideoMap={sourceVideoMap}
            suppressed={suppressCitation}
          />
        </div>
      );

    case 'lesson.heading': {
      // `mt-*` on top of the flex gap, deliberately nothing added below:
      // a heading should read as closer to the section it opens than to
      // the block that came before it, and the parent's gap-10 already
      // gives it that trailing space.
      //
      // `id` is the anchor LessonNav's table-of-contents jumps to (brief
      // #3) — see headingAnchorId's doc comment for why block.id alone is
      // safe to use here.
      const text = String(block.text ?? '');
      const id = headingAnchorId(block.id);
      return block.level === 'h3' ? (
        <h3 id={id} className="mt-4 scroll-mt-20 text-base font-semibold text-[var(--ink)]">
          {text}
        </h3>
      ) : (
        <h2 id={id} className="mt-6 scroll-mt-20 text-lg font-semibold text-[var(--ink)]">
          {text}
        </h2>
      );
    }

    case 'lesson.callout': {
      const tone =
        CALLOUT_TONE[String(block.tone ?? 'note')] ?? CALLOUT_TONE.note;
      return (
        <aside
          className={`rounded border border-[var(--line)] border-l-4 px-3 py-2 text-sm text-[var(--ink-soft)] ${tone.border} ${tone.bg}`}
        >
          <p className={`mb-1 text-xs font-semibold uppercase tracking-wide ${tone.labelClass}`}>
            {tone.label}
          </p>
          {String(block.body ?? '')}
          <SourceNote
            source={block.source}
            sourceVideoMap={sourceVideoMap}
            suppressed={suppressCitation}
          />
        </aside>
      );
    }

    case 'lesson.step':
      return (
        <Step
          number={Number(block.number ?? 1)}
          title={String(block.title ?? '')}
          lede={String(block.lede ?? '')}
          headingLevel={stepHeadingLevel}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {String(block.body ?? '')}
          </ReactMarkdown>
          <SourceNote
            source={block.source}
            sourceVideoMap={sourceVideoMap}
            suppressed={suppressCitation}
          />
        </Step>
      );

    case 'lesson.diagram': {
      // lesson.diagram is fretboard-only (guitar/bass) — resolveDiagramDots
      // only ever produces fretboard-shaped dots ({string, fret, ...}), and
      // MiniNeck is the only renderer that takes them. Keyboard diagrams
      // are a separate block (lesson.keyboard-diagram, below): pitch-class
      // addressed, a different shape entirely.
      const diagramBlock = block as unknown as DiagramBlock;
      const dots = resolveDiagramDots(diagramBlock, paramValue);
      if (dots.length === 0) return null;
      const fromFret = typeof block.fromFret === 'number' ? block.fromFret : undefined;
      const toFret = typeof block.toFret === 'number' ? block.toFret : undefined;
      const caption = typeof block.caption === 'string' ? block.caption : '';
      const ariaLabel =
        caption.length > 0 ? caption : `${diagramBlock.instrument} chord diagram`;
      return (
        <div className="flex flex-col gap-1">
          <MiniNeck
            instrument={diagramBlock.instrument as 'guitar' | 'bass'}
            dots={dots}
            fromFret={fromFret}
            toFret={toFret}
            ariaLabel={ariaLabel}
          />
          <Caption text={caption} />
          <SourceNote
            source={block.source}
            sourceVideoMap={sourceVideoMap}
            suppressed={suppressCitation}
          />
        </div>
      );
    }

    case 'lesson.keyboard-diagram': {
      const keyboardBlock = block as unknown as KeyboardDiagramBlock;
      const marks = resolveDiagramMarks(keyboardBlock, paramValue);
      if (marks.length === 0) return null;
      const caption = typeof block.caption === 'string' ? block.caption : '';
      const ariaLabel = caption.length > 0 ? caption : 'keyboard chord diagram';
      return (
        <div className="flex flex-col gap-1">
          <MiniKeyboard
            marks={marks}
            octaves={keyboardBlock.octaves ?? undefined}
            ariaLabel={ariaLabel}
          />
          <Caption text={caption} />
          <SourceNote
            source={block.source}
            sourceVideoMap={sourceVideoMap}
            suppressed={suppressCitation}
          />
        </div>
      );
    }

    case 'lesson.chord-diagram': {
      // The songbook chord box — "how do I hold this chord" — as opposed
      // to lesson.diagram's stretch of neck, which answers "where do these
      // notes live". Different question, different picture, so a separate
      // block rather than a mode of the other one.
      const strings = toChordStrings(block.strings);
      if (strings.every((s) => s.kind === 'muted')) return null;
      const barreFret = NUMBER(block.barreFret);
      const barreFrom = NUMBER(block.barreFromString);
      const barreTo = NUMBER(block.barreToString);
      const barre =
        barreFret !== undefined && barreFrom !== undefined && barreTo !== undefined
          ? { fret: barreFret, fromString: barreFrom, toString: barreTo }
          : undefined;
      const caption = typeof block.caption === 'string' ? block.caption : '';
      return (
        <div className="flex flex-col gap-1">
          <ChordDiagram
            strings={strings}
            barre={barre}
            fretCount={NUMBER(block.fretCount)}
            startFret={NUMBER(block.startFret)}
            orientation={block.orientation === 'horizontal' ? 'horizontal' : 'vertical'}
            ariaLabel={caption.length > 0 ? caption : 'chord diagram'}
          />
          <BlockFooter
            caption={caption}
            source={block.source}
            sourceVideoMap={sourceVideoMap}
            suppressCitation={suppressCitation}
          />
        </div>
      );
    }

    case 'lesson.neck-pattern': {
      // Several patterns, one shared neck. Renders nothing below two
      // patterns: one pattern is a lesson.diagram, and a picker with a
      // single pill is a control that does nothing.
      const patterns = toNeckPatterns(block.patterns);
      if (patterns.length < 2) return null;
      const caption = typeof block.caption === 'string' ? block.caption : '';
      return (
        <div className="flex flex-col gap-1">
          <NeckPatternPicker
            patterns={patterns}
            instrument={block.instrument === 'bass' ? 'bass' : 'guitar'}
            fromFret={NUMBER(block.fromFret)}
            toFret={NUMBER(block.toFret)}
          />
          <BlockFooter
            caption={caption}
            source={block.source}
            sourceVideoMap={sourceVideoMap}
            suppressCitation={suppressCitation}
          />
        </div>
      );
    }

    case 'lesson.natural-notes': {
      // Fixed reference diagram — no parameters, by design. The block is
      // its own presence plus an optional caption.
      const caption = typeof block.caption === 'string' ? block.caption : '';
      return (
        <div className="flex flex-col gap-1">
          <NaturalNotesStrings />
          <BlockFooter
            caption={caption}
            source={block.source}
            sourceVideoMap={sourceVideoMap}
            suppressCitation={suppressCitation}
          />
        </div>
      );
    }

    case 'lesson.degree-chips': {
      // A bare row of numbers means nothing on its own — "1 2 3 4 5 6 7"
      // floating in a lesson reads as a pagination control, not a scale.
      // Every other visual block carries a caption; this one did not, which
      // is why it was the one block a reader could not identify. `label`
      // names what the row IS, `caption` says what to notice about it.
      const chipLabel = typeof block.label === 'string' ? block.label.trim() : '';
      const chipCaption = typeof block.caption === 'string' ? block.caption.trim() : '';
      return (
        <figure className="m-0">
          {chipLabel ? (
            <figcaption className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--ink-muted)]">
              {chipLabel}
            </figcaption>
          ) : null}
          <DegreeChips
            degrees={Array.isArray(block.degrees) ? block.degrees.map(String) : []}
            size={(block.size as 'sm' | 'md') ?? 'md'}
          />
          {chipCaption ? (
            <figcaption className="mt-2 text-xs text-[var(--ink-muted)]">
              {chipCaption}
            </figcaption>
          ) : null}
        </figure>
      );
    }

    case 'lesson.table': {
      // `headers`/`rows` are Strapi `json` columns — no shape guarantee at
      // the schema level, and phase-2 AI output is exactly the kind of
      // input that can arrive malformed. Coerce forgivingly rather than
      // trust the cast: a malformed cell degrades to a gap, never a 500.
      const headers = Array.isArray(block.headers)
        ? block.headers.map(String)
        : [];
      const rows = Array.isArray(block.rows)
        ? block.rows.filter(Array.isArray).map((r) => r.map(String))
        : [];
      const caption = typeof block.caption === 'string' ? block.caption : '';
      return (
        <div className="flex flex-col gap-1">
          <table className="w-full text-sm">
            <thead>
              <tr>
                {headers.map((h) => (
                  <th key={h} className="text-left text-[var(--ink-muted)]">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j} className="text-[var(--ink-soft)]">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <Caption text={caption} />
        </div>
      );
    }

    case 'lesson.param-picker':
      if (!parameter) return null;
      return (
        <label className="flex items-center gap-2 text-sm">
          <span className="text-[var(--ink-muted)]">
            {String(block.label ?? parameter.label)}
          </span>
          <select
            value={paramValue}
            onChange={(e) => onParamChange(e.target.value)}
            className="rounded border border-[var(--line)] bg-[var(--bg-subtle)] px-2 py-1"
          >
            {PITCH_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
      );

    case 'lesson.video-ref': {
      // Internal route (/learn/$videoId) via a TanStack Link so the URL
      // build (params/search) stays type-checked, but `target="_blank"`
      // so it opens alongside the lesson rather than navigating away from
      // it — lessons are meant to be self-contained; this is the same
      // reason diagrams render inline instead of linking out. See the
      // longer comment on SourceNote above.
      const videoId = String(block.videoId ?? '');
      if (!videoId) return null;
      const t = Number(block.timeSec ?? 0);
      return (
        <Link
          to="/learn/$videoId"
          params={{ videoId }}
          search={t > 0 ? { t } : undefined}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-[var(--ink)] underline"
        >
          {String(block.label ?? 'Watch this moment')}
        </Link>
      );
    }

    // Unknown blocks render as nothing rather than throwing, so a malformed
    // or newer lesson degrades to a gap instead of taking down the page.
    // `lesson.interactive` used to land here — it was declared in the schema
    // with no renderer, which meant an author (or a model, via the createLesson
    // MCP tool) could produce an invisible hole with no error anywhere. It was
    // removed from the dynamic zone rather than left as a seam; re-add it here
    // and in the schema together, never one without the other.
    default:
      if (import.meta.env.DEV) {
        console.warn(`[LessonBody] unknown block: ${block.__component}`);
      }
      return null;
  }
}
