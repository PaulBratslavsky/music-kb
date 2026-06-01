// Single source of truth for validating a Composition. Shared by the
// save server function (strict input validation) and the read/load path
// (lenient parse + migration of stored rows). Keeping one schema avoids
// the drift that a hand-mirrored copy in the server-fn would cause.

import { z } from 'zod';
import type { Composition } from './types';
import { SCHEMA_VERSION, TOTAL_TICKS } from './types';

const DegreeSchema = z.number().int().min(1).max(7);

const SpanBase = {
  id: z.string().min(1).max(64),
  degree: DegreeSchema,
  start: z.number().int().min(0).max(TOTAL_TICKS - 1),
  length: z.number().int().min(1).max(TOTAL_TICKS),
};

const ChordSpanSchema = z.object(SpanBase);
const NoteSpanSchema = z.object({
  ...SpanBase,
  octave: z.union([z.literal(0), z.literal(1)]),
});

/**
 * Strict schema for a Composition. `version` is required (no `.optional()`
 * / `.default()`) on purpose: an optional property in a TanStack server
 * function's validated-data type breaks the ServerFn handler typing, so
 * the save path must receive a fully-formed composition.
 */
export const CompositionSchema = z.object({
  id: z.string().min(1).max(64),
  version: z.number().int().min(1).max(1_000_000),
  name: z.string().min(1).max(200),
  key: z.object({
    root: z.string().min(1).max(3),
    mode: z.enum(['major', 'minor']),
  }),
  bpm: z.number().int().min(20).max(400),
  chords: z.array(ChordSpanSchema).max(64),
  melody: z.array(NoteSpanSchema).max(512),
  bass: z.array(NoteSpanSchema).max(512),
});

// Lenient variant for reading stored rows: pre-versioning rows (saved
// before `version` existed) are missing the field, so default it.
const StoredCompositionSchema = CompositionSchema.extend({
  version: z.number().int().default(SCHEMA_VERSION),
});

/**
 * Validate + migrate a Composition read from storage. Returns null when
 * the blob can't be coerced into the current shape (so callers can drop
 * the row instead of crashing the editor). Add migration branches here
 * keyed on the parsed `version` as the shape evolves.
 */
export function parseStoredComposition(raw: unknown): Composition | null {
  const result = StoredCompositionSchema.safeParse(raw);
  if (!result.success) return null;
  const parsed = result.data;
  // Future: if (parsed.version < SCHEMA_VERSION) migrate step-by-step.
  return { ...parsed, version: SCHEMA_VERSION } as Composition;
}
