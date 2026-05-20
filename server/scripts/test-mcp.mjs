#!/usr/bin/env node
// Integration test harness for the /api/mcp endpoint.
//
// Exercises every registered tool against the LIVE Strapi instance, so
// what we verify is real behavior (auth, route wiring, schema
// serialization, handler logic) — not unit-test mocks of the same.
//
// Usage:
//   export MCP_TEST_TOKEN=<your-strapi-api-token>
//   export MCP_TEST_URL=http://localhost:1350/api/mcp   (default)
//   node server/scripts/test-mcp.mjs
//
// Prints a per-tool PASS/FAIL line and exits non-zero on any failure so
// the script can wire into a CI gate later.

const URL = process.env.MCP_TEST_URL ?? 'http://localhost:1350/api/mcp';
const TOKEN = process.env.MCP_TEST_TOKEN;
if (!TOKEN) {
  console.error('MCP_TEST_TOKEN env var is required.');
  process.exit(2);
}

// ───────────────────────────────────────────────────────────────────────
// MCP wire helpers (minimal Streamable-HTTP client)
// ───────────────────────────────────────────────────────────────────────

let sessionId = null;

function parseSSE(body) {
  // The transport responds with `event: message\ndata: <json>\n\n`. We
  // only care about the first `data:` line per response.
  const dataLine = body.split('\n').find((l) => l.startsWith('data: '));
  if (!dataLine) throw new Error(`no data line in SSE body:\n${body.slice(0, 200)}`);
  return JSON.parse(dataLine.slice('data: '.length));
}

async function rpc(method, params, id = 1) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${TOKEN}`,
  };
  if (sessionId) headers['mcp-session-id'] = sessionId;

  const res = await fetch(URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });

  const returnedSession = res.headers.get('mcp-session-id');
  if (returnedSession && !sessionId) sessionId = returnedSession;

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status} on ${method}: ${body.slice(0, 300)}`);
  }

  if (method === 'notifications/initialized') return null;
  const body = await res.text();
  const msg = parseSSE(body);
  if (msg.error) {
    throw new Error(`RPC error on ${method}: ${JSON.stringify(msg.error)}`);
  }
  return msg.result;
}

async function callTool(name, args) {
  const result = await rpc('tools/call', { name, arguments: args }, 1);
  if (result.isError) {
    const text = result.content?.[0]?.text ?? 'unknown tool error';
    throw new Error(`tool ${name} returned isError: ${text}`);
  }
  // Our tools always return a text block with JSON; decode.
  const text = result.content?.[0]?.text ?? '';
  try {
    return { raw: text, parsed: JSON.parse(text) };
  } catch {
    return { raw: text, parsed: null };
  }
}

// ───────────────────────────────────────────────────────────────────────
// Test runner
// ───────────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  const started = Date.now();
  try {
    await fn();
    const ms = Date.now() - started;
    console.log(`  \x1b[32m✓\x1b[0m ${name} (${ms}ms)`);
    passed++;
  } catch (err) {
    const ms = Date.now() - started;
    console.log(`  \x1b[31m✗\x1b[0m ${name} (${ms}ms)`);
    console.log(`      ${err.message}`);
    failed++;
    failures.push({ name, error: err.message });
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// ───────────────────────────────────────────────────────────────────────
// Tests
// ───────────────────────────────────────────────────────────────────────

console.log(`\nMCP integration test — ${URL}\n`);

// 0. Handshake
await test('initialize handshake', async () => {
  const r = await rpc('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test-mcp', version: '1.0' },
  });
  assert(r.serverInfo?.name === 'yt-knowledge-base', `wrong server name: ${r.serverInfo?.name}`);
  assert(r.capabilities?.tools !== undefined, 'tools capability missing');
  assert(sessionId, 'no session id returned');
});

await test('notifications/initialized', async () => {
  await rpc('notifications/initialized', undefined);
});

// 1. tools/list
let toolNames = [];
await test('tools/list returns 18 tools with valid schemas', async () => {
  const r = await rpc('tools/list', {}, 2);
  assert(Array.isArray(r.tools), 'tools is not an array');
  toolNames = r.tools.map((t) => t.name);
  const expected = [
    'listTranscripts', 'getTranscript', 'searchTranscript', 'findTranscripts', 'fetchTranscript',
    'listVideos', 'getVideo', 'searchVideos', 'addVideo', 'saveSummary',
    'listTags', 'tagVideo', 'untagVideo', 'saveNote',
    'aggregateByTag', 'listUntagged', 'crossSearchTranscripts', 'libraryStats',
  ];
  for (const name of expected) {
    assert(toolNames.includes(name), `tool ${name} missing from tools/list`);
  }
  for (const t of r.tools) {
    assert(t.inputSchema?.type === 'object', `tool ${t.name} has no inputSchema.type`);
    // listTranscripts has zero required fields (all defaulted); that's OK.
    // Just assert `properties` is defined where we expect params.
    if (['searchTranscript', 'searchVideos', 'getVideo', 'addVideo'].includes(t.name)) {
      assert(t.inputSchema?.properties, `tool ${t.name} missing properties`);
    }
  }
});

