// Music library — list of saved YouTube videos with a paste-URL form
// to add new ones. Clicking a card navigates to #/video/<id>.
//
// The "add" flow:
//   1. User pastes a YouTube URL.
//   2. We extract the video id (rejects non-YouTube URLs up-front).
//   3. We fire noembed in the background; user sees the URL field
//      already cleared and the new card mid-fetch.
//   4. Card appears immediately with the convention thumbnail; title
//      streams in once noembed returns.
//   5. If noembed fails, the title shows as "(untitled — click to edit)"
//      and clicking the card opens the player; user can rename later.

import { useEffect, useState } from 'react';
import { listVideos, addVideo, deleteVideo } from './storage';
import {
  extractYouTubeVideoId,
  fetchYouTubeMeta,
  thumbnailFor,
} from './youtube';
import type { SavedVideo } from './types';
import { navigate } from './useHashRoute';

export function LibraryPage() {
  const [videos, setVideos] = useState<SavedVideo[]>(() => listVideos());

  const refresh = () => setVideos(listVideos());

  const handleAdd = async (url: string): Promise<string | null> => {
    const trimmed = url.trim();
    const videoId = extractYouTubeVideoId(trimmed);
    if (!videoId) return "Doesn't look like a YouTube URL.";
    // Save immediately with the convention thumbnail so the card
    // appears without a network round-trip — title fills in async.
    const record = addVideo({
      url: trimmed,
      youtubeVideoId: videoId,
      title: '',
      author: '',
      thumbnailUrl: thumbnailFor(videoId),
    });
    refresh();
    // Best-effort noembed fetch. Updates the same record once back.
    void fetchYouTubeMeta(trimmed, videoId).then((meta) => {
      if (!meta.fetched && !meta.title) return; // nothing new to write
      // Re-read + write — addVideo and updateVideo share the same key.
      const updated = listVideos().map((v) =>
        v.id === record.id
          ? {
              ...v,
              title: meta.title || v.title,
              author: meta.author || v.author,
              thumbnailUrl: meta.thumbnailUrl || v.thumbnailUrl,
            }
          : v,
      );
      window.localStorage.setItem('tv:videos', JSON.stringify(updated));
      setVideos(updated);
    });
    return null;
  };

  const handleDelete = (id: string) => {
    if (!window.confirm('Delete this video and its loops?')) return;
    deleteVideo(id);
    refresh();
  };

  return (
    <main className="panel" style={{ padding: 28, maxWidth: 960, margin: '0 auto' }}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0 }}>Music</h1>
        <p style={{ marginTop: 6, color: 'var(--text-dim)', fontSize: 14 }}>
          Songs you've saved for practicing. Paste a YouTube link to add
          one — the player + Wheel of Fifths live on the next page.
        </p>
      </header>
      <AddVideoForm onAdd={handleAdd} />
      {videos.length === 0 ? (
        <EmptyState />
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 16,
            marginTop: 24,
          }}
        >
          {videos.map((v) => (
            <VideoCard key={v.id} video={v} onDelete={handleDelete} />
          ))}
        </div>
      )}
    </main>
  );
}

function AddVideoForm({
  onAdd,
}: {
  onAdd: (url: string) => Promise<string | null>;
}) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const err = await onAdd(url);
    setSaving(false);
    if (err) {
      setError(err);
      return;
    }
    setUrl('');
  };

  return (
    <form
      onSubmit={submit}
      style={{
        display: 'flex',
        gap: 8,
        flexWrap: 'wrap',
        alignItems: 'center',
      }}
    >
      <input
        type="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://www.youtube.com/watch?v=…"
        required
        disabled={saving}
        style={{
          flex: 1,
          minWidth: 280,
          padding: '8px 12px',
          fontSize: 14,
          border: '1px solid var(--border)',
          borderRadius: 6,
          background: 'var(--panel-2)',
          color: 'var(--text)',
          fontFamily: 'inherit',
        }}
      />
      <button
        type="submit"
        className="chip active"
        disabled={saving || !url.trim()}
        style={{ padding: '8px 16px' }}
      >
        {saving ? 'Adding…' : '+ Add video'}
      </button>
      {error && (
        <p
          style={{
            width: '100%',
            margin: 0,
            color: 'var(--root)',
            fontSize: 13,
          }}
        >
          {error}
        </p>
      )}
    </form>
  );
}

function EmptyState() {
  return (
    <div
      style={{
        marginTop: 32,
        padding: 32,
        border: '1px dashed var(--border)',
        borderRadius: 12,
        textAlign: 'center',
        color: 'var(--text-dim)',
      }}
    >
      <p style={{ margin: 0, fontWeight: 600, color: 'var(--text)' }}>
        No music yet.
      </p>
      <p style={{ marginTop: 6, fontSize: 14 }}>
        Paste a YouTube URL above to add the first track.
      </p>
    </div>
  );
}

function VideoCard({
  video,
  onDelete,
}: {
  video: SavedVideo;
  onDelete: (id: string) => void;
}) {
  return (
    <article
      style={{
        position: 'relative',
        background: 'var(--panel)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={() => navigate({ kind: 'player', id: video.id })}
        style={{
          all: 'unset',
          display: 'block',
          width: '100%',
          cursor: 'pointer',
          color: 'var(--text)',
        }}
      >
        <div
          style={{
            aspectRatio: '16 / 9',
            width: '100%',
            background: 'var(--panel-2)',
            overflow: 'hidden',
          }}
        >
          <img
            src={video.thumbnailUrl}
            alt={video.title || 'video thumbnail'}
            loading="lazy"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </div>
        <div style={{ padding: 12 }}>
          <h2
            style={{
              margin: 0,
              fontSize: 14,
              fontWeight: 600,
              lineHeight: 1.3,
              minHeight: '2.6em',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {video.title || '(Untitled — click to edit)'}
          </h2>
          {video.author && (
            <p
              style={{
                margin: '4px 0 0',
                fontSize: 12,
                color: 'var(--text-dim)',
              }}
            >
              {video.author}
            </p>
          )}
        </div>
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDelete(video.id);
        }}
        aria-label="Delete video"
        title="Delete video and its loops"
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          width: 28,
          height: 28,
          borderRadius: 6,
          border: '1px solid var(--border)',
          background: 'rgba(15, 17, 21, 0.8)',
          color: 'var(--text-dim)',
          cursor: 'pointer',
          fontSize: 14,
          fontFamily: 'inherit',
        }}
      >
        ×
      </button>
    </article>
  );
}

// Re-export for App.tsx consumers
export { listVideos } from './storage';
// Force-include a useEffect import that we use above
void useEffect;
