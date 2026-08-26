// Shared lesson dynamic-zone block schema for the MCP lesson write tools
// (create_lesson, update_lesson). This is the SINGLE declaration of the
// block vocabulary for the MCP authoring path — it mirrors
// server/src/components/lesson/*.json, which are the source of truth for
// what a valid block looks like on the Strapi side. Both write tools import
// from here rather than each declaring their own copy (see ADR 0008 on why
// a second, drifting copy of a tool's schema is exactly the failure mode
// this task exists to avoid).
//
// Why validation lives entirely in this zod schema rather than a separate
// hand-rolled checker: the official Strapi MCP server runs zod's own parse
// against a tool's `schema` before the tool's `execute()` ever runs (see
// @modelcontextprotocol/sdk's `validateToolInput`, which calls
// `safeParseAsync` and reports every issue's `message` plus its dot-path —
// e.g. `body.2.stringSet` — back to the calling model as the tool-call
// error). So a good `.describe()` plus a targeted `.superRefine()` message
// here IS what the model sees when it gets a block wrong. Get this schema
// right and there is no second validation pass to keep in sync.
//
// Every object schema below is `.strict()` on purpose: zod's default
// "strip unknown keys" behavior would silently drop a misspelled field
// (e.g. `boxy` instead of `body`) and hand back a lesson that renders with
// a gap and no error anywhere — the exact failure mode this task is about.
import { z } from 'zod';

export const PITCH_CLASSES = [
  'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B',
] as const;

const TRIAD_QUALITIES = ['major', 'minor', 'augmented', 'diminished'] as const;

// EN DASH (U+2013), NOT a hyphen (U+002D). This is a known trap: a model
// (or a human) reaches for the ASCII hyphen on a keyboard and produces a
// string that LOOKS right but fails the enum. The superRefine below
// detects exactly that mistake and names the fix.
const STRING_SETS = ['e–B–G', 'B–G–D', 'G–D–A', 'D–A–E'] as const;

// -----------------------------------------------------------------------------
// Theory-mode intents: which COMBINATIONS the theory layer can actually draw
// -----------------------------------------------------------------------------
//
// A theory diagram names what it is OF — a chord, a scale box, an arpeggio
// position, a 3NPS pattern — and @music-kb/music realizes the dots. Which
// means the interesting validation is not "is this a legal enum value" but
// "is this a legal COMBINATION": `intent="scale" scaleType="majorPentatonic"
// position="2"` is four legal values naming a box that scale does not ship,
// and realizing it produces an empty array that renders as a blank
// fretboard with no error anywhere. Four blank fretboards reached published
// lessons exactly that way, which is why the tables below exist and why
// every refusal quotes the legal set back.
//
// Duplicated from @music-kb/music rather than imported, for the same reason
// as STANDARD_TUNING_MIDI above: server/tsconfig.json is CommonJS with
// Node10 resolution and the package's subpath exports need
// bundler/node16 — confirmed by adding the dependency and watching
// `tsc --noEmit` fail with TS2307. `client/src/lib/lesson/theory-intent-
// parity.test.ts` reads this file as TEXT (client never imports server/)
// and asserts every table below still equals what `arpeggioPositions()`,
// `scalePositions()` and `getScalePitchClasses()` actually answer. Add a
// shape source in packages/music and that test fails here until this file
// catches up — which is the point: the duplication is checked, not trusted.
const DIAGRAM_INTENTS = ['chord', 'scale', 'arpeggio', 'pattern'] as const;

/** The whole position vocabulary — the scale boxes' own, minus 'all'. */
const DIAGRAM_POSITIONS = ['1', '2', '3', '4', '5', '2oct'] as const;

/**
 * The long spellings `lesson.diagram.quality` has taken since it could only
 * voice triads, and their canonical `ChordQuality` names. Exact aliases:
 * `major` IS `maj`. Kept because the stored lessons are full of them.
 */
const LEGACY_TRIAD_SPELLINGS: ReadonlyArray<readonly [string, string]> = [
  ['major', 'maj'],
  ['minor', 'min'],
  ['augmented', 'aug'],
  ['diminished', 'dim'],
];

/**
 * Every position each quality has an arpeggio shape in — `arpeggioPositions()`
 * in packages/music, tabulated.
 *
 * Written out per quality rather than as "all six for everything" so that a
 * future shape source covering only some positions has a place to say so,
 * and so the parity test compares a table against a table.
 *
 * The qualities NOT here (9, maj9, m9, 11, m11, 13, m13, 7b9, 7#9, alt)
 * have more than four distinct tones. Inside one hand position a five- or
 * six-note chord lights up half the window and the picture stops being an
 * arpeggio and starts being a scale box, so the theory layer refuses them
 * by tone count — and so does this schema, by not listing them.
 */
const ARPEGGIO_POSITIONS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['5', ['1', '2', '3', '4', '5', '2oct']],
  ['maj', ['1', '2', '3', '4', '5', '2oct']],
  ['min', ['1', '2', '3', '4', '5', '2oct']],
  ['dim', ['1', '2', '3', '4', '5', '2oct']],
  ['aug', ['1', '2', '3', '4', '5', '2oct']],
  ['sus2', ['1', '2', '3', '4', '5', '2oct']],
  ['sus4', ['1', '2', '3', '4', '5', '2oct']],
  ['6', ['1', '2', '3', '4', '5', '2oct']],
  ['m6', ['1', '2', '3', '4', '5', '2oct']],
  ['maj7', ['1', '2', '3', '4', '5', '2oct']],
  ['min7', ['1', '2', '3', '4', '5', '2oct']],
  ['dom7', ['1', '2', '3', '4', '5', '2oct']],
  ['m7b5', ['1', '2', '3', '4', '5', '2oct']],
  ['dim7', ['1', '2', '3', '4', '5', '2oct']],
  ['mMaj7', ['1', '2', '3', '4', '5', '2oct']],
  ['7sus4', ['1', '2', '3', '4', '5', '2oct']],
  ['add9', ['1', '2', '3', '4', '5', '2oct']],
  ['madd9', ['1', '2', '3', '4', '5', '2oct']],
  ['7b5', ['1', '2', '3', '4', '5', '2oct']],
  ['7#5', ['1', '2', '3', '4', '5', '2oct']],
];

