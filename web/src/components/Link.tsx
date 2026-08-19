// Router shim for ported lesson pages and panels.
//
// music-kb's pages use TanStack Router's <Link to="/builder" search={…}>.
// This app is hash-routed with no router library, so this maps `to` onto a
// hash path and accepts the router-specific props, letting the pages port
// without rewriting every link.
//
// `search.theory` is the one prop that carries meaning rather than being
// noise. music-kb bundles builder state into a single colon-delimited
// string (`chord:C#:min`) because its learn route strips unknown search
// params; this app has no such constraint and reads plain params off
// `location.search`, so the shim translates. Without it the link still
// navigated — to the builder's default C major, silently ignoring which
// chord you clicked.

import type { ReactNode } from 'react';

const HASH: Record<string, string> = {
  '/': '#/',
  '/builder': '#/',
  '/theory': '#/theory',
  '/lessons': '#/lessons',
};

// `chord:<root>:<quality>[:<inv>[:<voicing>]]` · `scale:<root>:<type>` ·
// `note:<root>` → this app's query string. Anything unrecognised returns
// '' and the link just opens the builder's default state, which is the
// same thing that happened before the shim understood the param at all.
function queryFromTheoryParam(raw: unknown): string {
  if (typeof raw !== 'string' || raw === '') return '';
  const [kind, a, b, inv, voicing] = raw.split(':');
  const params = new URLSearchParams();

  if (kind === 'chord' && a && b) {
    params.set('mode', 'chord');
    params.set('root', a);
    params.set('quality', b);
    if (inv) params.set('inv', inv);
    if (voicing) params.set('v', voicing);
  } else if (kind === 'scale' && a && b) {
    params.set('mode', 'scale');
    params.set('root', a);
    params.set('type', b);
  } else if (kind === 'note' && a) {
    params.set('mode', 'note');
    params.set('note', a);
  } else {
    return '';
  }
  return `?${params.toString()}`;
}

export function Link({
  to,
  children,
  className,
  params: _params,
  search,
  ...rest
}: {
  to: string;
  children?: ReactNode;
  className?: string;
  params?: Record<string, unknown>;
  search?: Record<string, unknown>;
} & Record<string, unknown>) {
  const hash = HASH[to] ?? (to.startsWith('/lessons/') ? `#${to}` : '#/');
  // Builder state lives in the real query string, not the hash, so it has
  // to go before the '#'.
  const query = to === '/builder' || to === '/' ? queryFromTheoryParam(search?.theory) : '';
  const href = `${query}${hash}`;

  return (
    <a href={href} className={className} {...rest}>
      {children}
    </a>
  );
}
