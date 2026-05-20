import { useState } from 'react';
import { createFileRoute, Link, useRouter } from '@tanstack/react-router';
import { z } from 'zod';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '#/components/ui/button';
import { DigestChat } from '#/components/DigestChat';
import { generateDigestArticle } from '#/data/server-functions/digest';
import {
  saveDigest,
  loadDigest,
  type LoadDigestResult,
} from '#/data/server-functions/digests';
import type { StrapiDigest } from '#/lib/services/digests';
import {
  resolveVideoTitle,
  type Digest,
  type DigestSourceVideo,
} from '#/lib/services/digest';
import type { StrapiVideo } from '#/lib/services/videos';

// The digest is ephemeral — no DB row. URL encodes the selection as
// `?videos=id1,id2,...`; the loader synthesizes the report on every visit.
// Refresh / share link = re-run the synthesis against whatever the videos
// currently contain.

const DigestSearchSchema = z.object({
  videos: z.string().min(1).max(400),
});

export const Route = createFileRoute('/digest')({
  validateSearch: DigestSearchSchema,
  loaderDeps: ({ search }) => ({ videos: search.videos }),
  loader: async ({ deps }): Promise<LoadDigestResult> => {
    const videoIds = deps.videos
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    // loadDigest: cache-first. Checks for a saved digest matching this
    // video set and short-circuits to the persisted structured data when
    // found; falls back to a fresh LLM synthesis on miss.
    return await loadDigest({ data: { videoIds } });
  },
  component: DigestPage,
  pendingComponent: DigestPending,
  head: () => ({ meta: [{ title: 'Digest · YT Knowledge Base' }] }),
});

function DigestPending() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-20 text-center">
      <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--card)] px-3 py-1 text-xs font-medium text-[var(--ink-muted)]">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent)]" />
        Synthesizing
      </span>
      <h1 className="display-title mt-6 text-3xl text-[var(--ink)] sm:text-4xl">
        Building your digest…
      </h1>
      <p className="mt-4 text-sm leading-relaxed text-[var(--ink-muted)]">
        Reading across the selected videos and pulling out shared themes,
        unique insights, and any contradictions. Usually 5–15 seconds.
      </p>
    </main>
  );
}

function DigestPage() {
  const result = Route.useLoaderData();

  if (result.status === 'error') {
    return (
      <main className="mx-auto max-w-3xl px-6 py-20">
        <h1 className="display-title text-3xl text-[var(--ink)] sm:text-4xl">
          Couldn&apos;t build the digest
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-destructive">
          {result.error}
        </p>
        <div className="mt-8">
          <Link to="/feed">
            <Button variant="outline">Back to feed</Button>
          </Link>
        </div>
      </main>
    );
  }

  return (
    <DigestReport
      digest={result.digest}
      videos={result.videos}
      initialSavedDigest={result.savedDigest}
    />
  );
}

