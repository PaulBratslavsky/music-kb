// The unified score writer is THE place the "all three score fields stay
// consistent" invariant lives (see applyVideoScoreUpdateService). These
// tests pin that invariant once, instead of every caller re-proving it.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const strapiFetchMock = vi.fn();
vi.mock('./strapi-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./strapi-client')>();
  return {
    ...actual,
    strapiFetch: (...args: unknown[]) => strapiFetchMock(...args),
  };
});

import {
  applyVideoScoreUpdateService,
  computeFinalScore,
} from './videos';

function putBody(): Record<string, unknown> {
  const putCall = strapiFetchMock.mock.calls.find(([m]) => m === 'PUT');
  expect(putCall).toBeDefined();
  return (putCall![2] as { body: { data: Record<string, unknown> } }).body.data;
}

beforeEach(() => {
  strapiFetchMock.mockReset();
  strapiFetchMock.mockResolvedValue({ ok: true, data: {} });
});

describe('applyVideoScoreUpdateService', () => {
  it('verdict update blends finalScore against the existing signalScore', async () => {
    const res = await applyVideoScoreUpdateService(
      'doc-1',
      {
        kind: 'verdict',
        watchVerdict: 'worth_it',
        verdictSummary: 's',
        verdictReason: 'r',
        valueScore: 60,
      },
      { valueScore: 10, signalScore: 80 },
    );
    expect(res).toEqual({
      success: true,
      finalScore: computeFinalScore(60, 80),
    });
    const data = putBody();
    expect(data.valueScore).toBe(60);
    expect(data.valueScoreSource).toBe('model');
    expect(data.finalScore).toBe(computeFinalScore(60, 80));
    // Verdict path must not touch the signal fields.
    expect('signalScore' in data).toBe(false);
    // Prior provided — no extra GET.
    expect(strapiFetchMock.mock.calls.filter(([m]) => m === 'GET')).toHaveLength(0);
  });

  it('value update falls back to the bare value when no signalScore exists', async () => {
    const res = await applyVideoScoreUpdateService(
      'doc-2',
      { kind: 'value', valueScore: 45, valueScoreSource: 'derived' },
      { valueScore: null, signalScore: null },
    );
    expect(res).toEqual({ success: true, finalScore: 45 });
    const data = putBody();
    expect(data.valueScoreSource).toBe('derived');
    expect(data.finalScore).toBe(45);
  });

  it('signals update blends finalScore against the existing valueScore', async () => {
    const res = await applyVideoScoreUpdateService(
      'doc-3',
      {
        kind: 'signals',
        signalScores: {
          fillerDensity: 1,
          lexicalDensity: 2,
          compressionRatio: 3,
          speakingPace: 4,
          sponsorPresence: 5,
        },
        signalScore: 90,
      },
      { valueScore: 50, signalScore: 20 },
    );
    expect(res).toEqual({
      success: true,
      finalScore: computeFinalScore(50, 90),
    });
    const data = putBody();
    expect(data.signalScore).toBe(90);
    expect(data.finalScore).toBe(computeFinalScore(50, 90));
    expect('valueScore' in data).toBe(false);
  });

  it('rederive recomputes from stored components and no-ops when both are null', async () => {
    const wrote = await applyVideoScoreUpdateService(
      'doc-4',
      { kind: 'rederive' },
      { valueScore: 70, signalScore: 30 },
    );
    expect(wrote).toEqual({
      success: true,
      finalScore: computeFinalScore(70, 30),
    });
    expect(putBody()).toEqual({ finalScore: computeFinalScore(70, 30) });

    strapiFetchMock.mockClear();
    const noop = await applyVideoScoreUpdateService(
      'doc-5',
      { kind: 'rederive' },
      { valueScore: null, signalScore: null },
    );
    expect(noop).toEqual({ success: true, finalScore: null });
    expect(strapiFetchMock).not.toHaveBeenCalled();
  });

  it('fetches the component fields itself when no prior is passed', async () => {
    strapiFetchMock.mockImplementation(async (method: string) =>
      method === 'GET'
        ? { ok: true, data: { valueScore: 40, signalScore: 100 } }
        : { ok: true, data: {} },
    );
    const res = await applyVideoScoreUpdateService('doc-6', {
      kind: 'value',
      valueScore: 40,
      valueScoreSource: 'model',
    });
    expect(res).toEqual({
      success: true,
      finalScore: computeFinalScore(40, 100),
    });
    const getCall = strapiFetchMock.mock.calls.find(([m]) => m === 'GET');
    expect(getCall?.[1]).toBe('/api/videos/doc-6');
  });

  it('propagates write failures', async () => {
    strapiFetchMock.mockResolvedValue({ ok: false, status: 0, error: 'down' });
    const res = await applyVideoScoreUpdateService(
      'doc-7',
      { kind: 'value', valueScore: 10, valueScoreSource: 'model' },
      { valueScore: null, signalScore: null },
    );
    expect(res).toEqual({ success: false, error: 'down' });
  });
});
