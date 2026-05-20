import { createFileRoute, Link } from '@tanstack/react-router';
import { z } from 'zod';
import { Button } from '#/components/ui/button';
import { DigestCard } from '#/components/DigestCard';
import { listSavedDigests } from '#/data/server-functions/digests';

// Saved digests library — mirrors the /feed page: search across title +
// description, paginated server-side. Clicking a card opens /digest with
// the original videoIds URL, which hits the cache via videoSetKey.
const DigestsSearchSchema = z.object({
  q: z.string().max(200).optional(),
  page: z.number().int().min(1).max(1000).optional(),
});

export const Route = createFileRoute('/digests')({
  validateSearch: DigestsSearchSchema,
  loaderDeps: ({ search }) => ({ q: search.q, page: search.page }),
  loader: async ({ deps }) => {
    const result = await listSavedDigests({
      // 9 per page = matches the feed's 3×3 grid on desktop.
      data: { q: deps.q, page: deps.page ?? 1, pageSize: 9 },
    });
    return { result };
  },
  component: DigestsPage,
  head: () => ({ meta: [{ title: 'Digests · Music KB' }] }),
});

function DigestsPage() {
  const { result } = Route.useLoaderData();
  const search = Route.useSearch();

  if (result.status === 'error') {
    return (
      <main className="mx-auto max-w-3xl px-6 py-20">
        <h1 className="display-title text-3xl text-[var(--ink)] sm:text-4xl">
          Couldn&apos;t load digests
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-destructive">
          {result.error}
        </p>
      </main>
    );
  }

  const { digests, total, page, pageCount } = result.result;

  return (
    <main className="px-6 pb-28 pt-10 sm:px-10 sm:pt-14 lg:px-14">
      <header className="mb-8">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--card)] px-3 py-1 text-xs font-medium text-[var(--ink-muted)]">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
          Saved digests
        </span>
        <h1 className="display-title mt-5 max-w-3xl text-[2.75rem] text-[var(--ink)] sm:text-[4rem]">
          Cross-video
          <br />
          <span className="text-[var(--ink-muted)]">syntheses.</span>
        </h1>
      </header>

      <SearchBar q={search.q ?? ''} />

      {digests.length === 0 ? (
        <EmptyState q={search.q} />
      ) : (
        <>
          <div className="mb-4 flex items-center justify-between text-sm text-[var(--ink-muted)]">
            <span>
              {total} {total === 1 ? 'digest' : 'digests'}
            </span>
            <span>
              Page {page} of {Math.max(1, pageCount)}
            </span>
          </div>
          <section className="grid items-start gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {digests.map((d) => (
              <DigestCard key={d.documentId} digest={d} />
            ))}
          </section>
          <Pagination currentPage={page} pageCount={pageCount} q={search.q} />
        </>
      )}
    </main>
  );
}

function SearchBar({ q }: Readonly<{ q: string }>) {
  return (
    <form method="get" action="/digests" className="mb-6 flex flex-wrap gap-2">
      <input
        type="search"
        name="q"
        defaultValue={q}
        placeholder="Search saved digests by title or description…"
        className="h-10 min-w-0 flex-1 rounded-full border border-[var(--line)] bg-[var(--card)] px-4 text-sm text-[var(--ink)] placeholder:text-[var(--ink-muted)] focus:border-[var(--line-strong)] focus:outline-none"
      />
      <Button type="submit" size="pill">
        Search
      </Button>
    </form>
  );
}

function Pagination({
  currentPage,
  pageCount,
  q,
}: Readonly<{ currentPage: number; pageCount: number; q?: string }>) {
  if (pageCount <= 1) return null;
  const prev = Math.max(1, currentPage - 1);
  const next = Math.min(pageCount, currentPage + 1);

  return (
    <nav
      className="mt-10 flex items-center justify-center gap-3"
      aria-label="Pagination"
    >
      <Button asChild size="pill" variant="outline" disabled={currentPage === 1}>
        <Link to="/digests" search={{ q, page: prev }}>
          ← Prev
        </Link>
      </Button>
      <span className="text-sm font-medium text-[var(--ink-muted)]">
        {currentPage} / {pageCount}
      </span>
      <Button
        asChild
        size="pill"
        variant="outline"
        disabled={currentPage === pageCount}
      >
        <Link to="/digests" search={{ q, page: next }}>
          Next →
        </Link>
      </Button>
    </nav>
  );
}

function EmptyState({ q }: Readonly<{ q?: string }>) {
  const filtered = Boolean(q);
  return (
    <section className="mx-auto max-w-lg rounded-2xl border border-[var(--line)] bg-[var(--card)] p-10 text-center">
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--ink-muted)]">
        {filtered ? 'No matches' : 'No saved digests yet'}
      </p>
      <h2 className="display-title mt-2 text-3xl text-[var(--ink)]">
        {filtered ? 'Try a different search.' : 'Build one from the feed.'}
      </h2>
      <p className="mt-3 text-sm text-[var(--ink-soft)]">
        {filtered
          ? 'Or clear the search to see everything.'
          : 'Select 2–5 videos in the feed, create a cross-video digest, and save it to see it listed here.'}
      </p>
      <div className="mt-6 flex justify-center gap-2">
        {filtered ? (
          <Button asChild size="pill" variant="outline">
            <Link to="/digests" search={{}}>
              Clear search
            </Link>
          </Button>
        ) : (
          <Button asChild size="pill">
            <Link to="/feed">Go to feed</Link>
          </Button>
        )}
      </div>
    </section>
  );
}
