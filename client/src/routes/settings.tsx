import { createFileRoute } from '@tanstack/react-router';
import { ContentSignalsPanel } from '#/components/ContentSignalsPanel';
import { EmbeddingCoveragePanel } from '#/components/EmbeddingCoveragePanel';

// App-level settings + infrastructure panels. Currently just embeddings;
// future homes for MCP config, data export, API tokens, prefs.
export const Route = createFileRoute('/settings')({
  component: SettingsPage,
  head: () => ({ meta: [{ title: 'Settings · YT Knowledge Base' }] }),
});

function SettingsPage() {
  return (
    <main className="px-6 pb-28 pt-10 sm:px-10 sm:pt-14 lg:px-14">
      <header className="mb-8">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--card)] px-3 py-1 text-xs font-medium text-[var(--ink-muted)]">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
          Settings
        </span>
      </header>

      <div className="grid gap-4">
        <ContentSignalsPanel />
        <EmbeddingCoveragePanel />
      </div>
    </main>
  );
}
