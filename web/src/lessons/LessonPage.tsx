// Dispatches a lesson slug to its page component.
//
// Lessons are static modules rather than routes (this app has no router),
// so the slug map lives here and doubles as the 404 guard.

import { Link } from '../components/Link';
import MusicTheoryFundamentals from './music-theory-fundamentals';
import ScaleSystemsOnTheNeck from './scale-systems-on-the-neck';
import CagedAndRomanNumerals from './caged-and-roman-numerals';
import FindAnyChord from './find-any-chord';
import EssentialChords from './essential-chords';
import HalfStepsToChords from './half-steps-to-chords';
import Triads from './triads';
import PowerChords from './power-chords';

const PAGES: Record<string, () => React.ReactElement> = {
  'music-theory-fundamentals': MusicTheoryFundamentals,
  'scale-systems-on-the-neck': ScaleSystemsOnTheNeck,
  'caged-and-roman-numerals': CagedAndRomanNumerals,
  'find-any-chord': FindAnyChord,
  'essential-chords': EssentialChords,
  'half-steps-to-chords': HalfStepsToChords,
  triads: Triads,
  'power-chords': PowerChords,
};

export function LessonPage({ slug }: { slug: string }) {
  const Page = PAGES[slug];
  if (!Page) {
    return (
      <main className="mx-auto w-full px-4 py-12 sm:px-8">
        <h1 className="text-2xl font-bold text-[var(--ink)]">Lesson not found</h1>
        <p className="mt-2 text-sm text-[var(--ink-soft)]">
          No lesson named <code>{slug}</code>.
        </p>
        <Link
          to="/lessons"
          className="mt-4 inline-block text-sm font-medium text-[var(--accent)]"
        >
          ← All lessons
        </Link>
      </main>
    );
  }
  return (
    <>
      <div className="mx-auto w-full px-4 pt-6 sm:px-8 xl:px-12">
        <Link to="/lessons" className="text-sm text-[var(--ink-muted)] no-underline">
          ← All lessons
        </Link>
      </div>
      <Page />
    </>
  );
}
