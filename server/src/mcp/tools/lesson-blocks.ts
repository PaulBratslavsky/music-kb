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
        '"theory" computes dots at render time from root/quality/stringSet/inversion. "explicit" renders exactly the hand-placed `dots` you provide.',
      ),
    root: pitchClass()
      .optional()
      .describe('Required when mode="theory" UNLESS useParam is true (then the reader-controlled key wins at render).'),
    quality: z
      .enum(TRIAD_QUALITIES)
      .optional()
      .describe('Required when mode="theory". One of: major, minor, augmented, diminished.'),
    stringSet: stringSetSchema.optional().describe(
      'Required when mode="theory" — picks which three strings voice the triad. ' + stringSetSchema.description,
    ),
    inversion: z
      .number()
      .int()
      .min(0)
      .max(2)
      .optional()
      .describe('0 = root position, 1 = first inversion, 2 = second inversion. Defaults to 0. Only meaningful in mode="theory".'),
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
    if (!block.useParam && !block.root) {
      ctx.addIssue({
        code: 'custom',
        path: ['root'],
        message:
          'root is required when mode="theory" and useParam is false (or omitted) — resolveDiagramDots() returns [] without it, which renders as an empty gap, not an error.',
      });
    }
    if (!block.quality) {
      ctx.addIssue({
        code: 'custom',
        path: ['quality'],
        message:
          'quality is required when mode="theory" — resolveDiagramDots() returns [] without it, which renders as an empty gap, not an error.',
      });
    }
    if (!block.stringSet) {
      ctx.addIssue({
        code: 'custom',
        path: ['stringSet'],
        message: `stringSet is required when mode="theory" (needed to place dots on strings) — resolveDiagramDots() returns [] without it. Legal values: ${STRING_SETS.join(', ')} (EN DASH U+2013 separators).`,
      });
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
