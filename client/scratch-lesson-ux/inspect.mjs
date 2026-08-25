const base = 'http://localhost:1350';
const slug = process.argv[2] ?? 'how-chords-come-from-scales';
const qs = new URLSearchParams();
qs.set('filters[slug][$eq]', slug);
qs.set('populate[body][populate]', '*');
const res = await fetch(`${base}/api/lessons?${qs.toString()}`);
const json = await res.json();
const lesson = json.data[0];
if (!lesson) { console.log('not found'); process.exit(1); }
const body = lesson.body;
console.log('title:', lesson.title, '| documentId:', lesson.documentId, '| stored duration:', lesson.duration);
console.log('total blocks:', body.length);
const withSource = body.filter((b) => b.source && b.source.videoId);
console.log('blocks with a source:', withSource.length);

// Mirror deriveCitationSuppression's logic (videoId + timeSec within 5s of the
// immediately preceding block) to compute expected rendered-citation count.
function key(b) {
  const s = b.source;
  if (!s || !s.videoId) return null;
  return { videoId: s.videoId, timeSec: typeof s.timeSec === 'number' ? s.timeSec : undefined };
}
function comparable(a, b) {
  if (!b || a.videoId !== b.videoId) return false;
  if (a.timeSec === undefined && b.timeSec === undefined) return true;
  if (a.timeSec === undefined || b.timeSec === undefined) return false;
  return Math.abs(a.timeSec - b.timeSec) <= 5;
}
let shown = 0;
let prev = null;
for (const b of body) {
  const k = key(b);
  if (k) {
    if (!comparable(k, prev)) shown += 1;
    prev = k;
  } else {
    prev = null; // matches deriveCitationSuppression: compares strictly to blocks[i-1]
  }
}
console.log('citations that WOULD render after suppression:', shown, 'out of', withSource.length);

// Longest run of consecutive blocks (by array position) sharing videoId+comparable timeSec.
let runs = [];
let runLen = 1;
for (let i = 1; i < body.length; i++) {
  const cur = key(body[i]);
  const prevK = key(body[i - 1]);
  if (cur && comparable(cur, prevK)) {
    runLen += 1;
  } else {
    if (runLen > 1) runs.push(runLen);
    runLen = 1;
  }
}
if (runLen > 1) runs.push(runLen);
console.log('runs of consecutive duplicate citations found:', runs.sort((a,b)=>b-a));
