import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import {
  listLoopsForVideoService,
  getLoopByDocumentIdService,
  createLoopService,
  updateLoopService,
  deleteLoopService,
  type StrapiLoop,
} from '#/lib/services/loops';

// =============================================================================
// Schemas — validate at the server-fn boundary so the service layer can trust
// its inputs. Shape mirrors server/src/api/loop/content-types/loop/schema.json.
// =============================================================================

const KeySchema = z.object({
  root: z.string().min(1).max(3), // PitchClass: 'C', 'C#', etc.
  type: z.string().min(1).max(32), // ScaleType
});

const ChordEntrySchema = z.object({
  root: z.string().min(1).max(3),
  quality: z.string().min(1).max(16),
  durationBeats: z.number().min(0).max(1024).nullable(),
});

// =============================================================================
// List loops for a video — used by the right-column saved-loops list.
// =============================================================================

const ListLoopsSchema = z.object({
  videoDocumentId: z.string().min(1).max(64),
});

export type ListLoopsResult =
  | { status: 'ok'; loops: StrapiLoop[] }
  | { status: 'error'; error: string };

export const listLoopsForVideo = createServerFn({ method: 'GET' })
  .inputValidator((data: z.input<typeof ListLoopsSchema>) =>
    ListLoopsSchema.parse(data),
  )
  .handler(async ({ data }): Promise<ListLoopsResult> => {
    const result = await listLoopsForVideoService(data.videoDocumentId);
    if (!result.success) return { status: 'error', error: result.error };
    return { status: 'ok', loops: result.data };
  });

// =============================================================================
// Get one loop by documentId — used on reload (deep-link via ?loopId=…).
// =============================================================================

const GetLoopSchema = z.object({
  documentId: z.string().min(1).max(64),
});

export type GetLoopResult =
  | { status: 'ok'; loop: StrapiLoop | null }
  | { status: 'error'; error: string };

export const getLoop = createServerFn({ method: 'GET' })
  .inputValidator((data: z.input<typeof GetLoopSchema>) =>
    GetLoopSchema.parse(data),
  )
  .handler(async ({ data }): Promise<GetLoopResult> => {
    const result = await getLoopByDocumentIdService(data.documentId);
    if (!result.success) return { status: 'error', error: result.error };
    return { status: 'ok', loop: result.data };
  });

// =============================================================================
// Save (create) — Phase E's Save button POSTs through this. v1 is create-only
// (no update-in-place); editing a saved loop is "Save as new."
// =============================================================================

const SaveLoopSchema = z.object({
  videoDocumentId: z.string().min(1).max(64),
  label: z.string().min(1).max(120),
  startSec: z.number().int().min(0).max(86400),
  endSec: z.number().int().min(0).max(86400),
  key: KeySchema.nullable(),
  progression: z.array(ChordEntrySchema).max(64),
  bpm: z.number().int().min(20).max(400).nullable().optional(),
  bars: z.number().int().min(1).max(512).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  savedProgression: z.string().min(1).max(64).nullable().optional(),
});

export type SaveLoopResult =
  | { status: 'ok'; loop: StrapiLoop }
  | { status: 'error'; error: string };

export const saveLoop = createServerFn({ method: 'POST' })
  .inputValidator((data: z.input<typeof SaveLoopSchema>) => {
    const parsed = SaveLoopSchema.parse(data);
    if (parsed.endSec <= parsed.startSec) {
      throw new Error('endSec must be greater than startSec');
    }
    return parsed;
  })
  .handler(async ({ data }): Promise<SaveLoopResult> => {
    const result = await createLoopService({
      videoDocumentId: data.videoDocumentId,
      label: data.label,
      startSec: data.startSec,
      endSec: data.endSec,
      key: data.key,
      progression: data.progression,
      bpm: data.bpm ?? null,
      notes: data.notes ?? null,
    });
    if (!result.success) return { status: 'error', error: result.error };
    return { status: 'ok', loop: result.data };
  });

// =============================================================================
// Update — for the future edit-in-place flow. Not used in v1 UI, but exposed
// so MCP / future surfaces can patch a saved loop.
// =============================================================================

const UpdateLoopSchema = z.object({
  documentId: z.string().min(1).max(64),
  label: z.string().min(1).max(120).optional(),
  startSec: z.number().int().min(0).max(86400).optional(),
  endSec: z.number().int().min(0).max(86400).optional(),
  key: KeySchema.nullable().optional(),
  progression: z.array(ChordEntrySchema).max(64).optional(),
  bpm: z.number().int().min(20).max(400).nullable().optional(),
  bars: z.number().int().min(1).max(512).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  savedProgression: z.string().min(1).max(64).nullable().optional(),
});

export type UpdateLoopResult =
  | { status: 'ok'; loop: StrapiLoop }
  | { status: 'error'; error: string };

export const updateLoop = createServerFn({ method: 'POST' })
  .inputValidator((data: z.input<typeof UpdateLoopSchema>) =>
    UpdateLoopSchema.parse(data),
  )
  .handler(async ({ data }): Promise<UpdateLoopResult> => {
    const result = await updateLoopService(data);
    if (!result.success) return { status: 'error', error: result.error };
    return { status: 'ok', loop: result.data };
  });

// =============================================================================
// Delete — used by the right-column saved-loops list (each row gets an `×`).
// =============================================================================

const DeleteLoopSchema = z.object({
  documentId: z.string().min(1).max(64),
});

export type DeleteLoopResult =
  | { status: 'ok' }
  | { status: 'error'; error: string };

export const deleteLoopFn = createServerFn({ method: 'POST' })
  .inputValidator((data: z.input<typeof DeleteLoopSchema>) =>
    DeleteLoopSchema.parse(data),
  )
  .handler(async ({ data }): Promise<DeleteLoopResult> => {
    const result = await deleteLoopService(data.documentId);
    if (!result.success) return { status: 'error', error: result.error };
    return { status: 'ok' };
  });
