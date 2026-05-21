// Compact shorthand parser for the `?theory=` deep-link param on /learn/$videoId.
//
// The standalone visualizer encodes state via several search params
// (`mode=chord&root=C&quality=maj&inv=0&v=0` etc.), which conflicts with the
// learn route's own zod-validated search schema (it strips unknown params).
// Instead we bundle visualizer state into a single colon-delimited string:
//
//   chord:<root>:<quality>[:<inversion>[:<voicing>]]   e.g. "chord:C:maj"
//   scale:<root>:<type>                                e.g. "scale:C:major"
//   note:<root>                                        e.g. "note:C"
//
// Invalid input returns null and the caller falls back to DEFAULT_STATE — never
// throws, so a fat-fingered URL doesn't break the page.

import {
  PITCH_CLASSES,
  CHORD_QUALITIES,
  SCALE_TYPES,
  type AppState,
  type ChordQuality,
  type PitchClass,
  type ScaleType,
} from './types';
import { DEFAULT_STATE } from './state/useAppState';

const isPitchClass = (s: string): s is PitchClass =>
  (PITCH_CLASSES as readonly string[]).includes(s);
const isChordQuality = (s: string): s is ChordQuality =>
  (CHORD_QUALITIES as readonly string[]).includes(s);
const isScaleType = (s: string): s is ScaleType =>
  (SCALE_TYPES as readonly string[]).includes(s);

export function parseTheoryParam(raw: string | undefined): AppState | null {
  if (!raw) return null;
  const parts = raw.split(':');
  const kind = parts[0];

  if (kind === 'chord') {
    const [, root, quality, inv, voicing] = parts;
    if (!isPitchClass(root) || !isChordQuality(quality)) return null;
    const inversion = inv != null && /^\d+$/.test(inv) ? Number(inv) : 0;
    const voicingIndex = voicing != null && /^\d+$/.test(voicing) ? Number(voicing) : 0;
    return {
      ...DEFAULT_STATE,
      mode: 'chord',
      chord: { root, quality, inversion, voicingIndex },
    };
  }

  if (kind === 'scale') {
    const [, root, type] = parts;
    if (!isPitchClass(root) || !isScaleType(type)) return null;
    return {
      ...DEFAULT_STATE,
      mode: 'scale',
      scale: { root, type },
    };
  }

  if (kind === 'note') {
    const [, root] = parts;
    if (!isPitchClass(root)) return null;
    return {
      ...DEFAULT_STATE,
      mode: 'note',
      singleNote: root,
    };
  }

  return null;
}
