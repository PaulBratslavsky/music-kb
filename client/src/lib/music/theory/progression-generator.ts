// Random chord-progression generator.
//
// Picking 4 diatonic chords uniformly at random sounds bad, and it sounds
// bad for a reason worth encoding: in common-practice harmony chords have
// FUNCTIONS, and the functions flow in one direction.
//
//   Tonic (T)        → rest.        major: I iii vi     minor: i III VI
//   Predominant (S)  → departure.   major: ii IV        minor: ii° iv
//   Dominant (D)     → tension.     major: V vii°       minor: V VII
//
// The idiomatic cycle is T → S → D → T. Going backwards from D to S (a
// "retrogression") is what makes random output sound like it is wandering.
// So instead of uniform choice this walks a weighted Markov chain whose
// transition weights encode that flow, and then lands on a real cadence
// rather than wherever the walk happened to stop.
//
// Everything here is pure and takes an injectable `rng`, so the musical
// rules are unit-testable rather than "sounds fine to me".

export type ProgressionStyle = 'pop' | 'jazz' | 'blues' | 'folk' | 'cinematic';

export type Cadence =
  | 'authentic'
  | 'plagal'
  | 'deceptive'
  | 'half'
  /** ♭VII → i in minor, vii° → I in major. The modal way home, no V needed. */
  | 'modal';

export type GeneratedProgression = {
  /** 1-based scale degrees, e.g. [1, 5, 6, 4]. */
  degrees: number[];
  style: ProgressionStyle;
  cadence: Cadence;
  /**
   * Minor keys only: whether the V was raised to a major triad (borrowing
   * the harmonic-minor leading tone). Natural minor's v is minor and has
   * no leading tone, so it does not pull home — styles that want a strong
   * resolution raise it; modal styles deliberately do not.
   */
  raisedSeventh: boolean;
  /** One-line plain-English description of the harmonic shape. */
  rationale: string;
};

type Weights = Record<number, Record<number, number>>;

/**
 * Major-key transition weights. Read `1: { 4: 3 }` as "from I, moving to IV
 * has weight 3". Weights are relative, not probabilities.
 *
 * The shape to notice: every predominant (ii, IV) leans hardest on V, and
 * V leans hardest on I. iii is deliberately rare — it is the weakest
 * diatonic chord and overusing it is the classic random-generator tell.
 */
const MAJOR_WEIGHTS: Weights = {
  1: { 2: 2, 3: 1, 4: 3, 5: 3, 6: 2 },
  2: { 4: 1, 5: 4, 7: 1 },
  3: { 2: 1, 4: 2, 6: 3 },
  4: { 1: 2, 2: 2, 5: 3, 7: 1 },
  // V → IV is a retrogression in classical practice but a rock staple, so
  // it stays legal at a low weight rather than being banned outright.
  5: { 1: 4, 4: 1, 6: 2 },
  6: { 2: 3, 3: 1, 4: 3, 5: 2 },
  7: { 1: 4, 3: 1 },
};

/**
 * Natural-minor transition weights. ♭VII (7) carries far more traffic than
 * major-key vii° does — in minor it is a full major triad and a normal
 * stepping stone, not a leading-tone chord.
 */
const MINOR_WEIGHTS: Weights = {
  1: { 2: 1, 3: 1, 4: 3, 5: 3, 6: 2, 7: 2 },
  2: { 1: 1, 5: 4 },
  3: { 4: 1, 6: 2, 7: 2 },
  4: { 1: 2, 2: 1, 5: 3, 7: 1 },
  5: { 1: 4, 4: 1, 6: 2 },
  6: { 2: 2, 3: 1, 4: 2, 5: 2, 7: 2 },
  7: { 1: 2, 3: 2, 6: 1 },
};

type StyleSpec = {
  /** Degrees this style is allowed to use at all. */
  allowed: number[];
  /** Multipliers applied to a transition's weight by TARGET degree. */
  boost?: Record<number, number>;
  /** Cadences this style ends on, listed with relative weight. */
  cadences: Array<{ cadence: Cadence; weight: number }>;
  /** Minor keys: raise the 7th so V is major and actually resolves. */
  raiseSeventh: boolean;
  /** Spell the authentic cadence as the full ii–V–I rather than just V–I. */
  fullTurnaround?: boolean;
  label: string;
};

