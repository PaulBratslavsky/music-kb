// Renders a lesson's dynamic-zone blocks.
//
// The `default` branch returns null on purpose. An AI-generated lesson (phase
// 2) can name a block that does not exist; degrading to a gap keeps the rest
// of the lesson readable, where throwing would blank the page. Same stance
// chat-stream.ts takes toward unknown SSE events.

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Link } from '@tanstack/react-router';
import { Step } from './Step';
import { MiniNeck } from './MiniNeck';
import { MiniKeyboard } from './MiniKeyboard';
import { DegreeChips } from './DegreeChips';
import {
  resolveDiagramDots,
  resolveDiagramMarks,
  type DiagramBlock,
  type KeyboardDiagramBlock,
} from '#/lib/lesson/diagram-params';
import type { LessonBlock, LessonParameter } from '#/lib/services/lessons';
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

export function LessonBody({
  blocks,
  parameter,
}: Readonly<{ blocks: LessonBlock[]; parameter: LessonParameter | null }>) {
  const [paramValue, setParamValue] = useState(parameter?.default ?? 'C');

  return (
    <div className="flex flex-col gap-6">
      {blocks.map((b) => (
        <Block
          key={`${b.__component}-${b.id}`}
          block={b}
          parameter={parameter}
          paramValue={paramValue}
          onParamChange={setParamValue}
        />
      ))}
    </div>
  );
}

function Block({
  block,
  parameter,
  paramValue,
  onParamChange,
}: Readonly<{
  block: LessonBlock;
  parameter: LessonParameter | null;
  paramValue: string;
  onParamChange: (v: string) => void;
}>) {
  switch (block.__component) {
    case 'lesson.prose':
      return (
        <div className="prose-lesson max-w-none text-sm text-[var(--ink-soft)]">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {String(block.body ?? '')}
          </ReactMarkdown>
        </div>
      );

    case 'lesson.heading': {
      const text = String(block.text ?? '');
      return block.level === 'h3' ? (
        <h3 className="text-base font-semibold text-[var(--ink)]">{text}</h3>
      ) : (
        <h2 className="text-lg font-semibold text-[var(--ink)]">{text}</h2>
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
        </aside>
      );
    }

    case 'lesson.step':
      return (
        <Step
          number={Number(block.number ?? 1)}
          title={String(block.title ?? '')}
          lede={String(block.lede ?? '')}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {String(block.body ?? '')}
          </ReactMarkdown>
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
          {caption ? (
            <p className="text-xs text-[var(--ink-muted)]">{caption}</p>
          ) : null}
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
          {caption ? (
            <p className="text-xs text-[var(--ink-muted)]">{caption}</p>
          ) : null}
        </div>
      );
    }

    case 'lesson.degree-chips':
      return (
        <DegreeChips
          degrees={Array.isArray(block.degrees) ? block.degrees.map(String) : []}
          size={(block.size as 'sm' | 'md') ?? 'md'}
        />
      );

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
          {caption ? (
            <p className="text-xs text-[var(--ink-muted)]">{caption}</p>
          ) : null}
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
      // Internal route (/learn/$videoId) — a TanStack Link, not a raw <a>,
      // so navigation stays client-side instead of a full page reload.
      const videoId = String(block.videoId ?? '');
      if (!videoId) return null;
      const t = Number(block.timeSec ?? 0);
      return (
        <Link
          to="/learn/$videoId"
          params={{ videoId }}
          search={t > 0 ? { t } : undefined}
          className="text-sm text-[var(--ink)] underline"
        >
          {String(block.label ?? 'Watch this moment')}
        </Link>
      );
    }

    // lesson.interactive has no consumer yet — it's a phase-2 seam that
    // renders null until something needs it.
    default:
      if (import.meta.env.DEV) {
        console.warn(`[LessonBody] unknown block: ${block.__component}`);
      }
      return null;
  }
}
