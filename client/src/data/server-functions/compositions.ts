import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import {
  listCompositionsService,
  createCompositionService,
  updateCompositionService,
  deleteCompositionService,
  type StrapiComposition,
} from '#/lib/services/compositions';
import type { Composition } from '#/lib/music/compose/types';

// =============================================================================
// Schema — validate the composition at the server-fn boundary so the
// service can trust it. Mirrors lib/music/compose/types.ts (tick units:
// sixteenth resolution, 128 ticks / 8 bars).
// =============================================================================

const DegreeSchema = z.number().int().min(1).max(7);
const SpanBase = {
  id: z.string().min(1).max(64),
  degree: DegreeSchema,
  start: z.number().int().min(0).max(127),
  length: z.number().int().min(1).max(128),
};
const ChordSpanSchema = z.object(SpanBase);
const NoteSpanSchema = z.object({
  ...SpanBase,
  octave: z.union([z.literal(0), z.literal(1)]),
});

const CompositionSchema = z.object({
  id: z.string().min(1).max(64),
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

// =============================================================================
// List — for the saved-compositions picker.
// =============================================================================

export type ListCompositionsResult =
  | { status: 'ok'; compositions: StrapiComposition[] }
  | { status: 'error'; error: string };

export const listCompositions = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ListCompositionsResult> => {
    const result = await listCompositionsService();
    if (!result.success) return { status: 'error', error: result.error };
    return { status: 'ok', compositions: result.data };
  },
);

// =============================================================================
// Save — create when documentId is null, else update in place.
// =============================================================================

const SaveSchema = z.object({
  documentId: z.string().min(1).max(64).nullable(),
  composition: CompositionSchema,
});

export type SaveCompositionResult =
  | { status: 'ok'; composition: StrapiComposition }
  | { status: 'error'; error: string };

export const saveComposition = createServerFn({ method: 'POST' })
  .inputValidator((data: z.input<typeof SaveSchema>) => SaveSchema.parse(data))
  .handler(async ({ data }): Promise<SaveCompositionResult> => {
    // zod widens degree→number / root→string; the schema enforces the
    // real ranges, so assert back to the precise Composition type.
    const composition = data.composition as Composition;
    const title = composition.name;
    const result = data.documentId
      ? await updateCompositionService(data.documentId, title, composition)
      : await createCompositionService(title, composition);
    if (!result.success) return { status: 'error', error: result.error };
    return { status: 'ok', composition: result.data };
  });

// =============================================================================
// Delete.
// =============================================================================

const DeleteSchema = z.object({ documentId: z.string().min(1).max(64) });

export type DeleteCompositionResult =
  | { status: 'ok' }
  | { status: 'error'; error: string };

export const deleteComposition = createServerFn({ method: 'POST' })
  .inputValidator((data: z.input<typeof DeleteSchema>) =>
    DeleteSchema.parse(data),
  )
  .handler(async ({ data }): Promise<DeleteCompositionResult> => {
    const result = await deleteCompositionService(data.documentId);
    if (!result.success) return { status: 'error', error: result.error };
    return { status: 'ok' };
  });
