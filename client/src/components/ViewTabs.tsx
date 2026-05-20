// Pill-style tab switcher. Controlled component — parent owns the active
// state and passes onChange. Used on the learn page (Summary / Read) and
// the digest page (Digest / Article).
type Tab<T extends string> = { id: T; label: string };

export function ViewTabs<T extends string>({
  active,
  tabs,
  onChange,
}: Readonly<{
  active: T;
  tabs: Array<Tab<T>>;
  onChange: (id: T) => void;
}>) {
  const tabClass = (isActive: boolean) =>
    `inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
      isActive
        ? 'border-[var(--line)] bg-[var(--card)] text-[var(--ink-muted)]'
        : 'border-transparent bg-transparent text-[var(--ink-muted)] hover:border-[var(--line)] hover:bg-[var(--card)] hover:text-[var(--ink)]'
    }`;
  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--bg-subtle)] p-0.5">
      {tabs.map((tab) => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={tabClass(isActive)}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                isActive ? 'bg-[var(--accent)]' : 'bg-[var(--ink-muted)]/30'
              }`}
            />
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