/**
 * Every position each scale type has a box for — `scalePositions()` in
 * packages/music, tabulated. NOT uniform, which is the whole point:
 * majorPentatonic ships boxes 1 and 5 only, and the five modes ship no
 * numbered box at all. `'2oct'` is on every row because the two-octave
 * window is universal.
 */
const SCALE_POSITIONS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['major', ['1', '2', '3', '4', '5', '2oct']],
  ['minor', ['1', '2', '3', '4', '5', '2oct']],
  ['harmonicMinor', ['1', '2', '3', '4', '5', '2oct']],
  ['melodicMinor', ['1', '2', '3', '4', '5', '2oct']],
  ['dorian', ['2oct']],
  ['phrygian', ['2oct']],
  ['lydian', ['2oct']],
  ['mixolydian', ['2oct']],
  ['locrian', ['2oct']],
  ['majorPentatonic', ['1', '5', '2oct']],
  ['minorPentatonic', ['1', '2', '3', '4', '5', '2oct']],
  ['blues', ['1', '2', '3', '4', '5', '2oct']],
];

/**
 * How many notes each scale has — which is how many three-notes-per-string
 * patterns it has, since pattern N starts on scale degree N.
 */
const SCALE_NOTE_COUNTS: ReadonlyArray<readonly [string, number]> = [
  ['major', 7],
  ['minor', 7],
  ['harmonicMinor', 7],
  ['melodicMinor', 7],
  ['dorian', 7],
  ['phrygian', 7],
  ['lydian', 7],
  ['mixolydian', 7],
  ['locrian', 7],
  ['majorPentatonic', 5],
  ['minorPentatonic', 5],
  ['blues', 6],
];

const SCALE_TYPES = SCALE_POSITIONS.map(([type]) => type) as [string, ...string[]];
const ARPEGGIO_POSITION_MAP = new Map(ARPEGGIO_POSITIONS);
const SCALE_POSITION_MAP = new Map(SCALE_POSITIONS);
const SCALE_NOTE_COUNT_MAP = new Map(SCALE_NOTE_COUNTS);
const CANONICAL_QUALITY = new Map(LEGACY_TRIAD_SPELLINGS);

/** The `quality` values `intent="chord"` can voice — triadVoicing() does triads and nothing else. */
const CHORD_INTENT_QUALITIES = [
  ...LEGACY_TRIAD_SPELLINGS.map(([spelling]) => spelling),
  ...LEGACY_TRIAD_SPELLINGS.map(([, canonical]) => canonical),
] as [string, ...string[]];

/**
 * Every `quality` the block accepts: the four legacy spellings, then every
 * quality with an arpeggio shape. Derived from the tables above, never
 * hand-listed a second time.
 */
const DIAGRAM_QUALITIES = [
  ...LEGACY_TRIAD_SPELLINGS.map(([spelling]) => spelling),
  ...ARPEGGIO_POSITIONS.map(([quality]) => quality),
] as [string, ...string[]];

/** A block `quality` under its canonical name, folding the legacy spellings in. */
function canonicalQuality(value: string): string {
  return CANONICAL_QUALITY.get(value) ?? value;
}

// -----------------------------------------------------------------------------
// Pitch labels are computed, not trusted — same rule as timecodes
// -----------------------------------------------------------------------------
//
// This project already refuses to store a timecode the model produced (BM25-
// grounded against the real transcript instead — see verifyCitations). A
// live audit found the same failure mode here: 8 of 60 pitch-labelled neck
// dots named the wrong note (13%), clustered on the inner strings. The
// position was always right; only the name was wrong. A pitch name at a
// fret position is arithmetic, so `correctPitchLabels` below fixes it after
// schema validation rather than trusting Claude's label — see its own
// comment for why this lives outside the zod schema.
//
// Duplicated rather than imported from
// @music-kb/music/instruments/guitar/layout.ts (STANDARD_TUNING_MIDI) and
// bass/layout.ts (STANDARD_BASS_TUNING_MIDI): that package's package.json
// "exports" map points every subpath straight at its .ts source, which only
// resolves under TypeScript's "bundler"/"node16" moduleResolution.
// server/tsconfig.json is "module": "CommonJS" with the default (Node10)
// resolution — confirmed by actually adding the dependency and running
// `tsc --noEmit`: it fails with TS2307 ("Cannot find module … Consider
// updating to 'node16', 'nodenext', or 'bundler'"), and TypeScript refuses
// "node16" moduleResolution unless "module" is ALSO "Node16", which is a
// global, unrelated risk to Strapi's own CommonJS compile — out of scope
// for this fix. These are MIDI note numbers, not a fact that can drift on
// its own: `pitch-label-parity.test.ts` in the client reads this file as
// text (the same stance block-vocabulary.test.ts takes — client never
// imports server/) and asserts they stay equal to the real
// STANDARD_TUNING_MIDI / STANDARD_BASS_TUNING_MIDI arrays.
const STANDARD_TUNING_MIDI = [64, 59, 55, 50, 45, 40] as const; // guitar: e B G D A E, string 0 = high e
const STANDARD_BASS_TUNING_MIDI = [43, 38, 33, 28] as const; // bass: G D A E, string 0 = high G