// Discover a real videoId to use as a fixture for the read tools.
let fixtureVideoId = null;
let fixtureTitle = null;
await test('listVideos returns real rows', async () => {
  const { parsed } = await callTool('listVideos', { pageSize: 5 });
  assert(parsed?.videos?.length > 0, 'no videos returned — seed the DB first');
  fixtureVideoId = parsed.videos[0].youtubeVideoId;
  fixtureTitle = parsed.videos[0].videoTitle;
  assert(fixtureVideoId, 'first video has no youtubeVideoId');
});

// 2. listTranscripts
await test('listTranscripts', async () => {
  const { parsed } = await callTool('listTranscripts', { pageSize: 5 });
  assert(parsed?.transcripts?.length > 0, 'no transcripts in KB');
});

// 3. searchVideos — exact partial title (the real-world "Rethinking" regression).
await test('searchVideos tokenizes queries with filler words', async () => {
  const { parsed } = await callTool('searchVideos', { query: 'Harness Engineering' });
  assert(parsed?.matchCount > 0, `matchCount=${parsed?.matchCount}, expected >0`);
  const titles = parsed.videos.map((v) => v.videoTitle).join(' | ');
  assert(/harness/i.test(titles), `no 'harness' in returned titles: ${titles}`);
});

await test('searchVideos returns empty for clearly absent query (not a false positive)', async () => {
  const { parsed } = await callTool('searchVideos', { query: 'definitely not a real video title zxcvbnm' });
  assert(parsed?.matchCount === 0, `expected 0 matches, got ${parsed?.matchCount}`);
  assert(parsed?.hint, 'empty-result response should include a hint steering toward listVideos/addVideo');
});

await test('searchVideos by youtubeVideoId substring', async () => {
  // Use first 5 chars of the fixture video id so it's substring, not equality.
  const partial = fixtureVideoId.slice(0, 5);
  const { parsed } = await callTool('searchVideos', { query: partial });
  assert(parsed?.matchCount > 0, `expected ${partial} to match ${fixtureVideoId}`);
});

// 4. findTranscripts — same tokenization assertion against transcript title.
await test('findTranscripts tokenizes and finds relevant rows', async () => {
  // Use a couple of tokens from the fixture title, separated by filler.
  const tokens = (fixtureTitle || '').split(/\s+/).filter((w) => w.length > 3).slice(0, 2);
  if (tokens.length < 2) {
    // Fallback query if the fixture title is too short.
    tokens.push('transcript');
  }
  const { parsed } = await callTool('findTranscripts', { query: tokens.join(' plus ') });
  // loose-mode fallback should find something since at least one token matches.
  assert(parsed?.matchCount > 0 || parsed?.hint, 'expected matches or a hint');
});

// 5. getVideo
await test('getVideo by youtubeVideoId', async () => {
  const { parsed } = await callTool('getVideo', { videoId: fixtureVideoId });
  assert(parsed?.youtubeVideoId === fixtureVideoId, 'returned row youtubeVideoId mismatch');
  assert(!('transcriptSegments' in parsed), 'transcriptSegments should be stripped from getVideo response');
});

await test('getVideo with unknown id returns error field', async () => {
  const { parsed } = await callTool('getVideo', { videoId: 'does_not_exist_aaaa' });
  assert(parsed?.error, 'expected error field for unknown video');
});

// 6. getTranscript
await test('getTranscript full mode', async () => {
  const { parsed } = await callTool('getTranscript', { videoId: fixtureVideoId, mode: 'full' });
  assert(typeof parsed?.transcript === 'string' && parsed.transcript.length > 50, 'transcript missing or tiny');
});

await test('getTranscript chunked mode', async () => {
  const { parsed } = await callTool('getTranscript', { videoId: fixtureVideoId, mode: 'chunked' });
  assert(Array.isArray(parsed?.segments), 'segments missing or not array');
});

await test('getTranscript timeRange mode', async () => {
  const { parsed } = await callTool('getTranscript', { videoId: fixtureVideoId, mode: 'timeRange', startSec: 0, endSec: 60 });
  assert(Array.isArray(parsed?.segments), 'segments missing');
  // Time-range segments should all have startMs < 60000.
  for (const s of parsed.segments) {
    assert(s.startMs < 60000, `segment at ${s.startMs}ms leaked past range`);
  }
});

// 7. searchTranscript — BM25 or substring fallback.
await test('searchTranscript returns ranked passages', async () => {
  const { parsed } = await callTool('searchTranscript', { videoId: fixtureVideoId, query: 'the', k: 3 });
  // Even a weak query should return something for a multi-minute video.
  assert(parsed?.results !== undefined, 'results field missing');
  assert(['bm25', 'substring'].includes(parsed?.source), `unexpected source: ${parsed?.source}`);
});

// 8. listTags
await test('listTags', async () => {
  const { parsed } = await callTool('listTags', {});
  assert(Array.isArray(parsed?.tags), 'tags field missing');
});