function DigestReport({
  digest,
  videos,
  initialSavedDigest,
}: Readonly<{
  digest: Digest;
  videos: StrapiVideo[];
  initialSavedDigest: StrapiDigest | null;
}>) {
  const sources: DigestSourceVideo[] = videos.map((v) => ({
    documentId: v.documentId,
    youtubeVideoId: v.youtubeVideoId,
    videoTitle: v.videoTitle,
    videoAuthor: v.videoAuthor,
    videoThumbnailUrl: v.videoThumbnailUrl,
  }));

  // Which view is currently active.
  const [view, setView] = useState<'digest' | 'article'>('digest');

  // Article + saved-row state seeded from the loader. Loader already
  // checked for a cached digest — if one exists, `initialSavedDigest`
  // carries it and its articleMarkdown (if present) seeds `article` so
  // the Article tab renders cached without regenerating.
  const [savedDigest, setSavedDigest] = useState<StrapiDigest | null>(
    initialSavedDigest,
  );
  const [article, setArticle] = useState<string | null>(
    initialSavedDigest?.articleMarkdown ?? null,
  );

  return (
    <main className="min-h-[calc(100vh-4rem)]">
      {/* 6fr/4fr split mirroring the learn page. Left column holds the
          synthesized report, right aside holds the cross-video chat pinned
          while the left column scrolls. Both extend edge-to-edge on lg+. */}
      <div className="grid min-h-[calc(100vh-4rem)] lg:grid-cols-[6fr_4fr] lg:items-stretch">
        <div className="min-w-0 bg-[var(--bg-subtle)] px-6 py-10 sm:px-10 sm:py-14 lg:px-14">
          <DigestViewTabs active={view} onChange={setView} />

          {view === 'article' ? (
            <DigestArticleView
              digest={digest}
              videos={videos}
              article={article}
              savedDigest={savedDigest}
              onArticleGenerated={setArticle}
              onSaved={setSavedDigest}
            />
          ) : (
            <DigestStructuredView
              digest={digest}
              sources={sources}
              videos={videos}
              article={article}
              savedDigest={savedDigest}
              onSaved={setSavedDigest}
            />
          )}
        </div>

        <aside className="flex min-h-0 flex-col bg-[var(--card)] lg:sticky lg:top-16 lg:max-h-[calc(100vh-4rem)] lg:border-l lg:border-[var(--line)]">
          <DigestChat
            videos={videos}
            className="min-h-[480px] flex-1 px-6 py-6 sm:px-8"
          />
        </aside>
      </div>
    </main>
  );
}

function DigestViewTabs({
  active,
  onChange,
}: Readonly<{
  active: 'digest' | 'article';
  onChange: (v: 'digest' | 'article') => void;
}>) {
  const tabClass = (isActive: boolean) =>
    `inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
      isActive
        ? 'border-[var(--line)] bg-[var(--card)] text-[var(--ink-muted)]'
        : 'border-transparent bg-transparent text-[var(--ink-muted)] hover:border-[var(--line)] hover:bg-[var(--card)] hover:text-[var(--ink)]'
    }`;
  return (
    <div className="mb-8 inline-flex items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--bg-subtle)] p-0.5">
      <button
        type="button"
        onClick={() => onChange('digest')}
        className={tabClass(active === 'digest')}
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            active === 'digest' ? 'bg-[var(--accent)]' : 'bg-[var(--ink-muted)]/30'
          }`}
        />
        Digest
      </button>
      <button
        type="button"
        onClick={() => onChange('article')}
        className={tabClass(active === 'article')}
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            active === 'article' ? 'bg-[var(--accent)]' : 'bg-[var(--ink-muted)]/30'
          }`}
        />
        Article
      </button>
    </div>
  );
}