type NeckInstrument = 'guitar' | 'bass';

const TUNING_MIDI: Record<NeckInstrument, readonly number[]> = {
  guitar: STANDARD_TUNING_MIDI,
  bass: STANDARD_BASS_TUNING_MIDI,
};

/** Natural-letter semitone offsets from C. Sharps/flats adjust by ±1. */
const NATURAL_SEMITONE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/**
 * The pitch class sounded at `string`/`fret` on the given instrument's
 * standard tuning — computed by semitone arithmetic, not looked up, so
 * there is nothing here that could disagree with @music-kb/music's own
 * tables beyond the tuning arrays above. `null` for a string/fret the
 * instrument doesn't have; this only refuses to guess, the schema's own
 * `min`/`max` on `string`/`fret` is what rejects an illegal position.
 */
function pitchClassAt(string: number, fret: number, instrument: NeckInstrument): (typeof PITCH_CLASSES)[number] | null {
  const tuning = TUNING_MIDI[instrument];
  if (!Number.isInteger(string) || string < 0 || string >= tuning.length) return null;
  if (!Number.isInteger(fret) || fret < 0) return null;
  const semitone = (((tuning[string] + fret) % 12) + 12) % 12;
  return PITCH_CLASSES[semitone];
}

/**
 * Is this dot label a PITCH NAME rather than a scale-degree or interval
 * label? A single letter A–G with an optional accidental — ASCII `#`/`b`
 * or the unicode ♯/♭ Claude sometimes writes instead. Anything else ("R",
 * "3", "♭7") is a degree or interval, not a pitch claim, and is left
 * untouched — only a claim this file can actually verify gets verified.
 */
function parsePitchLabel(raw: string): (typeof PITCH_CLASSES)[number] | null {
  const cleaned = raw.trim().replace('♯', '#').replace('♭', 'b');
  const match = /^([A-Ga-g])(#|b)?$/.exec(cleaned);
  if (!match) return null;
  const accidental = match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0;
  const semitone = ((NATURAL_SEMITONE[match[1].toUpperCase()] + accidental) % 12 + 12) % 12;
  return PITCH_CLASSES[semitone];
}

const pitchClass = () =>
  z.enum(PITCH_CLASSES).describe('A pitch class: C, C#, D, D#, E, F, F#, G, G#, A, A#, B (sharps only — no flats).');

const stringSetSchema = z
  .string()
  .describe(
    `Which three adjacent strings the triad is voiced on. One of: ${STRING_SETS.join(', ')}. ` +
      'IMPORTANT — the separators are an EN DASH (U+2013, "–"), NOT a hyphen (U+002D, "-"). ' +
      'A hyphenated lookalike (e.g. "e-B-G") is rejected, not auto-corrected.',
  )
  .superRefine((value, ctx) => {
    if ((STRING_SETS as readonly string[]).includes(value)) return;
    const enDashed = value.replace(/-/g, '–');
    if (enDashed !== value && (STRING_SETS as readonly string[]).includes(enDashed)) {
      ctx.addIssue({
        code: 'custom',
        message: `stringSet "${value}" uses a hyphen (U+002D) where an EN DASH (U+2013) is required. Use "${enDashed}" instead.`,
      });
      return;
    }
    ctx.addIssue({
      code: 'custom',
      message: `stringSet must be one of: ${STRING_SETS.join(', ')} (EN DASH U+2013 separators, not a hyphen). Got "${value}".`,
    });
  });

const captionSchema = z
  .string()
  .max(
    255,
    'caption is a Strapi `string` column (max 255 characters). Shorten it and retry — do not rely on truncation.',
  )
  .optional()
  .describe('Short caption shown under the diagram/table. Plain text, max 255 characters.');

const sourceSchema = z
  .object({
    videoId: z.string().max(32).optional().describe('youtubeVideoId this block was grounded from.'),
    timeSec: z.number().int().min(0).optional().describe('Timecode in seconds within that video.'),
  })
  .strict()
  .optional()
  .describe('Optional provenance: which video/moment this block came from. Omit for hand-authored blocks.');

const neckDotSchema = z
  .object({
    string: z
      .number()
      .int()
      .min(0)
      .max(5)
      .describe(
        'String index: 0 = the HIGHEST-pitched string (high e on guitar), increasing toward the lowest (5 = low E). ' +
          'This is the opposite of standard tab numbering — mixing it up puts every dot on the wrong string. Matches ' +
          '@music-kb/music/theory/triad-shapes.ts\'s STRING_SETS and MiniNeck.tsx\'s own string-0-is-high-e convention.',
      ),
    fret: z.number().int().min(0),
    label: z.string().max(8).optional().describe('Text shown on the dot, e.g. a note name or scale-degree role.'),
    root: z.boolean().default(false).describe('True if this dot is the chord root — rendered distinctly (accent fill).'),
    // The four style flags are the difference between a diagram that shows
    // three dots and a diagram that teaches something: they let ONE picture
    // carry two layers at once. Descriptions mirror MiniNeck.tsx's own doc
    // comment on each — that file is the authority on what they look like.
    dim: z
      .boolean()
      .default(false)
      .describe(
        'Fade the dot right back. Use it to show the whole scale across the neck while spotlighting one position: the ' +
          'out-of-position notes stay visible (so the reader sees where the box sits in the larger shape) without competing ' +
          'with the ones they are meant to play.',
      ),
    hollow: z
      .boolean()
      .default(false)
      .describe(
        'Draw an outlined ring instead of a filled disc — background context. The canonical use is a chord overlay: scale ' +
          'tones NOT in the current chord go hollow so the chord tones read as the solid ones. An UNLABELLED hollow dot ' +
          'renders small, sketching the scale shape without competing with the labelled notes — omit `label` when the dot is ' +
          'context rather than content.',
      ),
    ringed: z
      .boolean()
      .default(false)
      .describe(
        'Draw an accent halo around the dot. Marks the notes actually fretted in the shape being played, as opposed to the ' +
          'same pitch classes occurring elsewhere on the neck — "here is where your hand is" versus "here is where else that ' +
          'note lives". Combines with any fill.',
      ),
    light: z
      .boolean()
      .default(false)
      .describe(
        'Draw the dot as a cut-out: light fill, dark outline, dark text. Reads brighter than a solid dot without becoming an ' +
          'empty ring, so chord tones stand out from the surrounding scale while still looking like real notes. Use `light` ' +
          'for the foreground layer and `hollow` for the background one.',
      ),
  })
  .strict()
  .describe(
    'One dot. Beyond string/fret/label, four style flags let a single diagram carry two layers of meaning at once — see ' +
      'each of dim/hollow/ringed/light. A diagram where every dot is plain is usually a diagram that could have taught more.',
  );

const chordStringSchema = z
  .object({
    string: z
      .number()
      .int()
      .min(0)
      .max(5)
      .describe(
        'String index: 0 = the HIGHEST-pitched string (high e), 5 = the lowest (low E). Same convention as lesson.neck-dot. ' +
          'Each string carries its own index, so the six entries may be given in any order.',
      ),
    state: z
      .enum(['fretted', 'open', 'muted'])
      .describe('"fretted" = a finger at `fret`; "open" = played unfretted (drawn O above the nut); "muted" = not played (drawn ×).'),
    fret: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('Absolute fret. Required when state="fretted"; ignored otherwise. Never 0 — an unfretted string is state="open".'),
    root: z.boolean().default(false).describe('True if this fretted note is the chord root — drawn in the accent colour.'),
  })
  .strict()
  .superRefine((entry, ctx) => {
    if (entry.state === 'fretted' && entry.fret === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['fret'],
        message:
          'state="fretted" requires `fret`. Without it this string renders muted — a wrong chord, silently, not an error. For an unfretted string use state="open" instead.',
      });
    }
  });

