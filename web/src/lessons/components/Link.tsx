// Router shim for ported lesson pages.
//
// music-kb's lessons use TanStack Router's <Link to="/builder" search={…}>.
// This app is hash-routed with no router library, so this maps `to` onto a
// hash path and accepts (and ignores) the router-specific props, letting
// the pages port without rewriting every link.

import type { ReactNode } from 'react';

const HASH: Record<string, string> = {
  '/': '#/',
  '/builder': '#/',
  '/theory': '#/theory',
  '/lessons': '#/lessons',
};

export function Link({
  to,
  children,
  className,
  params: _params,
  search: _search,
  ...rest
}: {
  to: string;
  children?: ReactNode;
  className?: string;
  params?: Record<string, unknown>;
  search?: Record<string, unknown>;
} & Record<string, unknown>) {
  const href = HASH[to] ?? (to.startsWith('/lessons/') ? `#${to}` : '#/');
  return (
    <a href={href} className={className} {...rest}>
      {children}
    </a>
  );
}
