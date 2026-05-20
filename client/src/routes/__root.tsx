import { HeadContent, Scripts, createRootRoute, useLocation } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import Footer from '../components/Footer'
import Header from '../components/Header'
import { BottomNav } from '../components/BottomNav'
import { LibraryChat } from '../components/LibraryChat'

// Pathnames where the marketing footer renders. Everywhere else (feed,
// learn, search, settings, digests, etc.) the chrome-heavy footer
// competes for attention with task-focused UI, so we hide it.
const FOOTER_PATHS = new Set(['/', '/about'])

import appCss from '../styles.css?url'

const THEME_INIT_SCRIPT = `(function(){try{var stored=window.localStorage.getItem('theme');var mode=(stored==='light'||stored==='dark'||stored==='auto')?stored:'auto';var prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;var resolved=mode==='auto'?(prefersDark?'dark':'light'):mode;var root=document.documentElement;root.classList.remove('light','dark');root.classList.add(resolved);if(mode==='auto'){root.removeAttribute('data-theme')}else{root.setAttribute('data-theme',mode)}root.style.colorScheme=resolved;}catch(e){}})();`

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Music KB' },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: Readonly<{ children: React.ReactNode }>) {
  // One QueryClient per app lifetime. Kept in state (not module-level)
  // so hot reload doesn't recreate it mid-session and wipe the cache.
  // Defaults: no auto-refetch; most of our data is fetched via route
  // loaders, useQuery/useMutation here is opt-in where it fits.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            staleTime: 60_000,
          },
        },
      }),
  )
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <HeadContent />
      </head>
      <body
        suppressHydrationWarning
        className="font-sans antialiased wrap-anywhere selection:bg-[rgba(124,176,105,0.3)]"
      >
        <QueryClientProvider client={queryClient}>
          <Header />
          {children}
          <ConditionalFooter />
          <BottomNav />
          <LibraryChat />
        </QueryClientProvider>
        <Scripts />
      </body>
    </html>
  )
}

function ConditionalFooter() {
  const { pathname } = useLocation()
  if (!FOOTER_PATHS.has(pathname)) return null
  return <Footer />
}
