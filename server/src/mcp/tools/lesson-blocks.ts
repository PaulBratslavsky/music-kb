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
      .describe('String index: 0 = lowest-pitched string (low E on guitar), increasing toward the highest string.'),
    fret: z.number().int().min(0),
    label: z.string().max(8).optional().describe('Text shown on the dot, e.g. a note name or scale-degree role.'),
    root: z.boolean().default(false).describe('True if this dot is the chord root — rendered distinctly.'),
    dim: z.boolean().default(false).describe('True to render this dot dimmed (e.g. an optional/context note).'),
  })
  .strict();

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
        'Markdown body: paragraphs, lists, inline headings. This is the only block whose text is rendered as markdown — every other text field in these blocks is plain text.',
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
