import { useState } from 'react';
import { useRouter } from '@tanstack/react-router';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '#/components/ui/button';
import { generateReadableArticle } from '#/data/server-functions/reader';
import type { StrapiVideo } from '#/lib/services/videos';

// Rendered in the left pane of /learn when the Read tab is active.
// Handles two states: article not yet generated (show CTA) and article
// ready (show markdown body + regenerate button). No separate route —
// the video player + chat in the right pane remain mounted and usable.
export function ReadablePane({
  video,
}: Readonly<{ video: StrapiVideo }>) {
  if (!video.readableArticle) {
    return <ReadableGenerate video={video} />;
  }
  return <ReadableArticle video={video} />;
}

function ReadableGenerate({ video }: Readonly<{ video: StrapiVideo }>) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const kickoff = async () => {
    if (running) return;
    setRunning(true);
    setError(null);
    try {
      const result = await generateReadableArticle({
        data: { videoId: video.youtubeVideoId },
      });
      if (result.status === 'error') {
        setError(result.error);
        return;
      }
      await router.invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Article generation failed');
    } finally {
      setRunning(false);
    }
  };

  return (
    <section className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-8 text-center sm:p-10">
      <h2 className="display-title text-2xl text-[var(--ink)] sm:text-3xl">
        Read this video as an article
      </h2>
      <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-[var(--ink-muted)]">
        Turns the transcript into a clean long-form post — filler, sponsor
        reads, and tangents stripped. Takes a few seconds to a few
        minutes depending on video length. Once generated, it&apos;s
        cached.
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

function ReadableArticle({ video }: Readonly<{ video: StrapiVideo }>) {
  const router = useRouter();
  const [regenerating, setRegenerating] = useState(false);

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
      await generateReadableArticle({
        data: { videoId: video.youtubeVideoId, forceRegenerate: true },
      });
      await router.invalidate();
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <article className="prose-article">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {video.readableArticle ?? ''}
        </ReactMarkdown>
      </article>

      <footer className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] pt-6 text-xs text-[var(--ink-muted)]">
        <div>
          Generated{' '}
          {video.readableArticleGeneratedAt
            ? new Date(video.readableArticleGeneratedAt).toLocaleDateString()
            : '—'}
          {video.readableArticleModel ? ` · ${video.readableArticleModel}` : null}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={regenerate}
          disabled={regenerating}
        >
          {regenerating ? 'Regenerating…' : 'Regenerate article'}
        </Button>
      </footer>
    </div>
  );
}
