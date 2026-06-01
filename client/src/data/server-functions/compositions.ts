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
import {
  CompositionSchema,
  parseStoredComposition,
} from '#/lib/music/compose/schema';

// =============================================================================
// List — for the saved-compositions picker. Each row's `data` blob is
// validated/migrated on the way out; rows that can't be coerced into the
// current shape are dropped rather than crashing the editor on load.
// =============================================================================

export type ListCompositionsResult =
  | { status: 'ok'; compositions: StrapiComposition[]; dropped: number }
  | { status: 'error'; error: string };

export const listCompositions = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ListCompositionsResult> => {
    const result = await listCompositionsService();
    if (!result.success) return { status: 'error', error: result.error };
    const valid: StrapiComposition[] = [];
    let dropped = 0;
    for (const row of result.data) {
      const data = parseStoredComposition(row.data);
      if (data) valid.push({ ...row, data });
      else dropped += 1;
    }
    return { status: 'ok', compositions: valid, dropped };
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
