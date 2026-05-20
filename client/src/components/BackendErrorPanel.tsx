import { useRouter } from '@tanstack/react-router';
import { Button } from '#/components/ui/button';

// Distinct UI for "backend (Strapi) is unreachable or errored" — used
// by route loaders that previously fell back to "empty" or "not found"
// when the real cause was a dead backend. Render this instead of the
// regular empty state when the loader's error field is set.
//
// Retry uses `router.invalidate()` so the loader runs again — no full
// page reload, so any unrelated client state (selection mode, scroll
// position) survives the retry.
export function BackendErrorPanel({
  message,
  variant = 'card',
}: Readonly<{
  message: string;
  // 'card' = full panel for empty-route states (feed, learn, video).
  // 'banner' = inline strip for partial failures (future use).
  variant?: 'card' | 'banner';
}>) {
  const router = useRouter();
  const onRetry = () => {
    void router.invalidate();
  };

  if (variant === 'banner') {
    return (
      <div
        role="alert"
        className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400"
      >
        <span>{message}</span>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <section
      role="alert"
      className="mx-auto max-w-lg rounded-2xl border border-amber-500/30 bg-amber-500/5 p-10 text-center"
    >
      <p className="text-xs font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400">
        Backend issue
      </p>
      <h2 className="display-title mt-2 text-3xl text-[var(--ink)]">
        Can&apos;t reach Strapi.
      </h2>
      <p className="mt-3 text-sm text-[var(--ink-soft)]">{message}</p>
      <div className="mt-6 flex justify-center gap-2">
        <Button size="pill" onClick={onRetry}>
          Retry
        </Button>
      </div>
    </section>
  );
}