function DigestStructuredView({
  digest,
  sources,
  videos,
  article,
  savedDigest,
  onSaved,
}: Readonly<{
  digest: Digest;
  sources: DigestSourceVideo[];
  videos: StrapiVideo[];
  /** Markdown article for these videos if already generated — included on
   * save so we don't lose it. Null when the user hasn't opened the Article
   * tab yet and no saved row had one cached. */
  article: string | null;
  savedDigest: StrapiDigest | null;
  onSaved: (saved: StrapiDigest | null) => void;
}>) {
  return (
    <>
      <header className="mb-10">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--card)] px-3 py-1 text-xs font-medium text-[var(--ink-muted)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
            Cross-video digest
          </span>
          <h1 className="display-title mt-5 text-3xl leading-[1.1] text-[var(--ink)] sm:text-5xl">
            {digest.title}
          </h1>
          <p className="mt-4 text-base leading-relaxed text-[var(--ink-soft)] sm:text-lg">
            {digest.description}
          </p>
          <SourceChips videos={sources} />
        </header>

        <section className="mb-10 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-5 sm:p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
            Bottom line
          </h2>
          <p className="mt-3 text-base leading-relaxed text-[var(--ink)]">
            {digest.bottomLine}
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
            Overall theme
          </h2>
          <p className="mt-4 text-base leading-relaxed text-[var(--ink-soft)] whitespace-pre-line">
            {digest.overallTheme}
          </p>
        </section>

        {digest.sharedThemes.length > 0 && (
          <section className="mb-10">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
              Shared themes
            </h2>
            <div className="mt-4 grid gap-5">
              {digest.sharedThemes.map((t, i) => (
                <ThemeBlock
                  key={`theme-${i}`}
                  title={t.title}
                  body={t.body}
                  videoTitles={t.videoTitles}
                  sources={sources}
                />
              ))}
            </div>
          </section>
        )}

        {digest.uniqueInsights.length > 0 && (
          <section className="mb-10">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
              Unique contributions
            </h2>
            <div className="mt-4 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--card)]">
              {digest.uniqueInsights.map((u, i) => {
                const match = resolveVideoTitle(u.videoTitle, sources);
                return (
                  <div
                    key={`insight-${i}`}
                    className={`grid gap-2 p-5 sm:grid-cols-[200px_1fr] sm:gap-6 ${
                      i > 0 ? 'border-t border-[var(--line)]' : ''
                    }`}
                  >
                    <div className="text-sm font-medium text-[var(--ink)]">
                      {match ? (
                        <Link
                          to="/learn/$videoId"
                          params={{ videoId: match.youtubeVideoId }}
                          className="hover:underline"
                        >
                          {match.videoTitle ?? u.videoTitle}
                        </Link>
                      ) : (
                        u.videoTitle
                      )}
                    </div>
                    <p className="text-sm leading-relaxed text-[var(--ink-soft)]">
                      {u.insight}
                    </p>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {digest.contradictions.length > 0 && (
          <section className="mb-10">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
              Where they disagree
            </h2>
            <div className="mt-4 grid gap-5">
              {digest.contradictions.map((c, i) => (
                <div
                  key={`contradiction-${i}`}
                  className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-5"
                >
                  <h3 className="text-base font-semibold text-[var(--ink)]">
                    {c.topic}
                  </h3>
                  <div className="mt-3 grid gap-3">
                    {c.positions.map((p, j) => {
                      const match = resolveVideoTitle(p.videoTitle, sources);
                      return (
                        <div key={`pos-${i}-${j}`} className="text-sm">
                          <div className="font-medium text-[var(--ink)]">
                            {match ? (
                              <Link
                                to="/learn/$videoId"
                                params={{ videoId: match.youtubeVideoId }}
                                className="hover:underline"
                              >
                                {match.videoTitle ?? p.videoTitle}
                              </Link>
                            ) : (
                              p.videoTitle
                            )}
                          </div>
                          <p className="mt-1 leading-relaxed text-[var(--ink-soft)]">
                            {p.stance}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {digest.viewingOrder.length > 0 && (
          <section className="mb-10">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
              Suggested viewing order
            </h2>
            <ol className="mt-4 grid gap-3">
              {digest.viewingOrder.map((v, i) => {
                const match = resolveVideoTitle(v.videoTitle, sources);
                return (
                  <li
                    key={`order-${i}`}
                    className="flex gap-4 rounded-xl border border-[var(--line)] bg-[var(--card)] p-4"
                  >
                    <span className="text-lg font-semibold text-[var(--ink-muted)]">
                      {i + 1}.
                    </span>
                    <div>
                      <div className="text-sm font-medium text-[var(--ink)]">
                        {match ? (
                          <Link
                            to="/learn/$videoId"
                            params={{ videoId: match.youtubeVideoId }}
                            className="hover:underline"
                          >
                            {match.videoTitle ?? v.videoTitle}
                          </Link>
                        ) : (
                          v.videoTitle
                        )}
                      </div>
                      <p className="mt-1 text-sm leading-relaxed text-[var(--ink-soft)]">
                        {v.why}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        )}

        <section className="mb-10">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--ink-muted)]">
            Source videos
          </h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {videos.map((v) => (
              <Link
                key={v.documentId}
                to="/learn/$videoId"
                params={{ videoId: v.youtubeVideoId }}
                className="flex gap-3 rounded-xl border border-[var(--line)] bg-[var(--card)] p-3 transition hover:border-[var(--line-strong)]"
              >
                {v.videoThumbnailUrl && (
                  <img
                    src={v.videoThumbnailUrl}
                    alt=""
                    className="h-16 w-28 shrink-0 rounded-md object-cover"
                  />
                )}
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-[var(--ink)]">
                    {v.videoTitle ?? v.youtubeVideoId}
                  </div>
                  {v.videoAuthor && (
                    <div className="truncate text-xs text-[var(--ink-muted)]">
                      {v.videoAuthor}
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </section>

      <DigestActionBar
        digest={digest}
        videos={videos}
        article={article}
        savedDigest={savedDigest}
        onSaved={onSaved}
      />
    </>
  );
}

// Mirrors ReadablePane for the video reader: explicit click-to-generate,
// auto-persists to the Digest row on generation, renders markdown + a
// regenerate affordance once the article exists. No lazy-on-mount — the
// user opts in.
function DigestArticleView({
  digest,
  videos,
  article,
  savedDigest,
  onArticleGenerated,
  onSaved,
}: Readonly<{
  digest: Digest;
  videos: StrapiVideo[];
  /** Seeded from a previously-saved digest row, or populated after a fresh
   * generation. When non-null we're in the "rendered" state. */
  article: string | null;
  savedDigest: StrapiDigest | null;
  onArticleGenerated: (markdown: string) => void;
  onSaved: (saved: StrapiDigest) => void;
}>) {
  if (!article) {
    return (
      <DigestArticleGenerate
        digest={digest}
        videos={videos}
        savedDigest={savedDigest}
        onArticleGenerated={onArticleGenerated}
        onSaved={onSaved}
      />
    );
  }
  return (
    <DigestArticleRendered
      digest={digest}
      videos={videos}
      article={article}
      savedDigest={savedDigest}
      onArticleGenerated={onArticleGenerated}
      onSaved={onSaved}
    />
  );
}

async function runGenerateAndSave(input: {
  digest: Digest;
  videos: StrapiVideo[];
  savedDigest: StrapiDigest | null;
  onArticleGenerated: (md: string) => void;
  onSaved: (saved: StrapiDigest) => void;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const videoIds = input.videos.map((v) => v.youtubeVideoId);
  const result = await generateDigestArticle({ data: { videoIds } });
  if (result.status === 'error') return { ok: false, error: result.error };
  input.onArticleGenerated(result.article);

  // Upsert the saved digest with the new article. This also saves the
  // structured digest metadata if it hasn't been saved before — consistent
  // with the video reader, where generating auto-persists.
  const saved = await saveDigest({
    data: {
      digest: input.digest,
      youtubeVideoIds: videoIds,
      articleMarkdown: result.article,
    },
  });
  if (saved.status === 'ok') {
    input.onSaved({
      ...(input.savedDigest ?? ({} as StrapiDigest)),
      documentId: saved.digestDocumentId,
      articleMarkdown: result.article,
    } as StrapiDigest);
  }
  return { ok: true };
}

function DigestArticleGenerate({
  digest,
  videos,
  savedDigest,
  onArticleGenerated,
  onSaved,
}: Readonly<{
  digest: Digest;
  videos: StrapiVideo[];
  savedDigest: StrapiDigest | null;
  onArticleGenerated: (md: string) => void;
  onSaved: (saved: StrapiDigest) => void;
}>) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const kickoff = async () => {
    if (running) return;
    setRunning(true);
    setError(null);
    try {
      const res = await runGenerateAndSave({
        digest,
        videos,
        savedDigest,
        onArticleGenerated,
        onSaved,
      });
      if (!res.ok) setError(res.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Article generation failed');
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-8 text-center sm:p-10">
      <h2 className="display-title text-2xl text-[var(--ink)] sm:text-3xl">
        Read this digest as an article
      </h2>
      <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-[var(--ink-muted)]">
        Turns the {videos.length}-video synthesis into a single long-form
        post — one coherent essay instead of a structured report. Cached
        once generated.
      </p>
      {error && (
        <div className="mx-auto mt-5 max-w-md rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      <div className="mt-8 flex justify-center">
        <Button onClick={kickoff} disabled={running} size="pill">
          {running ? 'Generating…' : 'Generate article'}
        </Button>
      </div>
    </section>
  );
}

function DigestArticleRendered({
  digest,
  videos,
  article,
  savedDigest,
  onArticleGenerated,
  onSaved,
}: Readonly<{
  digest: Digest;
  videos: StrapiVideo[];
  article: string;
  savedDigest: StrapiDigest | null;
  onArticleGenerated: (md: string) => void;
  onSaved: (saved: StrapiDigest) => void;
}>) {
  const [regenerating, setRegenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(article);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const regenerate = async () => {
    if (regenerating) return;
    if (
      !globalThis.confirm(
        'Regenerate the article? The current one will be replaced.',
      )
    ) {
      return;
    }
    setRegenerating(true);
    try {
      await runGenerateAndSave({
        digest,
        videos,
        savedDigest,
        onArticleGenerated,
        onSaved,
      });
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <>
      <article className="prose-article mx-auto max-w-2xl">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{article}</ReactMarkdown>
      </article>
      <section className="sticky bottom-4 z-10 mt-8 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 shadow-[0_4px_16px_rgba(9,9,11,0.06)]">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={copy}>
            {copied ? 'Copied' : 'Copy markdown'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={regenerate}
            disabled={regenerating}
          >
            {regenerating ? 'Regenerating…' : 'Regenerate article'}
          </Button>
        </div>
      </section>
    </>
  );
}

function SourceChips({
  videos,
}: Readonly<{ videos: DigestSourceVideo[] }>) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <span className="text-xs text-[var(--ink-muted)]">
        Based on {videos.length} videos:
      </span>
      {videos.map((v) => (
        <Link
          key={v.documentId}
          to="/learn/$videoId"
          params={{ videoId: v.youtubeVideoId }}
          className="inline-flex max-w-[200px] items-center rounded-full border border-[var(--line)] bg-[var(--card)] px-2.5 py-0.5 text-[0.65rem] font-medium text-[var(--ink-muted)] transition hover:border-[var(--line-strong)] hover:text-[var(--ink)]"
        >
          <span className="truncate">{v.videoTitle ?? v.youtubeVideoId}</span>
        </Link>
      ))}
    </div>
  );
}

function ThemeBlock({
  title,
  body,
  videoTitles,
  sources,
}: Readonly<{
  title: string;
  body: string;
  videoTitles: string[];
  sources: DigestSourceVideo[];
}>) {
  const matches = videoTitles
    .map((t) => resolveVideoTitle(t, sources))
    .filter((v): v is DigestSourceVideo => v !== null);
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5">
      <h3 className="text-base font-semibold leading-snug text-[var(--ink)]">
        {title}
      </h3>
      <p className="mt-3 text-sm leading-relaxed text-[var(--ink-soft)]">
        {body}
      </p>
      {matches.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-xs text-[var(--ink-muted)]">Covered in:</span>
          {matches.map((m) => (
            <Link
              key={m.documentId}
              to="/learn/$videoId"
              params={{ videoId: m.youtubeVideoId }}
              className="inline-flex max-w-[180px] items-center rounded-full border border-[var(--line)] bg-[var(--bg-subtle)] px-2.5 py-0.5 text-[0.65rem] font-medium text-[var(--ink-muted)] transition hover:border-[var(--line-strong)] hover:text-[var(--ink)]"
            >
              <span className="truncate">{m.videoTitle ?? m.youtubeVideoId}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// Actions: copy the digest as markdown, save to the Digest collection
// (one row per unique video set, upserted by videoSetKey so re-saving the
// same selection updates in place), or regenerate (re-invalidate the
// loader — same URL, fresh call).
function DigestActionBar({
  digest,
  videos,
  article,
  savedDigest,
  onSaved,
}: Readonly<{
  digest: Digest;
  videos: StrapiVideo[];
  article: string | null;
  savedDigest: StrapiDigest | null;
  onSaved: (saved: StrapiDigest | null) => void;
}>) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const markdown = digestToMarkdown(digest);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setSaveMsg(null);
    const res = await saveDigest({
      data: {
        digest,
        youtubeVideoIds: videos.map((v) => v.youtubeVideoId),
        articleMarkdown: article ?? undefined,
      },
    });
    setSaving(false);
    if (res.status === 'ok') {
      setSaveMsg(res.created ? 'Saved.' : 'Updated saved digest.');
      // Optimistic: mark the row as saved so the button label flips
      // without waiting for a re-fetch.
      onSaved({
        ...(savedDigest ?? ({} as StrapiDigest)),
        documentId: res.digestDocumentId,
        articleMarkdown: article ?? savedDigest?.articleMarkdown ?? null,
      } as StrapiDigest);
      window.setTimeout(() => setSaveMsg(null), 2500);
    } else {
      setSaveMsg(`Save failed: ${res.error}`);
    }
  };

  const regenerate = () => {
    router.invalidate();
  };

  const saveLabel = saving
    ? 'Saving…'
    : savedDigest
      ? 'Update saved digest'
      : 'Save digest';

  return (
    <section className="sticky bottom-4 z-10 mt-4 rounded-2xl border border-[var(--line)] bg-[var(--card)] p-4 shadow-[0_4px_16px_rgba(9,9,11,0.06)]">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={copy}>
          {copied ? 'Copied' : 'Copy markdown'}
        </Button>
        <Button variant="outline" size="sm" onClick={save} disabled={saving}>
          {saveLabel}
        </Button>
        <Button variant="outline" size="sm" onClick={regenerate}>
          Regenerate
        </Button>
        {saveMsg && (
          <span className="text-xs text-[var(--ink-muted)]">{saveMsg}</span>
        )}
      </div>
    </section>
  );
}

// =============================================================================
// Markdown serialization — used by Copy and Save-as-note actions
// =============================================================================

function digestToMarkdown(d: Digest): string {
  const lines: string[] = [];
  lines.push(`# ${d.title}`);
  lines.push('');
  lines.push(`_${d.description}_`);
  lines.push('');
  lines.push('## Bottom line');
  lines.push('');
  lines.push(d.bottomLine);
  lines.push('');
  lines.push('## Overall theme');
  lines.push('');
  lines.push(d.overallTheme);
  lines.push('');

  if (d.sharedThemes.length > 0) {
    lines.push('## Shared themes');
    lines.push('');
    for (const t of d.sharedThemes) {
      lines.push(`### ${t.title}`);
      lines.push('');
      lines.push(t.body);
      if (t.videoTitles.length > 0) {
        lines.push('');
        lines.push(`_Covered in: ${t.videoTitles.join(', ')}_`);
      }
      lines.push('');
    }
  }

  if (d.uniqueInsights.length > 0) {
    lines.push('## Unique contributions');
    lines.push('');
    for (const u of d.uniqueInsights) {
      lines.push(`- **${u.videoTitle}**: ${u.insight}`);
    }
    lines.push('');
  }

  if (d.contradictions.length > 0) {
    lines.push('## Where they disagree');
    lines.push('');
    for (const c of d.contradictions) {
      lines.push(`### ${c.topic}`);
      lines.push('');
      for (const p of c.positions) {
        lines.push(`- **${p.videoTitle}**: ${p.stance}`);
      }
      lines.push('');
    }
  }

  if (d.viewingOrder.length > 0) {
    lines.push('## Suggested viewing order');
    lines.push('');
    d.viewingOrder.forEach((v, i) => {
      lines.push(`${i + 1}. **${v.videoTitle}** — ${v.why}`);
    });
    lines.push('');
  }

  return lines.join('\n');
}
