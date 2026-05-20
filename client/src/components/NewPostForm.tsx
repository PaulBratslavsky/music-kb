import { useEffect, useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { useRouter } from '@tanstack/react-router';
import { Button } from '#/components/ui/button';
import { Label } from '#/components/ui/label';
import { Textarea } from '#/components/ui/textarea';
import { FieldText } from '#/components/forms/FieldText';
import { GenerationModeSelect } from '#/components/GenerationModeSelect';
import {
  shareVideo,
  suggestTagsForUrl,
} from '#/data/server-functions/videos';
import {
  ShareVideoFormSchema,
  extractYouTubeVideoId,
  type GenerationMode,
  type ShareVideoFormValues,
} from '#/lib/validations/post';
import type { SuggestedTag } from '#/lib/services/embeddings';

// Share-a-video form. Paste a YouTube URL, add an optional caption + tags.
// The server function extracts the video id, fetches oEmbed metadata,
// creates the Video row, and kicks off AI summary generation in the
// background. We redirect to /learn/$videoId on success; the learn page
// polls for the summary to finish.
export function NewPostForm() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: {
      url: '',
      caption: '',
      tags: '',
      mode: 'auto' as GenerationMode,
    } satisfies ShareVideoFormValues,
    validators: { onChange: ShareVideoFormSchema as never },
    onSubmit: async ({ value }) => {
      setServerError(null);
      const parsed = ShareVideoFormSchema.safeParse(value);
      if (!parsed.success) {
        setServerError('Fix the highlighted fields and try again');
        return;
      }

      const result = await shareVideo({
        data: {
          url: parsed.data.url,
          caption: parsed.data.caption || undefined,
          tags: parsed.data.tags || undefined,
          mode: parsed.data.mode,
        },
      });

      if (result.status === 'error') {
        setServerError(result.error);
        return;
      }

      await router.invalidate();
      router.navigate({
        to: '/learn/$videoId',
        params: { videoId: result.video.youtubeVideoId },
      });
    },
  });

  // Append a tag to the comma-separated `tags` field. De-dupes case-
  // insensitively. Reads the current tag string through the form state
  // snapshot; the render subtree below subscribes for reactivity.
  const addTag = (tag: string) => {
    const current = form.state.values.tags;
    const parts = current
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const exists = parts.some(
      (p: string) => p.toLowerCase() === tag.toLowerCase(),
    );
    if (exists) return;
    const next = [...parts, tag].join(', ');
    form.setFieldValue('tags', next);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        form.handleSubmit();
      }}
      className="grid gap-5"
    >
      <form.Field name="url">
        {(field) => (
          <FieldText
            field={field}
            label="YouTube URL"
            placeholder="https://www.youtube.com/watch?v=…"
            disabled={form.state.isSubmitting}
          />
        )}
      </form.Field>

      <div>
        <Label htmlFor="caption" className="mb-1.5 block text-sm font-medium">
          Why share this? <span className="text-[var(--ink-muted)]">(optional)</span>
        </Label>
        <form.Field name="caption">
          {(field) => (
            <Textarea
              id="caption"
              placeholder="What did you learn, or why is it worth watching?"
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              onBlur={field.handleBlur}
              disabled={form.state.isSubmitting}
              rows={3}
              className="resize-none"
            />
          )}
        </form.Field>
      </div>

      <div className="grid gap-2">
        <form.Field name="tags">
          {(field) => (
            <FieldText
              field={field}
              label="Tags (comma-separated)"
              placeholder="ai, productivity, python"
              disabled={form.state.isSubmitting}
            />
          )}
        </form.Field>
        <form.Subscribe
          selector={(s: { values: { url: string; tags: string } }) => ({
            url: s.values.url,
            tags: s.values.tags,
          })}
        >
          {({ url, tags }: { url: string; tags: string }) => (
            <SuggestedTagsRow
              url={url}
              tagsValue={tags}
              onAddTag={addTag}
              disabled={form.state.isSubmitting}
            />
          )}
        </form.Subscribe>
      </div>

      <form.Field name="mode">
        {(field) => (
          <GenerationModeSelect
            value={field.state.value as GenerationMode}
            onChange={(next) => field.handleChange(next)}
            disabled={form.state.isSubmitting}
          />
        )}
      </form.Field>

      {serverError && (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {serverError}
        </p>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button
          type="submit"
          size="pill"
          disabled={form.state.isSubmitting || !form.state.canSubmit}
        >
          {form.state.isSubmitting ? 'Sharing…' : 'Share video'}
        </Button>
      </div>
    </form>
  );
}

// Debounced suggestion row. Calls `suggestTagsForUrl` 600ms after the URL
// settles; quietly renders nothing when the library is empty, the URL
// can't be parsed, or Ollama can't embed. Never blocks the form.
function SuggestedTagsRow({
  url,
  tagsValue,
  onAddTag,
  disabled,
}: Readonly<{
  url: string;
  tagsValue: string;
  onAddTag: (tag: string) => void;
  disabled: boolean;
}>) {
  const [state, setState] = useState<
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'ready'; suggestions: SuggestedTag[] }
  >({ kind: 'idle' });

  useEffect(() => {
    const videoId = extractYouTubeVideoId(url);
    if (!videoId) {
      setState({ kind: 'idle' });
      return;
    }
    setState({ kind: 'loading' });
    const handle = window.setTimeout(async () => {
      const res = await suggestTagsForUrl({ data: { url } });
      if (res.status !== 'ok') {
        setState({ kind: 'ready', suggestions: [] });
        return;
      }
      setState({ kind: 'ready', suggestions: res.suggestions });
    }, 600);
    return () => window.clearTimeout(handle);
  }, [url]);

  if (state.kind === 'idle') return null;
  if (state.kind === 'loading') {
    return (
      <p className="text-xs text-[var(--ink-muted)]">
        Looking for similar videos in your library…
      </p>
    );
  }
  if (state.suggestions.length === 0) return null;

  const alreadyAdded = new Set(
    tagsValue
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-[var(--ink-muted)]">
        Suggested from similar videos:
      </span>
      <div className="flex flex-wrap gap-1.5">
        {state.suggestions.map((s) => {
          const added = alreadyAdded.has(s.name.toLowerCase());
          return (
            <button
              key={s.slug}
              type="button"
              onClick={() => !added && onAddTag(s.name)}
              disabled={disabled || added}
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition ${
                added
                  ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)] cursor-default'
                  : 'border-[var(--line)] bg-[var(--bg-subtle)] text-[var(--ink-muted)] hover:border-[var(--line-strong)] hover:text-[var(--ink)]'
              }`}
              title={
                added
                  ? 'Already added'
                  : `Add #${s.name} (${(s.score * 100).toFixed(0)}% confidence)`
              }
            >
              {added ? '✓ ' : '+ '}
              {s.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
