// ThemeToggle — three-state switch (auto / light / dark) for the
// standalone visualizer. Stores the user's choice in localStorage.
// "Auto" follows the OS `prefers-color-scheme` and updates live.
//
// The active mode is reflected on <html> two ways:
//   - `class="light"` or `class="dark"` (for CSS rules using :root.light)
//   - `data-theme="light|dark"` (for :root[data-theme=...] selectors)
// Plus `colorScheme` is set so the browser's native form widgets follow.

import { useEffect, useState } from 'react';

type ThemeMode = 'light' | 'dark' | 'auto';

function getInitialMode(): ThemeMode {
  if (typeof window === 'undefined') return 'auto';
  const stored = window.localStorage.getItem('theme');
  if (stored === 'light' || stored === 'dark' || stored === 'auto') {
    return stored;
  }
  return 'auto';
}

function applyThemeMode(mode: ThemeMode) {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const resolved = mode === 'auto' ? (prefersDark ? 'dark' : 'light') : mode;

  document.documentElement.classList.remove('light', 'dark');
  document.documentElement.classList.add(resolved);

  if (mode === 'auto') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', mode);
  }

  document.documentElement.style.colorScheme = resolved;
}

export function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>('auto');

  // Apply the stored / default mode on mount.
  useEffect(() => {
    const initial = getInitialMode();
    setMode(initial);
    applyThemeMode(initial);
  }, []);

  // While in 'auto', subscribe to OS-level theme changes so the UI
  // flips when the user toggles light/dark at the system level.
  useEffect(() => {
    if (mode !== 'auto') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyThemeMode('auto');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [mode]);

  function cycleMode() {
    const next: ThemeMode =
      mode === 'light' ? 'dark' : mode === 'dark' ? 'auto' : 'light';
    setMode(next);
    applyThemeMode(next);
    window.localStorage.setItem('theme', next);
  }

  const label =
    mode === 'auto'
      ? 'Theme: auto (follows OS). Click to switch to light.'
      : `Theme: ${mode}. Click to cycle theme.`;

  return (
    <button
      type="button"
      onClick={cycleMode}
      aria-label={label}
      title={label}
      className="chip"
    >
      {mode === 'auto' ? '◐ Auto' : mode === 'dark' ? '◑ Dark' : '◯ Light'}
    </button>
  );
}
