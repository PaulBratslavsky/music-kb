import type { Instrument } from '../types';

const key = (i: Instrument) => `triadview.gamemode.bestStreak.${i}`;

export function loadBestStreak(i: Instrument): number {
  if (typeof window === 'undefined') return 0;
  const raw = window.localStorage.getItem(key(i));
  if (raw == null) return 0;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function saveBestStreak(i: Instrument, value: number): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key(i), String(value));
  } catch {
    // storage may be disabled (quota, private mode); silently ignore
  }
}
