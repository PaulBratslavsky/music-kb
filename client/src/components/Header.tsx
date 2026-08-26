import { useEffect, useRef } from 'react'
import { Link, useLocation } from '@tanstack/react-router'
import ThemeToggle from './ThemeToggle'

export default function Header() {
  const pathname = useLocation({ select: (l) => l.pathname })
  const onNewPost = pathname === '/new-post'

  // Publishes the header's REAL rendered height as --header-h (see
  // styles.css's fallback comment) so any page that pins content to the
  // header's bottom edge — learn.$videoId.tsx's `lg:fixed` pane — tracks
  // the actual value instead of a hardcoded `4rem`/`top-16` that drifts
  // out of sync with the header's own padding (measured 67px at `lg:`,
  // not 64px). A ResizeObserver rather than a one-time read: the header's
  // height changes across the sm/lg breakpoints (py-3 vs sm:py-4).
  const headerRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = headerRef.current
    if (!el) return
    const setVar = () => {
      document.documentElement.style.setProperty('--header-h', `${el.offsetHeight}px`)
    }
    setVar()
    const observer = new ResizeObserver(setVar)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <header
      ref={headerRef}
      className="sticky top-0 z-40 border-b border-[var(--line)] bg-[var(--header-bg)] backdrop-blur-lg"
    >
      <nav className="flex items-center gap-3 px-6 py-3 sm:px-10 sm:py-4 lg:px-14">
        <Link to="/" className="inline-flex items-center gap-2 no-underline">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--ink)] text-[var(--card)]">
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 6l16 0" />
              <path d="M4 12l16 0" />
              <path d="M10 18l10 0" />
            </svg>
          </span>
          <span className="text-[15px] font-semibold tracking-tight text-[var(--ink)]">
            Music KB
          </span>
        </Link>

        {/* Desktop nav — hidden on mobile; mobile uses the bottom nav */}
        <div className="ml-auto hidden items-center gap-5 md:flex">
          <Link
            to="/feed"
            className="nav-link text-sm"
            activeProps={{ className: 'nav-link is-active text-sm' }}
          >
            Feed
          </Link>
          <Link
            to="/digests"
            className="nav-link text-sm"
            activeProps={{ className: 'nav-link is-active text-sm' }}
          >
            Digests
          </Link>
          <Link
            to="/search"
            className="nav-link text-sm"
            activeProps={{ className: 'nav-link is-active text-sm' }}
          >
            Search
          </Link>
          <Link
            to="/builder"
            className="nav-link text-sm"
            activeProps={{ className: 'nav-link is-active text-sm' }}
          >
            Builder
          </Link>
          <Link
            to="/theory"
            className="nav-link text-sm"
            activeProps={{ className: 'nav-link is-active text-sm' }}
          >
            Theory
          </Link>
          <Link
            to="/lessons"
            className="nav-link text-sm"
            activeProps={{ className: 'nav-link is-active text-sm' }}
          >
            Lessons
          </Link>
          <Link
            to="/music"
            className="nav-link text-sm"
            activeProps={{ className: 'nav-link is-active text-sm' }}
          >
            Music
          </Link>
          <Link
            to="/about"
            className="nav-link text-sm"
            activeProps={{ className: 'nav-link is-active text-sm' }}
          >
            About
          </Link>
          <Link
            to="/settings"
            className="nav-link text-sm"
            activeProps={{ className: 'nav-link is-active text-sm' }}
          >
            Settings
          </Link>
          {!onNewPost && (
            <Link
              to="/new-post"
              aria-label="Share a video"
              className="inline-flex items-center gap-1.5 rounded-full bg-[var(--ink)] px-3.5 py-1.5 text-sm font-medium text-[var(--cream)] no-underline transition hover:bg-[var(--ink-soft)]"
            >
              <svg
                viewBox="0 0 24 24"
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
              Share
            </Link>
          )}
          <ThemeToggle />
        </div>

        {/* Mobile: just theme toggle; mobile uses BottomNav for routing */}
        <div className="ml-auto flex items-center gap-2 md:hidden">
          <ThemeToggle />
        </div>
      </nav>
    </header>
  )
}
