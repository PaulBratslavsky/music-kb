// One-off: recompute `duration` for the two lesson-ux test-case lessons
// using the same logic as computeLessonDuration in lessons.ts, and PATCH
// the already-saved rows in the running Strapi so the before/after
// screenshots (and any future demo) show real numbers, not the stale
// model guess. This calls Strapi's own public REST API — no server/ code
// touched.
const base = 'http://localhost:1350';

const READING_WORDS_PER_MINUTE = 200;
const SECONDS_PER_VISUAL_BLOCK = 12;
const VISUAL_BLOCK_COMPONENTS = new Set([
  'lesson.diagram', 'lesson.keyboard-diagram', 'lesson.chord-diagram',
  'lesson.neck-pattern', 'lesson.natural-notes', 'lesson.table', 'lesson.degree-chips',
]);
function wordCount(t) { return typeof t === 'string' && t.trim() ? t.trim().split(/\s+/).length : 0; }
function computeLessonDuration(body) {
  if (body.length === 0) return null;
  let words = 0;
  for (const block of body) {
    switch (block.__component) {
      case 'lesson.prose':
      case 'lesson.callout':
        words += wordCount(block.body); break;
      case 'lesson.step':
        words += wordCount(block.lede) + wordCount(block.body); break;
      case 'lesson.heading':
        words += wordCount(block.text); break;
      default: break;
    }
  }
  const visualBlocks = body.filter((b) => VISUAL_BLOCK_COMPONENTS.has(b.__component)).length;
  const totalSeconds = (words / READING_WORDS_PER_MINUTE) * 60 + visualBlocks * SECONDS_PER_VISUAL_BLOCK;
  const minutes = Math.max(1, Math.round(totalSeconds / 60));
  return `${minutes} min`;
}

async function fetchLesson(slug) {
  const qs = new URLSearchParams();
  qs.set('filters[slug][$eq]', slug);
  qs.set('populate[body][populate]', '*');
  const res = await fetch(`${base}/api/lessons?${qs.toString()}`);
  const json = await res.json();
  return json.data[0];
}

const slugs = process.argv.slice(2);
for (const slug of slugs) {
  const lesson = await fetchLesson(slug);
  if (!lesson) { console.log(slug, '-> not found'); continue; }
  const computed = computeLessonDuration(lesson.body);
  console.log(slug, '| words-based duration:', computed, '| was:', lesson.duration, '| blocks:', lesson.body.length);
  const putRes = await fetch(`${base}/api/lessons/${lesson.documentId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { duration: computed } }),
  });
  console.log('  PUT status:', putRes.status);
}