// 9. tagVideo + untagVideo
await test('tagVideo adds a tag', async () => {
  const { parsed } = await callTool('tagVideo', {
    videoId: fixtureVideoId,
    tags: ['mcp-test-tag'],
  });
  assert(parsed?.totalTags >= 1, `totalTags=${parsed?.totalTags}`);
});

await test('untagVideo removes the tag we just added', async () => {
  const { parsed } = await callTool('untagVideo', {
    videoId: fixtureVideoId,
    tags: ['mcp-test-tag'],
  });
  assert(parsed?.removed?.includes('mcp-test-tag'), 'tag not reported as removed');
});

// 10a. aggregators
await test('libraryStats returns counts + top tags + monthly buckets', async () => {
  const { parsed } = await callTool('libraryStats', {});
  assert(parsed?.totals?.videos > 0, 'totals.videos missing or zero');
  assert(Array.isArray(parsed?.topTags), 'topTags missing');
  assert(Array.isArray(parsed?.monthlyIngestion), 'monthlyIngestion missing');
});

await test('listUntagged returns rows (may be empty — accepts either)', async () => {
  const { parsed } = await callTool('listUntagged', { limit: 5 });
  assert(typeof parsed?.untaggedCount === 'number', 'untaggedCount missing');
});

await test('aggregateByTag with known tag returns videos', async () => {
  // Pull any populated tag so the test doesn't hard-code a specific one.
  const { parsed: tagsResp } = await callTool('listTags', {});
  const populated = (tagsResp?.tags ?? []).find((t) => t.videoCount > 0);
  if (!populated) {
    // Edge case: no tags in the KB yet. Treat as pass since `listUntagged` will be the workflow instead.
    console.log('      (no populated tags in KB; skipping aggregateByTag deep assertion)');
    return;
  }
  const { parsed } = await callTool('aggregateByTag', { tags: [populated.name], fields: 'summary' });
  assert(parsed?.videoCount > 0, `expected videos for tag ${populated.name}`);
});

await test('crossSearchTranscripts returns hits across videos', async () => {
  const { parsed } = await callTool('crossSearchTranscripts', { query: 'the', perVideo: 2, maxVideos: 5 });
  assert(typeof parsed?.videosScanned === 'number', 'videosScanned missing');
  // Hits expected since 'the' appears in basically every transcript.
  assert(parsed?.videosWithHits >= 1 || parsed?.hint, 'expected hits or hint');
});

// 10b. saveNote
await test('saveNote attaches a note', async () => {
  const { parsed } = await callTool('saveNote', {
    videoId: fixtureVideoId,
    body: `MCP harness test note @ ${new Date().toISOString()}`,
    author: 'mcp-test',
  });
  assert(parsed?.noteDocumentId, 'noteDocumentId missing');
});

// 11. fetchTranscript — SKIPPED by default since it hits YouTube (slow + network).
// Enable with SKIP_NETWORK=0 to exercise it against the fixture video.
if (process.env.SKIP_NETWORK === '0') {
  await test('fetchTranscript (idempotent, force=false skips existing)', async () => {
    const { parsed } = await callTool('fetchTranscript', { videoId: fixtureVideoId, force: false });
    assert(parsed?.action === 'skipped', `expected "skipped", got ${parsed?.action}`);
  });
} else {
  console.log('  \x1b[33m-\x1b[0m fetchTranscript (skipped — set SKIP_NETWORK=0 to run)');
}

// 12. addVideo — same reason, skipped unless explicitly enabled (would hit YouTube
// and write to the DB).
if (process.env.SKIP_NETWORK === '0') {
  await test('addVideo returns "exists" for an already-ingested video (no write)', async () => {
    const url = `https://www.youtube.com/watch?v=${fixtureVideoId}`;
    const { parsed } = await callTool('addVideo', { url });
    assert(parsed?.action === 'exists', `expected "exists", got ${parsed?.action}`);
  });
} else {
  console.log('  \x1b[33m-\x1b[0m addVideo (skipped — set SKIP_NETWORK=0 to run)');
}

// 13. saveSummary — writes real data; SKIP by default to avoid touching the
// user's summary while they're using the app. Enable with RUN_WRITES=1.
if (process.env.RUN_WRITES === '1') {
  await test('saveSummary writes to existing Video', async () => {
    const { parsed } = await callTool('saveSummary', {
      videoId: fixtureVideoId,
      summaryTitle: 'MCP harness test summary — DELETE ME',
      summaryDescription: 'Written by the MCP test harness. Delete before deploying.',
      summaryOverview: 'Test overview.',
      keyTakeaways: [{ text: 'Test takeaway.' }],
      sections: [{ heading: 'Test', body: 'Test body.' }],
      actionSteps: [{ title: 'Remove test data', body: 'Delete this row.' }],
    });
    assert(parsed?.summaryStatus === 'generated', `unexpected status: ${parsed?.summaryStatus}`);
  });
} else {
  console.log('  \x1b[33m-\x1b[0m saveSummary (skipped — set RUN_WRITES=1 to run; it will overwrite real summary data)');
}

// ───────────────────────────────────────────────────────────────────────
// Report
// ───────────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) {
    console.log(`  ${f.name}: ${f.error}`);
  }
  process.exit(1);
}