const keyMarkSchema = z
  .object({
    pc: pitchClass(),
    label: z.string().max(8).optional(),
    root: z.boolean().default(false).describe('True if this mark is the chord root — rendered distinctly.'),
    flag: z.boolean().default(false).describe('True to visually flag this key (used for landmark/teaching marks).'),
  })
  .strict();

export const lessonParameterSchema = z
  .object({
    name: z.literal('key').describe('The only supported lesson parameter today.'),
    label: z.string().optional().describe('Control label shown to the reader. Defaults to "Key".'),
    default: pitchClass().optional().describe('Initial value shown to the reader. Defaults to "C".'),
  })
  .strict()
  .optional()
  .describe(
    'At most one reader-controlled variable for the whole lesson (Strapi caps this component at non-repeatable). ' +
      'Blocks that set `useParam: true` read the reader\'s current choice instead of their own `root`.',
  );

const proseBlock = z
  .object({
    __component: z.literal('lesson.prose'),
    body: z
      .string()
      .min(1)
      .describe(
        'Markdown body: paragraphs, lists, inline headings. Along with lesson.step\'s `body`, this is one of only two ' +
          'block text fields rendered through a markdown parser — every other text field in these blocks (callout ' +
          'body, step lede, table cells, captions) is plain text.',
      ),
    source: sourceSchema,
  })
  .strict();

const headingBlock = z
  .object({
    __component: z.literal('lesson.heading'),
    text: z.string().min(1),
    level: z.enum(['h2', 'h3']).default('h2'),
  })
  .strict()
  .describe('A standalone heading BETWEEN blocks. A heading inside a prose body should stay in that block\'s markdown instead.');

const calloutBlock = z
  .object({
    __component: z.literal('lesson.callout'),
    tone: z.enum(['note', 'tip', 'warning']).default('note'),
    body: z.string().min(1),
    source: sourceSchema,
  })
  .strict();

const stepBlock = z
  .object({
    __component: z.literal('lesson.step'),
    number: z
      .number()
      .int()
      .min(1)
      .describe('Step number as displayed. Not auto-renumbered — keep steps sequential (1, 2, 3, …) across the lesson yourself.'),
    title: z.string().min(1),
    lede: z.string().optional().describe('Short one-line intro shown above the step body.'),
    body: z.string().optional().describe('Markdown, rendered the same way as lesson.prose.'),
    source: sourceSchema,
  })
  .strict();

