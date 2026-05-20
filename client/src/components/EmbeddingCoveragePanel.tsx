import { useEffect, useState } from 'react';
import { useRouter } from '@tanstack/react-router';
import { Button } from '#/components/ui/button';
import {
  getEmbeddingCoverage,
  getPassageCoverage,
  reindexAllEmbeddings,
  reindexAllPassages,
  type EmbeddingCoverage,
  type PassageCoverage,
} from '#/data/server-functions/videos';

// Embedding index health + backfill controls. Lives on /settings — it's
// app-level infra, not content, so it doesn't belong inside /feed or
// /digests. Safe to render anywhere if that calculus ever changes.
export function EmbeddingCoveragePanel() {
  return (
    <div className="grid gap-4">
      <SummaryEmbeddingPanel />
      <PassageEmbeddingPanel />
    </div>
  );
}

function SummaryEmbeddingPanel() {
  const router = useRouter();
  const [coverage, setCoverage] = useState<EmbeddingCoverage | null>(null);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    const res = await getEmbeddingCoverage();
    setCoverage(res);
  };

  useEffect(() => {
    void load();
  }, []);

  const runBackfill = async (
    scope: 'missing' | 'stale' | 'all',
    force = false,
  ) => {
    if (running) return;
    setRunning(true);
    setMessage(null);
    try {
      const res = await reindexAllEmbeddings({ data: { scope, force } });
      if (res.status === 'ok') {
        setMessage(
          `Embedded ${res.succeeded}/${res.targeted}${res.failed ? ` · ${res.failed} failed` : ''} · ${(res.tookMs / 1000).toFixed(1)}s`,
        );
      }
      await load();
      await router.invalidate();
    } finally {
      setRunning(false);
    }
  };

  if (!coverage) {
    return (
      <section className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5 text-xs text-[var(--ink-muted)]">
        Loading embedding coverage…
      </section>
    );
  }

  const { total, current, stale, missing, currentModel, currentVersion } = coverage;
  const allCovered = total > 0 && stale === 0 && missing === 0;

  return (
    <section className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[var(--ink)]">
            Summary embeddings (Tier 1)
          </h3>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">
            One vector per video from the summary layer. Powers related-videos
            on the learn page and library-wide semantic search on the feed.
            Model:{' '}
            <span className="font-mono text-[0.65rem]">
              {currentModel} · v{currentVersion}
            </span>
          </p>
          <div className="mt-3 flex flex-wrap gap-3 text-xs">
            <StatChip label="Total" value={total} tone="muted" />
            <StatChip label="Current" value={current} tone="accent" />
            <StatChip label="Stale" value={stale} tone="amber" />
            <StatChip label="Missing" value={missing} tone="muted" />
          </div>
          {message && (
            <p className="mt-3 text-xs text-[var(--ink-muted)]">{message}</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          {allCovered && (
            <span className="text-xs text-[var(--ink-muted)]">
              All videos embedded.
            </span>
          )}
          {missing > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void runBackfill('missing')}
              disabled={running}
            >
              {running ? 'Embedding…' : `Backfill ${missing} missing`}
            </Button>
          )}
          {stale > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void runBackfill('stale')}
              disabled={running}
            >
              {running ? 'Embedding…' : `Reindex ${stale} stale`}
            </Button>
          )}
          {missing > 0 && stale > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void runBackfill('all')}
              disabled={running}
            >
              {running ? 'Embedding…' : `Reindex all ${missing + stale}`}
            </Button>
          )}
          {/* Force reindex — bypasses the staleness gate. Useful when you
              want to regenerate every vector regardless of stored status
              (e.g. you suspect the stored data is wrong even though it's
              labeled current). */}
          {total > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void runBackfill('all', true)}
              disabled={running}
              className="text-[var(--ink-muted)]"
            >
              {running ? 'Embedding…' : `Force reindex all ${total}`}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

function PassageEmbeddingPanel() {
  const router = useRouter();
  const [coverage, setCoverage] = useState<PassageCoverage | null>(null);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    const res = await getPassageCoverage();
    setCoverage(res);
  };

  useEffect(() => {
    void load();
  }, []);

  const runBackfill = async (
    scope: 'missing' | 'stale' | 'all',
    force = false,
  ) => {
    if (running) return;
    setRunning(true);
    setMessage(null);
    try {
      const res = await reindexAllPassages({ data: { scope, force } });
      if (res.status === 'ok') {
        setMessage(
          `Indexed ${res.succeeded}/${res.targeted} videos · ${res.totalChunks} passages${res.failed ? ` · ${res.failed} failed` : ''} · ${(res.tookMs / 1000).toFixed(1)}s`,
        );
      }
      await load();
      await router.invalidate();
    } finally {
      setRunning(false);
    }
  };

  if (!coverage) {
    return (
      <section className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5 text-xs text-[var(--ink-muted)]">
        Loading passage coverage…
      </section>
    );
  }

  const { total, current, stale, missing, currentModel, currentVersion } = coverage;
  const allCovered = total > 0 && stale === 0 && missing === 0;

  return (
    <section className="rounded-2xl border border-[var(--line)] bg-[var(--card)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[var(--ink)]">
            Passage embeddings (Tier 2)
          </h3>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">
            Fine-grained ~60-second chunks of each transcript, each embedded
            separately. Powers moment search at <span className="font-mono">/search</span>.
            Heavier to index (N chunks × Ollama) — expect a few seconds per
            video during backfill. Model:{' '}
            <span className="font-mono text-[0.65rem]">
              {currentModel} · v{currentVersion}
            </span>
          </p>
          <div className="mt-3 flex flex-wrap gap-3 text-xs">
            <StatChip label="Total" value={total} tone="muted" />
            <StatChip label="Current" value={current} tone="accent" />
            <StatChip label="Stale" value={stale} tone="amber" />
            <StatChip label="Missing" value={missing} tone="muted" />
          </div>
          {message && (
            <p className="mt-3 text-xs text-[var(--ink-muted)]">{message}</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
          {allCovered && (
            <span className="text-xs text-[var(--ink-muted)]">
              All videos indexed.
            </span>
          )}
          {missing > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void runBackfill('missing')}
              disabled={running}
            >
              {running ? 'Indexing…' : `Backfill ${missing} missing`}
            </Button>
          )}
          {stale > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void runBackfill('stale')}
              disabled={running}
            >
              {running ? 'Indexing…' : `Reindex ${stale} stale`}
            </Button>
          )}
          {missing > 0 && stale > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void runBackfill('all')}
              disabled={running}
            >
              {running ? 'Indexing…' : `Reindex all ${missing + stale}`}
            </Button>
          )}
          {total > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void runBackfill('all', true)}
              disabled={running}
              className="text-[var(--ink-muted)]"
            >
              {running ? 'Indexing…' : `Force reindex all ${total}`}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

function StatChip({
  label,
  value,
  tone,
}: Readonly<{
  label: string;
  value: number;
  tone: 'muted' | 'accent' | 'amber';
}>) {
  const toneClass =
    tone === 'accent'
      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
      : tone === 'amber'
        ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400'
        : 'border-[var(--line)] bg-[var(--bg-subtle)] text-[var(--ink-muted)]';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-medium ${toneClass}`}
    >
      <span className="tabular-nums">{value}</span>
      <span className="opacity-80">{label}</span>
    </span>
  );
}
