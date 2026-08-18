// Tiny hash-based router. Listens to window.location.hash and parses
// it into a typed Route. Used by the music section so library / player
// links are bookmarkable + back-button works without dragging in a
// real router dependency.
//
// Supported shapes:
//   (empty)        → { kind: 'home' }         — the visualizer home
//   #/music        → { kind: 'library' }      — saved videos list
//   #/video/<id>   → { kind: 'player', id }   — saved video player
//   #/theory       → { kind: 'theory' }       — theory reference
//   #/lessons      → { kind: 'lessons' }      — lessons index
//   #/lessons/<s>  → { kind: 'lesson', slug } — one lesson
//
// `useRoute()` is reactive: components re-render on hash change.
// `navigate(route)` programmatically sets the hash.

import { useEffect, useState } from 'react';

export type Route =
  | { kind: 'home' }
  | { kind: 'library' }
  | { kind: 'player'; id: string }
  | { kind: 'theory' }
  | { kind: 'lessons' }
  | { kind: 'lesson'; slug: string };

export function parseHash(hash: string): Route {
  // hash includes the leading '#'; strip it before splitting
  const path = hash.replace(/^#/, '');
  if (path === '' || path === '/') return { kind: 'home' };
  const parts = path.split('/').filter(Boolean);
  if (parts[0] === 'music' && parts.length === 1) return { kind: 'library' };
  if (parts[0] === 'video' && parts.length === 2) {
    return { kind: 'player', id: parts[1] };
  }
  if (parts[0] === 'theory' && parts.length === 1) return { kind: 'theory' };
  if (parts[0] === 'lessons') {
    return parts.length === 1
      ? { kind: 'lessons' }
      : { kind: 'lesson', slug: parts[1] };
  }
  return { kind: 'home' };
}

export function routeToHash(route: Route): string {
  switch (route.kind) {
    case 'home':
      return '';
    case 'library':
      return '#/music';
    case 'player':
      return `#/video/${route.id}`;
    case 'theory':
      return '#/theory';
    case 'lessons':
      return '#/lessons';
    case 'lesson':
      return `#/lessons/${route.slug}`;
  }
}

export function navigate(route: Route): void {
  if (typeof window === 'undefined') return;
  const next = routeToHash(route);
  // Use location.hash so the browser registers a real history entry,
  // letting back-button return the user to the previous view.
  if (next === '') {
    history.pushState(null, '', window.location.pathname + window.location.search);
    // hashchange doesn't fire for pushState that strips the hash; emit manually.
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    window.location.hash = next;
  }
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() =>
    typeof window === 'undefined' ? { kind: 'home' } : parseHash(window.location.hash),
  );
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    // popstate fires for back/forward when we used pushState to clear hash
    window.addEventListener('popstate', onChange);
    return () => {
      window.removeEventListener('hashchange', onChange);
      window.removeEventListener('popstate', onChange);
    };
  }, []);
  return route;
}