const diagramBlock = z
  .object({
    __component: z.literal('lesson.diagram'),
    instrument: z.enum(['guitar', 'bass']).default('guitar'),
    mode: z
      .enum(['theory', 'explicit'])
      .describe(
        '"theory" realizes the dots from music parameters at render time — see `intent` for which parameters. ' +
          '"explicit" renders exactly the hand-placed `dots` you provide, and is the ESCAPE HATCH: reach for it only when the shape is one theory cannot express (a lick, a partial voicing, a fingering with a deliberate omission). A scale box, an arpeggio position or a triad drawn in explicit mode is a shape you typed frets for that the theory layer would have computed correctly.',
      ),
    intent: z
      .enum(DIAGRAM_INTENTS)
      .default('chord')
      .describe(
        'What the diagram is OF, when mode="theory". You choose what to show; the theory layer decides where the dots go, and labels every dot with the degree it computed. ' +
          '"chord" = one triad voicing (needs root + quality + stringSet, optional inversion). ' +
          '"scale" = one CAGED/box scale position (needs root + scaleType + position). ' +
          '"arpeggio" = the chord\'s tones inside one hand position (needs root + quality + position). ' +
          '"pattern" = one three-notes-per-string pattern (needs root + scaleType + patternIndex). ' +
          'The COMBINATION is validated, not just the fields: an illegal pair (e.g. position "2" of a majorPentatonic scale, which ships boxes 1 and 5 only) is rejected here naming the legal values, rather than rendering an empty neck.',
      ),
    root: pitchClass()
      .optional()
      .describe('Required when mode="theory" UNLESS useParam is true (then the reader-controlled key wins at render).'),
    quality: z
      .enum(DIAGRAM_QUALITIES)
      .optional()
      .describe(
        `Required for intent="chord" and intent="arpeggio". intent="chord" voices a TRIAD, so only ${CHORD_INTENT_QUALITIES.join(', ')} work there. ` +
          `intent="arpeggio" takes any of: ${DIAGRAM_QUALITIES.join(', ')} — exactly the qualities with four distinct tones or fewer, which is what has an arpeggio SHAPE rather than a scale-box-shaped smear. A 9th/11th/13th/altered quality is not in the list and is rejected, not approximated.`,
      ),
    stringSet: stringSetSchema.optional().describe(
      'Required for intent="chord" — picks which three strings voice the triad. Ignored by the scale/arpeggio/pattern intents. ' + stringSetSchema.description,
    ),
    inversion: z
      .number()
      .int()
      .min(0)
      .max(2)
      .optional()
      .describe('0 = root position, 1 = first inversion, 2 = second inversion. Defaults to 0. Only meaningful for intent="chord".'),
    scaleType: z
      .enum(SCALE_TYPES)
      .optional()
      .describe(
        `Required for intent="scale" and intent="pattern". One of: ${SCALE_TYPES.join(', ')}.`,
      ),
    position: z
      .enum(DIAGRAM_POSITIONS)
      .optional()
      .describe(
        'Required for intent="scale" and intent="arpeggio": which hand position on the neck. "1"–"5" are the numbered CAGED boxes; "2oct" is the universal two-octave window anchored on the 6th-string root, which every scale and every arpeggio quality has. ' +
          'A STRING, not a number, because "2oct" is one of the values. Which numbers are legal depends on the scale: majorPentatonic has 1 and 5; dorian, phrygian, lydian, mixolydian and locrian have no numbered box at all and take "2oct" only.',
      ),
    patternIndex: z
      .number()
      .int()
      .min(1)
      .max(7)
      .optional()
      .describe(
        'Required for intent="pattern": which three-notes-per-string pattern, 1-based. Pattern N starts on scale degree N, so the real maximum is the number of notes in the scale — 7 for major and the modes, 6 for blues, 5 for the pentatonics.',
      ),
    useParam: z
      .boolean()
      .default(false)
      .describe('When true, the lesson-level reader-controlled key supplies root at render time instead of this block\'s own `root`.'),
    dots: z
      .array(neckDotSchema)
      .optional()
      .describe('Required (non-empty) when mode="explicit" — hand-placed dots. Ignored when mode="theory".'),
    fromFret: z.number().int().min(0).optional(),
    toFret: z.number().int().min(0).optional(),
    caption: captionSchema,
    source: sourceSchema,
  })
  .strict()
  .superRefine((block, ctx) => {
    if (block.mode === 'explicit') {
      if ((block.dots ?? []).length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['dots'],
          message:
            'mode="explicit" requires at least one entry in `dots`. An empty (or missing) `dots` array renders no diagram at all — a silent gap, not an error, so this tool rejects it up front.',
        });
      }
      return;
    }
    // mode === 'theory'
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });

    // Every theory realizer computes frets from the GUITAR's standard
    // tuning. On a bass the same string indices are a different tuning and
    // a shorter board, so the shape is not "a bit off" — it names the wrong
    // notes on strings that may not exist.
    if (block.instrument === 'bass') {
      issue(
        'instrument',
        'mode="theory" realizes shapes with guitar tuning, so on a bass it draws the wrong notes on strings that may not exist. Use mode="explicit" with hand-placed dots for a bass diagram.',
      );
      return;
    }
    if (!block.useParam && !block.root) {
      issue(
        'root',
        'root is required when mode="theory" and useParam is false (or omitted) — resolveDiagramDots() returns [] without it, which renders as an empty gap, not an error.',
      );
    }

    const intent = block.intent ?? 'chord';

    if (intent === 'chord') {
      if (!block.quality) {
        issue(
          'quality',
          `quality is required for intent="chord" — resolveDiagramDots() returns [] without it, which renders as an empty gap, not an error. Legal values: ${CHORD_INTENT_QUALITIES.join(', ')}.`,
        );
      } else if (!CHORD_INTENT_QUALITIES.includes(block.quality)) {
        issue(
          'quality',
          `intent="chord" voices a TRIAD, and quality="${block.quality}" is not one. Legal values: ${CHORD_INTENT_QUALITIES.join(', ')}. To show a four-note chord, use intent="arpeggio" — it draws the chord's tones across a hand position instead of as one grip.`,
        );
      }
      if (!block.stringSet) {
        issue(
          'stringSet',
          `stringSet is required for intent="chord" (it picks which three strings voice the triad) — resolveDiagramDots() returns [] without it. Legal values: ${STRING_SETS.join(', ')} (EN DASH U+2013 separators).`,
        );
      }
      return;
    }

    if (intent === 'arpeggio') {
      if (!block.quality) {
        issue(
          'quality',
          `quality is required for intent="arpeggio". Legal values: ${DIAGRAM_QUALITIES.join(', ')}.`,
        );
        return;
      }
      const legal = ARPEGGIO_POSITION_MAP.get(canonicalQuality(block.quality));
      if (!legal) {
        issue(
          'quality',
          `quality="${block.quality}" has no arpeggio shape — more than four distinct tones fills a hand position and stops reading as an arpeggio. Legal values: ${DIAGRAM_QUALITIES.join(', ')}.`,
        );
        return;
      }
      if (!block.position) {
        issue(
          'position',
          `position is required for intent="arpeggio". Legal values for quality="${block.quality}": ${legal.join(', ')}.`,
        );
      } else if (!legal.includes(block.position)) {
        issue(
          'position',
          `position="${block.position}" is not one quality="${block.quality}" offers. Legal values: ${legal.join(', ')}.`,
        );
      }
      return;
    }

    // scale + pattern both need a scale type.
    if (!block.scaleType) {
      issue(
        'scaleType',
        `scaleType is required for intent="${intent}". Legal values: ${SCALE_TYPES.join(', ')}.`,
      );
      return;
    }

    if (intent === 'scale') {
      const legal = SCALE_POSITION_MAP.get(block.scaleType) ?? [];
      if (!block.position) {
        issue(
          'position',
          `position is required for intent="scale". Legal values for scaleType="${block.scaleType}": ${legal.join(', ')}.`,
        );
      } else if (!legal.includes(block.position)) {
        issue(
          'position',
          `position="${block.position}" is not one scaleType="${block.scaleType}" has a box for. Legal values: ${legal.join(', ')}` +
            (legal.length === 1
              ? ' — this scale ships no numbered CAGED boxes, only the universal two-octave window.'
              : '.'),
        );
      }
      return;
    }

    // intent === 'pattern'
    const noteCount = SCALE_NOTE_COUNT_MAP.get(block.scaleType) ?? 7;
    if (block.patternIndex == null) {
      issue(
        'patternIndex',
        `patternIndex is required for intent="pattern". A ${block.scaleType} scale has ${noteCount} notes, so patternIndex runs 1–${noteCount} (pattern N starts on scale degree N).`,
      );
    } else if (block.patternIndex > noteCount) {
      issue(
        'patternIndex',
        `patternIndex=${block.patternIndex} is past the ${noteCount} patterns a ${block.scaleType} scale has — pattern N starts on scale degree N, and this scale has ${noteCount} degrees. Legal values: 1–${noteCount}.`,
      );
    }
  });

