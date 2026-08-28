import { useMemo } from 'react';
import { Link } from '@tanstack/react-router';
import type { StrapiVideo } from '#/lib/services/videos';
import { Chat } from '#/components/chat/Chat';
import { messageText, type ToolCallRecord } from '#/lib/services/ui-message';

// Chat UI for the /digest page.
//
// Everything structural — transcript, composer, model picker, error banner,
// tool-call state — lives in <Chat>. What is left here is the two things that
// are genuinely specific to cross-video chat: the tool chips, and citations
// resolved by matching `[<title> mm:ss]` against the selected videos and
// rendered as router links. On the per-video page the same citation is a
// player seek, which is why <Chat> takes a render prop rather than a flag.

const SUGGESTED_PROMPTS = [
  'What do these videos agree on?',
  'Where do they disagree?',
  'Which video goes deepest on the technical details?',
  'Summarize the throughline across all of them',
];

export function DigestChat({
  videos,
  className,
}: Readonly<{ videos: StrapiVideo[]; className?: string }>) {
  // Memoized so its identity is stable between renders — <Chat> forwards it
  // as chat-level props, and identity is what tells useChat to update.
  const scope = useMemo(
    () => ({ videoIds: videos.map((v) => v.youtubeVideoId) }),
    [videos],
  );

  return (
    <Chat
      surface="digest-chat"
      endpoint="/api/digest-chat"
      scope={scope}
      className={className}
      chrome={{
        ariaLabel: 'Cross-video chat',
        title: 'Ask across these videos',
        subtitle: `Answered using retrieved passages from all ${videos.length} videos.`,
        placeholder: 'Ask about these videos…',
      }}
      suggestedPrompts={SUGGESTED_PROMPTS}
      renderAboveBody={(_message, toolCalls) => <ToolChips toolCalls={toolCalls} />}
      renderBelowBody={(message) => (
        <CitationFooter content={messageText(message)} videos={videos} />
      )}
    />
  );
}

function ToolChips({ toolCalls }: Readonly<{ toolCalls: ToolCallRecord[] }>) {
  if (toolCalls.length === 0) return null;
  return (
    <div className="mb-2 flex flex-wrap gap-1.5">
      {toolCalls.map((tc) => (
        <span
          key={tc.id}
          className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--bg-subtle)] px-2.5 py-0.5 text-[0.65rem] font-medium text-[var(--ink-muted)]"
        >
          {tc.status === 'running' ? '⋯' : '✓'} {tc.name}
        </span>
      ))}
    </div>
  );
}

// Extract `[<title> mm:ss]` citations from the response and render as
// clickable chips that link to the source video's learn page. The chat
// bubble shows the raw text inline; this footer adds navigation.
function CitationFooter({
  content,
  videos,
}: Readonly<{ content: string; videos: StrapiVideo[] }>) {
  const regex = /\[([^\]]+?)\s+(\d{1,2}:\d{2}(?::\d{2})?)\]/g;
  const seen = new Set<string>();
  const cites: Array<{ title: string; timecode: string; video: StrapiVideo }> = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    const title = match[1].trim();
    const timecode = match[2];
    const video = videos.find(
      (v) =>
        (v.videoTitle ?? '').toLowerCase().includes(title.toLowerCase()) ||
        title.toLowerCase().includes((v.videoTitle ?? '').toLowerCase()),
    );
    if (!video) continue;
    const key = `${video.youtubeVideoId}-${timecode}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cites.push({ title, timecode, video });
  }

  if (cites.length === 0) return null;

  return (
    <div className="mt-3 flex flex-wrap gap-1.5 border-t border-[var(--line)] pt-3">
      <span className="text-[0.65rem] font-medium uppercase tracking-wider text-[var(--ink-muted)]">
        Sources:
      </span>
      {cites.map((c, i) => (
        <Link
          key={`${c.video.youtubeVideoId}-${i}`}
          to="/learn/$videoId"
          params={{ videoId: c.video.youtubeVideoId }}
          className="inline-flex max-w-[200px] items-center rounded-full border border-[var(--line)] bg-[var(--card)] px-2.5 py-0.5 text-[0.65rem] font-medium text-[var(--ink-muted)] transition hover:border-[var(--line-strong)] hover:text-[var(--ink)]"
        >
          <span className="truncate">
            {c.video.videoTitle ?? c.video.youtubeVideoId} · {c.timecode}
          </span>
        </Link>
      ))}
    </div>
  );
}
