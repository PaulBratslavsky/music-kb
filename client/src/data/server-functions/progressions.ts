import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import {
  listProgressionsService,
  createProgressionService,
  updateProgressionService,
  deleteProgressionService,
  type ProgressionChord,
  type StrapiProgression,
} from '#/lib/services/progressions';

// 12 pitch classes (sharp-spelled) — the builder's PitchClass set.
const PITCH_CLASSES = [
  'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B',
] as const;

// quality is a short label (maj, min, maj7, m7b5, sus4, …); validated as a
// bounded string rather than enumerating the full ChordQuality union, which
// the builder is the only writer of anyway. inversion + voicingIndex capture
// the on-screen voicing; optional + defaulted so legacy {root,quality} rows
// still validate.
const ProgressionChordSchema = z.object({
  root: z.enum(PITCH_CLASSES),
  quality: z.string().min(1).max(12),
  inversion: z.number().int().min(0).max(11).default(0),
  voicingIndex: z.number().int().min(0).max(64).default(0),
});

const ChordsSchema = z.array(ProgressionChordSchema).min(1).max(64);

// =============================================================================
// List — for the saved-progressions picker.
// =============================================================================

export type ListProgressionsResult =
  | { status: 'ok'; progressions: StrapiProgression[] }
  | { status: 'error'; error: string };

export const listProgressions = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ListProgressionsResult> => {
    const result = await listProgressionsService();
    if (!result.success) return { status: 'error', error: result.error };
    // Drop rows whose `chords` blob isn't a usable array (corrupt/legacy)
    // rather than crashing the builder on load.
    const valid = result.data.filter((p) => Array.isArray(p.chords));
    return { status: 'ok', progressions: valid };
  },
);

// =============================================================================
// Save — create when documentId is null, else update in place.
// =============================================================================

const SaveSchema = z.object({
  documentId: z.string().min(1).max(64).nullable(),
  name: z.string().trim().min(1).max(100),
  chords: ChordsSchema,
});

export type SaveProgressionResult =
  | { status: 'ok'; progression: StrapiProgression }
  | { status: 'error'; error: string };

export const saveProgression = createServerFn({ method: 'POST' })
  .inputValidator((data: z.input<typeof SaveSchema>) => SaveSchema.parse(data))
  .handler(async ({ data }): Promise<SaveProgressionResult> => {
    // zod widens quality (string) — assert back to the precise chord type.
    const chords = data.chords as ProgressionChord[];
    const result = data.documentId
      ? await updateProgressionService(data.documentId, data.name, chords)
      : await createProgressionService(data.name, chords);
    if (!result.success) return { status: 'error', error: result.error };
    return { status: 'ok', progression: result.data };
  });

// =============================================================================
// Delete.
// =============================================================================

const DeleteSchema = z.object({ documentId: z.string().min(1).max(64) });

export type DeleteProgressionResult =
  | { status: 'ok' }
  | { status: 'error'; error: string };

export const deleteProgression = createServerFn({ method: 'POST' })
  .inputValidator((data: z.input<typeof DeleteSchema>) =>
    DeleteSchema.parse(data),
  )
  .handler(async ({ data }): Promise<DeleteProgressionResult> => {
    const result = await deleteProgressionService(data.documentId);
    if (!result.success) return { status: 'error', error: result.error };
    return { status: 'ok' };
  });