const keyboardDiagramBlock = z
  .object({
    __component: z.literal('lesson.keyboard-diagram'),
    mode: z
      .enum(['theory', 'explicit'])
      .describe(
        '"theory" computes marks at render time from root/quality. "explicit" renders exactly the hand-placed `marks` you provide. Pitch-class addressed — use this instead of lesson.diagram for a piano/keyboard.',
      ),
    root: pitchClass().optional().describe('Required when mode="theory" UNLESS useParam is true.'),
    quality: z.enum(TRIAD_QUALITIES).optional().describe('Required when mode="theory".'),
    useParam: z.boolean().default(false),
    octaves: z.number().int().min(1).max(3).optional(),
    marks: z
      .array(keyMarkSchema)
      .optional()
      .describe('Required (non-empty) when mode="explicit". Ignored when mode="theory".'),
    caption: captionSchema,
    source: sourceSchema,
  })
  .strict()
  .superRefine((block, ctx) => {
    if (block.mode === 'explicit') {
      if ((block.marks ?? []).length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['marks'],
          message:
            'mode="explicit" requires at least one entry in `marks`. An empty (or missing) `marks` array renders no diagram at all — a silent gap, not an error.',
        });
      }
      return;
    }
    if (!block.useParam && !block.root) {
      ctx.addIssue({
        code: 'custom',
        path: ['root'],
        message:
          'root is required when mode="theory" and useParam is false (or omitted) — resolveDiagramMarks() returns [] without it, which renders as an empty gap.',
      });
    }
    if (!block.quality) {
      ctx.addIssue({
        code: 'custom',
        path: ['quality'],
        message: 'quality is required when mode="theory" — resolveDiagramMarks() returns [] without it, which renders as an empty gap.',
      });
    }
  });

