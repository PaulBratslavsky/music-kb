// A scale/chord formula rendered as pills instead of a run-on string.
//
// "1 – ♭3 – 5 – ♭7" is technically complete but you have to *read* it. As
// chips, the altered degrees carry a colour, so the shape of a formula is
// visible at a glance and two formulas can be compared by silhouette —
// which is the whole job of a reference page.

export function DegreeChips({
  degrees,
  size = 'md',
}: {
  /** Already-prettified degree labels, e.g. ['1','♭3','5','♭7']. */
  degrees: string[];
  size?: 'sm' | 'md';
}) {
  const box =
    size === 'sm'
      ? 'h-5 min-w-5 px-1 text-[10px]'
      : 'h-6 min-w-6 px-1.5 text-[11px]';

  return (
    <div className="flex flex-wrap items-center gap-1">
      {degrees.map((d, i) => {
        const altered = d.includes('♭') || d.includes('♯');
        const isRoot = d === '1';
        return (
          <span
            key={`${d}-${i}`}
            className={`inline-flex items-center justify-center rounded-full font-bold tabular-nums ${box} ${
              isRoot
                ? 'bg-[var(--accent)] text-white'
                : altered
                  ? 'bg-[var(--band-red-bg)] text-[var(--band-red-text)]'
                  : 'bg-[var(--bg-subtle)] text-[var(--ink)]'
            }`}
          >
            {d}
          </span>
        );
      })}
    </div>
  );
}
