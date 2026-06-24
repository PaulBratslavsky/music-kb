// /builder — standalone Chord/Scale builder page. Thin wrapper around the
// reusable <ChordBuilder/> (also embedded in the music-video "Chords" tab).
// The ?theory= deep-link seeds the initial selection (from /theory's Circle
// of Fifths / Substitutions). Progressions saved here are standalone (no
// video association).
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { ChordBuilder } from '#/components/ChordBuilder';

const BuilderSearchSchema = z.object({
  theory: z.string().max(64).optional(),
});

export const Route = createFileRoute('/builder')({
  validateSearch: BuilderSearchSchema,
  component: BuilderPage,
  head: () => ({ meta: [{ title: 'Chord & scale builder · Music KB' }] }),
});

function BuilderPage() {
  const search = Route.useSearch();
  return (
    <main className="page-wrap mx-auto max-w-5xl px-4 py-8 sm:px-8 sm:py-12">
      <ChordBuilder initialTheory={search.theory} showHeader />
    </main>
  );
}