const chordDiagramBlock = z
  .object({
    __component: z.literal('lesson.chord-diagram'),
    strings: z
      .array(chordStringSchema)
      .describe(
        'Exactly six entries, one per string, each carrying its own `string` index 0–5. A string you leave out renders muted, ' +
          'which is a different chord — list all six even when most are open.',
      ),
    barreFret: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('Absolute fret of the barre. Omit for a chord with no barre. All three barre fields must be given together.'),
    barreFromString: z.number().int().min(0).max(5).optional(),
    barreToString: z.number().int().min(0).max(5).optional(),
    fretCount: z.number().int().min(3).max(6).optional().describe('How many frets the box shows. Defaults to 5.'),
    startFret: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe(
        'Override the fret at the top of the box. Omit to derive it — chords reachable inside the window start at the nut, ' +
          'higher shapes start at their lowest fretted note and get a "5fr"-style position label automatically.',
      ),
    orientation: z
      .enum(['vertical', 'horizontal'])
      .default('vertical')
      .describe(
        '"vertical" is the songbook chord box (nut across the top, strings running down) — the default and the right choice ' +
          'almost always. "horizontal" rotates it so the neck runs left-to-right like lesson.diagram; use it only when a chord ' +
          'box sits beside a fretboard diagram and the two must not disagree about which way the neck runs.',
      ),
    caption: captionSchema,
    source: sourceSchema,
  })
  .strict()
  .describe(
    'The songbook chord box — a 4–6 fret window with a dot per fretted string, O/× above the nut, and an optional barre. ' +
      'Answers "how do I hold this chord", where lesson.diagram answers "where do these notes live on the neck". Any lesson ' +
      'that names a chord the reader is meant to play should show one.',
  )
  .superRefine((block, ctx) => {
    const seen = new Map<number, number>();
    block.strings.forEach((entry, i) => {
      const first = seen.get(entry.string);
      if (first !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['strings', i],
          message: `strings[${i}] and strings[${first}] both set string=${entry.string}. Each of the six strings must appear exactly once.`,
        });
      } else {
        seen.set(entry.string, i);
      }
    });
    const missing = [0, 1, 2, 3, 4, 5].filter((s) => !seen.has(s));
    if (missing.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['strings'],
        message:
          `strings is missing an entry for string index ${missing.join(', ')} (0 = high e … 5 = low E). ` +
          'A missing string renders MUTED — a different chord, with no error — so all six must be listed explicitly, ' +
          'including the ones that are open.',
      });
    }
    const barreFields = [block.barreFret, block.barreFromString, block.barreToString];
    const given = barreFields.filter((v) => v !== undefined).length;
    if (given > 0 && given < 3) {
      ctx.addIssue({
        code: 'custom',
        path: ['barreFret'],
        message:
          'A barre needs all three of barreFret, barreFromString and barreToString. A partial barre is dropped at render — no bar is drawn and no error is raised.',
      });
    }
  });

const naturalNotesBlock = z
  .object({
    __component: z.literal('lesson.natural-notes'),
    caption: captionSchema,
    source: sourceSchema,
  })
  .strict()
  .describe(
    'A fixed reference strip of the natural notes on the low E and A strings, frets 0–12, with the two half-step pairs (B–C, ' +
      'E–F) banded. Takes no parameters — it is the same diagram every time, which is the point: those 14 notes are the anchor ' +
      'for finding any root on the neck. Use it once, where the lesson first asks the reader to locate a root by name.',
  );

// The shape of one entry in lesson.neck-pattern.patterns. NOT a Strapi
// component — that field is a json column (see the block's own note), so
// this schema is the only thing standing between a model and a picker full
// of empty necks.
const neckPatternItemSchema = z
  .object({
    label: z.string().min(1).max(40).describe('Pill text, e.g. "Position 3". Kept short — the pills sit on one row.'),
    sub: z
      .string()
      .max(160)
      .optional()
      .describe('Line shown under the diagram while this pattern is selected, e.g. "E minor pentatonic · frets 4–8".'),
    dots: z.array(neckDotSchema).describe('This pattern\'s dots — same shape, same string-index convention and same four style flags as lesson.diagram.dots.'),
  })
  .strict()
  .superRefine((pattern, ctx) => {
    if (pattern.dots.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['dots'],
        message: `Pattern "${pattern.label}" has no dots. An empty pattern renders as a pill that shows an empty neck — a silent gap, so it is rejected here.`,
      });
    }
  });

const neckPatternBlock = z
  .object({
    __component: z.literal('lesson.neck-pattern'),
    instrument: z.enum(['guitar', 'bass']).default('guitar'),
    patterns: z
      .array(neckPatternItemSchema)
      .describe(
        'Two or more patterns, shown one at a time. Exactly one pattern is a lesson.diagram, not this block. Stored as a ' +
          'json column rather than a nested component — Strapi populates a dynamic zone only one component deep, so nested ' +
          'pattern dots would arrive empty at render. The shape is validated here instead; get it wrong and this tool says so.',
      ),
    fromFret: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        'Shared fret window for the whole set — set both fromFret and toFret, or neither. Fixing the window is most of the ' +
          'point: it lets the reader watch the patterns climb the neck instead of each one being re-cropped to its own span.',
      ),
    toFret: z.number().int().min(0).optional(),
    caption: captionSchema,
    source: sourceSchema,
  })
  .strict()
  .describe(
    'Several fretboard patterns over ONE shared diagram, switched by pills. For a scale system that spans the neck (five ' +
      'pentatonic boxes, seven three-note-per-string shapes): stacking that many separate fretboards makes the page unreadable.',
  )
  .superRefine((block, ctx) => {
    if (block.patterns.length < 2) {
      ctx.addIssue({
        code: 'custom',
        path: ['patterns'],
        message:
          `lesson.neck-pattern needs at least 2 patterns (got ${block.patterns.length}); a picker with one pill is a control that does nothing, and the renderer draws nothing at all. Use lesson.diagram for a single shape.`,
      });
    }
    const bothOrNeither =
      (block.fromFret === undefined) === (block.toFret === undefined);
    if (!bothOrNeither) {
      ctx.addIssue({
        code: 'custom',
        path: [block.fromFret === undefined ? 'fromFret' : 'toFret'],
        message:
          'fromFret and toFret must be set together — MiniNeck only honours an explicit window when it has both, and otherwise auto-fits each pattern separately, which is exactly the re-cropping this block exists to avoid.',
      });
    }
  });

const degreeChipsBlock = z
  .object({
    __component: z.literal('lesson.degree-chips'),
    degrees: z
      .array(z.string())
      .min(1, 'degrees must contain at least one entry.')
      .describe('Scale-degree labels in order, e.g. ["1","2","3","4","5","6","7"] or ["R","♭3","5"].'),
    label: z
      .string()
      .max(120)
      .optional()
      .describe(
        'Names what the row IS, e.g. "C major scale". Effectively required: a bare row of numbers is the one block a reader cannot identify from its contents — "1 2 3 4 5 6 7" floating in a lesson reads as a pagination control, not a scale.',
      ),
    caption: captionSchema
      .optional()
      .describe('What to notice about the row, e.g. "Degree 1 is the root — every chord in the key is built from these seven."'),
    size: z.enum(['sm', 'md']).default('md'),
  })
  .strict();