const STYLES: Record<ProgressionStyle, StyleSpec> = {
  pop: {
    label: 'Pop',
    // The four-chord world: I, V, vi, IV, with ii as the other common colour.
    allowed: [1, 2, 4, 5, 6],
    boost: { 6: 1.6, 4: 1.4 },
    cadences: [
      { cadence: 'authentic', weight: 3 },
      { cadence: 'plagal', weight: 2 },
      { cadence: 'deceptive', weight: 1 },
    ],
    raiseSeventh: false,
  },
  jazz: {
    label: 'Jazz',
    // Everything is legal; the ii–V pull is what makes it sound like jazz.
    allowed: [1, 2, 3, 4, 5, 6, 7],
    boost: { 2: 2, 5: 1.6, 3: 1.3 },
    fullTurnaround: true,
    cadences: [
      { cadence: 'authentic', weight: 5 },
      { cadence: 'deceptive', weight: 1 },
    ],
    raiseSeventh: true,
  },
  blues: {
    label: 'Blues',
    allowed: [1, 4, 5],
    boost: { 4: 1.5 },
    cadences: [
      { cadence: 'authentic', weight: 2 },
      // The turnaround: park on V and go round again.
      { cadence: 'half', weight: 2 },
    ],
    raiseSeventh: true,
  },
  folk: {
    label: 'Folk / rock',
    // No vii° — a diminished chord is not a campfire chord.
    allowed: [1, 2, 4, 5, 6],
    boost: { 4: 1.5, 5: 1.3 },
    cadences: [
      { cadence: 'authentic', weight: 3 },
      { cadence: 'plagal', weight: 3 },
    ],
    raiseSeventh: false,
  },
  cinematic: {
    label: 'Cinematic / modal',
    // Leans on the flat-side chords and avoids the leading tone, which is
    // what gives modal minor its unresolved, floating quality.
    allowed: [1, 3, 4, 6, 7],
    boost: { 6: 1.6, 7: 1.8, 3: 1.4 },
    cadences: [
      { cadence: 'modal', weight: 3 },
      { cadence: 'plagal', weight: 2 },
    ],
    raiseSeventh: false,
  },
};

export const STYLE_OPTIONS: Array<{ id: ProgressionStyle; label: string }> = (
  Object.keys(STYLES) as ProgressionStyle[]
).map((id) => ({ id, label: STYLES[id].label }));

/** The closing chords for each cadence. */
function cadenceTail(cadence: Cadence, style: StyleSpec): number[] {
  switch (cadence) {
    // Perfect authentic — V → I. Jazz prefixes the ii to make the full
    // ii–V–I, which is the single most common progression in the idiom.
    case 'authentic':
      return style.fullTurnaround && style.allowed.includes(2)
        ? [2, 5, 1]
        : [5, 1];
    case 'plagal':
      return [4, 1];
    // Deceptive — V sets up I and lands on vi instead.
    case 'deceptive':
      return [5, 6];
    // Half cadence — stop ON the dominant, left hanging.
    case 'half':
      return style.allowed.includes(4) ? [4, 5] : [5];
    case 'modal':
      return [7, 1];
  }
}

/**
 * Functional dominants. In minor, ♭VII (7) is a subtonic major triad, not a
 * functional dominant — ♭VII → iv is idiomatic, so it is deliberately not
 * counted here.
 */
function isDominant(degree: number, mode: 'major' | 'minor'): boolean {
  return degree === 5 || (mode === 'major' && degree === 7);
}

const isPredominant = (degree: number) => degree === 2 || degree === 4;

/**
 * A dominant falling back to a predominant is the retrogression that makes
 * generated progressions sound aimless. V → IV is the one sanctioned
 * exception — classical practice forbids it, rock is built on it.
 */
function isRetrogression(
  from: number,
  to: number,
  mode: 'major' | 'minor',
): boolean {
  if (!isDominant(from, mode) || !isPredominant(to)) return false;
  return !(from === 5 && to === 4);
}

