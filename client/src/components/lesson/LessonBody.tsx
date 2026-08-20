// Renders a lesson's dynamic-zone blocks.
//
// The `default` branch returns null on purpose. An AI-generated lesson (phase
// 2) can name a block that does not exist; degrading to a gap keeps the rest
// of the lesson readable, where throwing would blank the page. Same stance
// chat-stream.ts takes toward unknown SSE events.

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Step } from './Step';
import { MiniNeck } from './MiniNeck';
import { DegreeChips } from './DegreeChips';
import { resolveDiagramDots, type DiagramBlock } from '#/lib/lesson/diagram-params';
import type { LessonBlock, LessonParameter } from '#/lib/services/lessons';

const PITCH_OPTIONS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

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

    case 'lesson.callout':
      return (
        <aside className="rounded border border-[var(--line)] bg-[var(--bg-subtle)] px-3 py-2 text-sm text-[var(--ink-soft)]">
          {String(block.body ?? '')}
        </aside>
      );

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
      const diagramBlock = block as unknown as DiagramBlock;
      // resolveDiagramDots (Task 4) only ever produces fretboard-shaped
      // dots ({string, fret, ...}) — that's what its own tests cover, and
      // it's the only shape triadVoicing()/explicit dots can produce.
      // MiniKeyboard's `marks` are pitch-class-addressed (KeyMark.pc) and
      // MiniPush's `marks`/`pads` are pitch-class- or grid-addressed;
      // neither accepts a `dots` prop at all, and there is no converter
      // from fretboard dots to either shape. Rather than invent one, a
      // piano/push diagram degrades to the same "gap, not a throw" the
      // unknown-block default uses — that conversion is a later phase.
      if (diagramBlock.instrument !== 'guitar' && diagramBlock.instrument !== 'bass') {
        return null;
      }
      const dots = resolveDiagramDots(diagramBlock, paramValue);
      if (dots.length === 0) return null;
      const fromFret = typeof block.fromFret === 'number' ? block.fromFret : undefined;
      const toFret = typeof block.toFret === 'number' ? block.toFret : undefined;
      const ariaLabel =
        typeof block.label === 'string' && block.label.length > 0
          ? block.label
          : `${diagramBlock.instrument} chord diagram`;
      return (
        <MiniNeck
          instrument={diagramBlock.instrument}
          dots={dots}
          fromFret={fromFret}
          toFret={toFret}
          ariaLabel={ariaLabel}
        />
      );
    }

    case 'lesson.degree-chips':
      return (
        <DegreeChips
          degrees={(block.degrees as string[]) ?? []}
          size={(block.size as 'sm' | 'md') ?? 'md'}
        />
      );

    case 'lesson.table': {
      const headers = (block.headers as string[]) ?? [];
      const rows = (block.rows as string[][]) ?? [];
      return (
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
      const videoId = String(block.videoId ?? '');
      if (!videoId) return null;
      const t = Number(block.timeSec ?? 0);
      return (
        <a
          href={`/learn/${videoId}${t > 0 ? `?t=${t}` : ''}`}
          className="text-sm text-[var(--ink)] underline"
        >
          {String(block.label ?? 'Watch this moment')}
        </a>
      );
    }

    // lesson.interactive lands in Task 9, alongside the triads migration
    // it configures. Until then it falls through to the safe default.
    default:
      if (import.meta.env.DEV) {
        console.warn(`[LessonBody] unknown block: ${block.__component}`);
      }
      return null;
  }
}