const tableBlock = z
  .object({
    __component: z.literal('lesson.table'),
    headers: z.array(z.string()).min(1, 'headers must contain at least one column.'),
    rows: z
      .array(z.array(z.string()))
      .min(1, 'rows must contain at least one row.')
      .describe('Each row must have exactly as many cells as `headers` has columns.'),
    caption: captionSchema,
  })
  .strict()
  .superRefine((block, ctx) => {
    block.rows.forEach((row, i) => {
      if (row.length !== block.headers.length) {
        ctx.addIssue({
          code: 'custom',
          path: ['rows', i],
          message: `rows[${i}] has ${row.length} cell(s) but headers has ${block.headers.length} column(s) — every row must match the header count exactly.`,
        });
      }
    });
  });

const paramPickerBlock = z
  .object({
    __component: z.literal('lesson.param-picker'),
    label: z.string().optional().describe('Override for the control label. Defaults to the lesson parameter\'s own label.'),
  })
  .strict()
  .describe('Renders the control for the lesson-level `parameter`. Only useful if the lesson sets one — otherwise renders nothing.');

const videoRefBlock = z
  .object({
    __component: z.literal('lesson.video-ref'),
    videoId: z.string().min(1).max(32).describe('youtubeVideoId (NOT documentId) of a video in the library.'),
    timeSec: z.number().int().min(0).optional(),
    label: z.string().optional().describe('Link text. Defaults to "Watch this moment".'),
  })
  .strict();

export const lessonBlockSchema = z.discriminatedUnion('__component', [
  proseBlock,
  headingBlock,
  calloutBlock,
  stepBlock,
  diagramBlock,
  keyboardDiagramBlock,
  chordDiagramBlock,
  neckPatternBlock,
  naturalNotesBlock,
  degreeChipsBlock,
  tableBlock,
  paramPickerBlock,
  videoRefBlock,
]);

// Derived from lessonBlockSchema itself — NOT a second hand-typed list.
// lesson.interactive used to be schema-legal here but had no renderer in
// LessonBody.tsx (a silent-gap block); it was removed from both this union
// and the Strapi dynamic zone (server/src/api/lesson/content-types/lesson/
// schema.json). Hand-typing this list a second time is exactly the drift
// that caused that: deriving it from the union's own `__component` literals
// means the advertised vocabulary can never say more than the validator
// actually accepts.
export const LESSON_BLOCK_COMPONENTS = lessonBlockSchema.options.map(
  (option) => option.shape.__component.value,
) as readonly string[];

export const lessonBodySchema = z
  .array(lessonBlockSchema)
  .min(1, 'body must contain at least one block — an empty lesson is rejected rather than silently saved.')
  .describe(
    `The lesson content as an ordered array of typed blocks. Each block needs a "__component" naming which kind it is — legal values: ${LESSON_BLOCK_COMPONENTS.join(', ')}. ` +
      'Every field on every block is validated; a bad enum value, an over-length caption, or a block missing a field its render mode needs is rejected with a message naming the block\'s array index and field — fix it and resubmit rather than guessing.',
  );

export type PitchLabelCorrection = {
  blockIndex: number;
  component: 'lesson.diagram' | 'lesson.neck-pattern';
  /** Which pattern pill this dot belongs to — lesson.neck-pattern only. */
  patternLabel?: string;
  string: number;
  fret: number;
  from: string;
  to: string;
};

type NeckDot = z.infer<typeof neckDotSchema>;

function correctDotLabel(dot: NeckDot, instrument: NeckInstrument): { from: string; to: string } | null {
  if (!dot.label) return null;
  const claimed = parsePitchLabel(dot.label);
  if (!claimed) return null;
  const actual = pitchClassAt(dot.string, dot.fret, instrument);
  if (!actual || actual === claimed) return null;
  const from = dot.label;
  dot.label = actual;
  return { from, to: actual };
}

/**
 * Correct every pitch-labelled dot in a validated lesson body IN PLACE,
 * returning an audit trail of what changed — the same "repair + overrides"
 * shape `verifyCitations` already uses for drifted timecodes. Deliberately
 * NOT part of the zod schema above: a `superRefine` can only ADD issues,
 * which is how this file's other checks REJECT a block, and a corrected
 * label is the opposite — the block is kept, only the name changes. Call
 * this from a tool's `execute()`, after `schema.parse()` has already run
 * (so `body` is shape-valid), and before writing to Strapi.
 */
export function correctPitchLabels(body: z.infer<typeof lessonBodySchema>): PitchLabelCorrection[] {
  const corrections: PitchLabelCorrection[] = [];
  body.forEach((block, blockIndex) => {
    if (block.__component === 'lesson.diagram') {
      if (block.mode !== 'explicit' || !block.dots) return;
      for (const dot of block.dots) {
        const fix = correctDotLabel(dot, block.instrument);
        if (fix) {
          corrections.push({ blockIndex, component: block.__component, string: dot.string, fret: dot.fret, ...fix });
        }
      }
    } else if (block.__component === 'lesson.neck-pattern') {
      for (const pattern of block.patterns) {
        for (const dot of pattern.dots) {
          const fix = correctDotLabel(dot, block.instrument);
          if (fix) {
            corrections.push({
              blockIndex,
              component: block.__component,
              patternLabel: pattern.label,
              string: dot.string,
              fret: dot.fret,
              ...fix,
            });
          }
        }
      }
    }
  });
  return corrections;
}
