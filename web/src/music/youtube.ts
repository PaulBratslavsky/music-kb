// YouTube URL parsing + metadata fetch.
//
// All-frontend feature: we can't call YouTube's data API (would leak a
// key) and youtube.com/oembed is CORS-blocked from the browser. Public
// noembed.com proxies the oEmbed call with permissive CORS — fine for
// a personal tool. Network failures fall back to the convention
// thumbnail URL + empty title/author (the UI lets the user fill those
// in manually).

const YOUTUBE_HOSTS = ['www.youtube.com', 'youtube.com', 'm.youtube.com', 'youtu.be'];

/**
 * Extract the 11-char YouTube video id from any of the URL shapes:
 *   - https://www.youtube.com/watch?v=XFkzRNyygfk
 *   - https://youtu.be/XFkzRNyygfk
 *   - https://www.youtube.com/embed/XFkzRNyygfk
 *   - https://www.youtube.com/shorts/XFkzRNyygfk
 *   - any of the above with ?si=... or &t=... params
 *
 * Returns null when the URL isn't a recognized YouTube link.
 */
export function extractYouTubeVideoId(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (!YOUTUBE_HOSTS.includes(u.hostname.toLowerCase())) return null;
  // youtu.be short link → id is the first path segment
  if (u.hostname.toLowerCase() === 'youtu.be') {
    const id = u.pathname.replace(/^\//, '').split('/')[0];
    return /^[\w-]{11}$/.test(id) ? id : null;
  }
  // watch?v=ID
  const v = u.searchParams.get('v');
  if (v && /^[\w-]{11}$/.test(v)) return v;
  // /embed/ID or /shorts/ID
  const parts = u.pathname.split('/').filter(Boolean);
  if (parts.length >= 2 && (parts[0] === 'embed' || parts[0] === 'shorts')) {
    return /^[\w-]{11}$/.test(parts[1]) ? parts[1] : null;
  }
  return null;
}

export type YouTubeMeta = {
  title: string;
  author: string;
  thumbnailUrl: string;
  /** False when noembed didn't answer — UI shows the title field
   *  as editable so the user can fill it in. */
  fetched: boolean;
};

/** The convention thumbnail URL for any video id. Works without a
 *  network call — just constructs the i.ytimg.com path. */
export function thumbnailFor(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

/**
 * Fetch title / author from noembed.com. Never throws — on any
 * failure, returns a stub with `fetched: false` so the caller can
 * surface a manual-entry hint without aborting the save flow.
 */
export async function fetchYouTubeMeta(
  url: string,
  videoId: string,
): Promise<YouTubeMeta> {
  const fallback: YouTubeMeta = {
    title: '',
    author: '',
    thumbnailUrl: thumbnailFor(videoId),
    fetched: false,
  };
  try {
    const endpoint = `https://noembed.com/embed?url=${encodeURIComponent(url)}&format=json`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const resp = await fetch(endpoint, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!resp.ok) return fallback;
    const data = (await resp.json()) as {
      title?: string;
      author_name?: string;
      thumbnail_url?: string;
      error?: string;
    };
    if (data.error) return fallback;
    return {
      title: data.title?.trim() ?? '',
      author: data.author_name?.trim() ?? '',
      thumbnailUrl: data.thumbnail_url ?? thumbnailFor(videoId),
      fetched: true,
    };
  } catch {
    return fallback;
  }
}