function weightedPick<T>(
  entries: Array<{ value: T; weight: number }>,
  rng: () => number,
): T | null {
  const usable = entries.filter((e) => e.weight > 0);
  if (usable.length === 0) return null;
  const total = usable.reduce((n, e) => n + e.weight, 0);
  let roll = rng() * total;
  for (const e of usable) {
    roll -= e.weight;
    if (roll <= 0) return e.value;
  }
  return usable[usable.length - 1].value;
}

const CADENCE_TEXT: Record<Cadence, string> = {
  authentic: 'ends on a perfect authentic cadence (V → I) — the strongest way home',
  plagal: 'ends on a plagal cadence (IV → I) — the "amen" ending, softer than V → I',
  deceptive: 'ends on a deceptive cadence (V → vi) — the dominant sets up home, then dodges it',
  half: 'stops on the dominant (a half cadence) — unresolved, so it loops back round naturally',
  modal: 'ends on a subtonic cadence (♭VII → i) — resolves home without a leading tone, which is what keeps it modal',
};

/**
 * Generate a progression that obeys functional harmony.
 *
 * The walk always starts on the tonic, never repeats a chord immediately,
 * and reserves the final chords for a real cadence rather than ending
 * wherever the random walk happened to land.
 */
export function generateProgression({
  mode,
  style = 'pop',
  length = 4,
  rng = Math.random,
}: {
  mode: 'major' | 'minor';
  style?: ProgressionStyle;
  length?: number;
  rng?: () => number;
}): GeneratedProgression {
  const spec = STYLES[style];
  const weights = mode === 'major' ? MAJOR_WEIGHTS : MINOR_WEIGHTS;
  const allowed = new Set(spec.allowed);

  const cadence =
    weightedPick(
      spec.cadences.map((c) => ({ value: c.cadence, weight: c.weight })),
      rng,
    ) ?? 'authentic';
  const tail = cadenceTail(cadence, spec).filter((d) => allowed.has(d));

  // Always open on the tonic — it establishes the key, and without it the
  // ear has nothing to hear the other chords in relation to.
  const body: number[] = [1];
  const bodyTarget = Math.max(1, length - tail.length);

  while (body.length < bodyTarget) {
    const from = body[body.length - 1];
    // The chord that hands over to the cadence has an extra constraint: the
    // join itself must be musical. Without it, a walk that happens to end on
    // V gets the jazz ii–V–I tail bolted on and produces V → ii.
    const isHandoff = body.length === bodyTarget - 1 && tail.length > 0;
    const target = isHandoff ? tail[0] : null;

    const base = Object.entries(weights[from] ?? {})
      .map(([to, weight]) => ({ value: Number(to), weight }))
      .filter((o) => allowed.has(o.value))
      // No immediate repeats — a chord held over two slots reads as one
      // chord, not two, and wastes a slot.
      .filter((o) => o.value !== from)
      .filter((o) => !isRetrogression(from, o.value, mode))
      .filter((o) => target == null || o.value !== target)
      .filter((o) => target == null || !isRetrogression(o.value, target, mode))
      .map((o) => ({
        ...o,
        weight: o.weight * (spec.boost?.[o.value] ?? 1),
      }));

    // Prefer a handoff the transition table actually lists; settle for any
    // non-retrogressing one. Tonic → dominant, say, is always fine even
    // where the table did not enumerate it.
    const preferred =
      target == null
        ? base
        : base.filter((o) => weights[o.value]?.[target] != null);
    const next = weightedPick(preferred.length > 0 ? preferred : base, rng);

    if (next != null) {
      body.push(next);
      continue;
    }
    // Dead end — heavily restricted styles can exhaust the options. Take any
    // allowed degree that breaks none of the invariants.
    const fallback = spec.allowed.find(
      (d) =>
        d !== from &&
        !isRetrogression(from, d, mode) &&
        (target == null || (d !== target && !isRetrogression(d, target, mode))),
    );
    body.push(fallback ?? (from === 1 ? spec.allowed[1] ?? 1 : 1));
  }

  const degrees = [...body, ...tail];
  const raisedSeventh = mode === 'minor' && spec.raiseSeventh && degrees.includes(5);

  const rationale = [
    `${spec.label} in ${mode}`,
    CADENCE_TEXT[cadence],
    raisedSeventh
      ? 'the V is raised to a major triad so it has a leading tone to resolve'
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return { degrees, style, cadence, raisedSeventh, rationale };
}
