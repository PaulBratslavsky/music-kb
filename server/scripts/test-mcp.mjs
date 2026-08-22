#!/usr/bin/env node
// Integration test harness for the OFFICIAL Strapi MCP server at /mcp.
//
// Exercises real tools against a LIVE Strapi instance, so what we verify is
// real behavior (auth, route wiring, schema serialization, handler logic) —
// not unit-test mocks of the same.
//
// Usage:
//   export MCP_TEST_TOKEN=<a Strapi ADMIN API token — kind:'admin', see
//     docs/mcp.md's "Mint an admin token" recipe. A content-API "Full
//     access" token from Settings > API Tokens is rejected; it isn't
//     kind:'admin'. Mint via `strapi console` with the music-kb-mcp.read /
//     .write / .maintenance admin permissions for full coverage.>
//   export MCP_TEST_URL=http://localhost:1350/mcp   (default; NOT /api/mcp
//     — that hand-rolled endpoint was retired, see ADR 0008)
//   node server/scripts/test-mcp.mjs
//
// The official server is STATELESS (server.mcp / StreamableHTTPServerTransport
// is constructed with `sessionIdGenerator: undefined`, and Strapi's request
// handler builds a brand-new McpServer + transport for every single POST —
// see @strapi/core's handlePost.js). Concretely that means:
//   - No `Mcp-Session-Id` is ever returned, and none is required on
//     subsequent calls — every JSON-RPC call is a fully independent HTTP
//     request, authenticated by its own bearer token.
//   - A bare `tools/call` works with no prior `initialize` in the same
//     process at all (confirmed live). We still send `initialize` first
//     below because it's the spec-correct handshake and a cheap way to
//     assert server identity, not because the server requires it.
// This is a deliberate rewrite of the previous session-carrying logic here,
// which targeted the retired hand-rolled /api/mcp server (which DID mint and
// require a session id). Keeping that logic would have been silently
// harmless (the code degrades to "no session header sent" when none comes
// back) but it documented a protocol this server doesn't speak — exactly
// the kind of confident-looking-but-wrong harness this task exists to fix.
//
// Prints a per-tool PASS/FAIL line and exits non-zero on any failure so the
// script can wire into a CI gate later.

const URL = process.env.MCP_TEST_URL ?? 'http://localhost:1350/mcp';
const TOKEN = process.env.MCP_TEST_TOKEN;
if (!TOKEN) {
  console.error('MCP_TEST_TOKEN env var is required (a Strapi admin API token — see the usage comment above).');
  process.exit(2);
}

// ───────────────────────────────────────────────────────────────────────
// MCP wire helpers (minimal Streamable-HTTP client)
// ───────────────────────────────────────────────────────────────────────

async function rpc(method, params, id = 1) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${TOKEN}`,
  };

  const res = await fetch(URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status} on ${method}: ${body.slice(0, 300)}`);
  }

  // A bare notification (no "id"-bearing request in the body) gets a 202
  // with no body — nothing to parse.
  if (method === 'notifications/initialized') return null;

  const body = await res.text();
  // The transport responds with `event: message\ndata: <json>\n\n`. We only
  // care about the first `data:` line per response.
  const dataLine = body.split('\n').find((l) => l.startsWith('data: '));
  if (!dataLine) throw new Error(`no data line in SSE body:\n${body.slice(0, 200)}`);
  const msg = JSON.parse(dataLine.slice('data: '.length));
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

/** Like callTool, but expects tool-input validation to REJECT the call
 * (isError: true, thrown by the MCP SDK's own zod parse before execute()
 * ever runs — see server/src/mcp/tools/lesson-blocks.ts's header comment).
 * Returns the error message text so the caller can assert on its content. */
async function callToolExpectingRejection(name, args) {
  const result = await rpc('tools/call', { name, arguments: args }, 1);
  if (!result.isError) {
    throw new Error(`tool ${name} was expected to reject these args but succeeded: ${JSON.stringify(result)}`);
  }
  return result.content?.[0]?.text ?? '';
}

// ───────────────────────────────────────────────────────────────────────
// Test runner
// ───────────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];
// Loud, end-of-run reminder of any rows the harness created and could not
// delete (the public/admin token this harness uses is deliberately NOT
// granted a delete permission — see the "Clean up after yourself" note
// below and the brief this script was repaired against).
const leftoverRows = [];

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
  assert(r.serverInfo?.name === 'strapi-mcp-server', `wrong server name: ${r.serverInfo?.name}`);
  assert(r.capabilities?.tools !== undefined, 'tools capability missing');
  // NOT asserting a session id here: the official server is stateless
  // (sessionIdGenerator: undefined) and never returns one. See the file
  // header for why that's correct, not a regression.
});

await test('notifications/initialized', async () => {
  await rpc('notifications/initialized', undefined);
});

// 1. tools/list — the full domain catalog (server/src/mcp/catalog.ts) plus
// the built-in `log` tool. Asserted as an EXACT count for a full-power
// token (read + write + maintenance), not just "these names exist": a
// silently-skipped registration (see adapter.ts's per-tool try/catch —
// this exact failure mode took down a tool during this branch's own
// development, see task-6-report.md) would otherwise pass a subset check.
const DOMAIN_TOOLS = [
  // read
  'libraryStats', 'listVideos', 'searchVideos', 'getMusicData', 'getVideo',
  'getTranscript', 'searchTranscript', 'findTranscripts', 'crossSearchTranscripts',
  'listTranscripts', 'aggregateByTag', 'listUntagged', 'listTags', 'relatedVideos',
  'getReadableArticle', 'verifyCitations', 'listLessons', 'getLesson',
  // write
  'saveSummary', 'tagVideo', 'untagVideo', 'saveNote', 'createLesson', 'updateLesson',
  // maintenance
  'addVideo', 'fetchTranscript', 'reindexEmbeddings', 'generateDigest',
];
let toolNames = [];
await test(`tools/list returns exactly ${DOMAIN_TOOLS.length} domain tools + built-in log`, async () => {
  const r = await rpc('tools/list', {}, 2);
  assert(Array.isArray(r.tools), 'tools is not an array');
  toolNames = r.tools.map((t) => t.name);
  for (const name of DOMAIN_TOOLS) {
    assert(toolNames.includes(name), `tool ${name} missing from tools/list`);
  }
  assert(toolNames.includes('log'), 'built-in "log" tool missing from tools/list');
  const expectedCount = DOMAIN_TOOLS.length + 1;
  assert(
    toolNames.length === expectedCount,
    `expected exactly ${expectedCount} tools (this token's permissions determine the set — mint per docs/mcp.md's ` +
      `full-power recipe), got ${toolNames.length}: ${toolNames.join(', ')}`,
  );
  for (const t of r.tools) {
    assert(t.inputSchema?.type === 'object', `tool ${t.name} has no inputSchema.type`);
    if (['searchTranscript', 'searchVideos', 'getVideo', 'addVideo', 'createLesson'].includes(t.name)) {
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

// 3. searchVideos — tokenized search against whatever video is actually in
// this KB, not a hardcoded title from a different dataset (the previous
// "Harness Engineering" fixture doesn't exist in every seed — this is now
// self-fixturing off listVideos' first row like findTranscripts already was).
await test('searchVideos tokenizes queries and matches on title words', async () => {
  // searchVideos' matching is AND-strict across every non-stopword token
  // (see search-videos.ts's schema .describe()) — unlike findTranscripts
  // below, there's no loose fallback, so don't inject filler connector
  // words here; a word like "plus" isn't a recognized stopword and would
  // make the AND-match fail against a title that doesn't contain it.
  const tokens = (fixtureTitle || '').split(/\s+/).filter((w) => w.length > 3).slice(0, 2);
  assert(tokens.length > 0, 'fixture title too short to build a query from');
  const { parsed } = await callTool('searchVideos', { query: tokens.join(' ') });
  assert(parsed?.matchCount > 0, `matchCount=${parsed?.matchCount}, expected >0 for tokens [${tokens.join(', ')}]`);
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
  const tokens = (fixtureTitle || '').split(/\s+/).filter((w) => w.length > 3).slice(0, 2);
  if (tokens.length < 2) {
    tokens.push('transcript');
  }
  const { parsed } = await callTool('findTranscripts', { query: tokens.join(' plus ') });
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
  for (const s of parsed.segments) {
    assert(s.startMs < 60000, `segment at ${s.startMs}ms leaked past range`);
  }
});

// 7. searchTranscript — BM25 or substring fallback.
await test('searchTranscript returns ranked passages', async () => {
  const { parsed } = await callTool('searchTranscript', { videoId: fixtureVideoId, query: 'the', k: 3 });
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
  const { parsed: tagsResp } = await callTool('listTags', {});
  const populated = (tagsResp?.tags ?? []).find((t) => t.videoCount > 0);
  if (!populated) {
    console.log('      (no populated tags in KB; skipping aggregateByTag deep assertion)');
    return;
  }
  const { parsed } = await callTool('aggregateByTag', { tags: [populated.name], fields: 'summary' });
  assert(parsed?.videoCount > 0, `expected videos for tag ${populated.name}`);
});

await test('crossSearchTranscripts returns hits across videos', async () => {
  const { parsed } = await callTool('crossSearchTranscripts', { query: 'the', perVideo: 2, maxVideos: 5 });
  assert(typeof parsed?.videosScanned === 'number', 'videosScanned missing');
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

// ───────────────────────────────────────────────────────────────────────
// 11. Lesson tools — createLesson / updateLesson / listLessons / getLesson
// ───────────────────────────────────────────────────────────────────────
//
// Validation-rejection coverage always runs: the MCP SDK parses tool args
// against the zod `schema` BEFORE execute() ever runs (see lesson-blocks.ts's
// header comment), so every case below is rejected at the wire layer — no
// Strapi write is attempted, nothing to clean up.
//
// Row-creating coverage (create -> update -> disposal) only runs under
// RUN_WRITES=1, matching this file's existing convention for anything that
// writes real data (see saveSummary below). The public/admin token this
// harness authenticates with has NO delete permission on lessons BY DESIGN
// (see the brief this script was repaired against) and this harness must
// not add one. So instead of deleting, it overwrites the row it created
// with an unmistakably disposable title/summary/status and prints its
// documentId so a human can delete it via the Strapi admin.

await test('createLesson rejects an unknown __component (lesson.interactive was removed from the schema)', async () => {
  const text = await callToolExpectingRejection('createLesson', {
    title: 'zzz mcp harness validation probe',
    body: [{ __component: 'lesson.interactive', kind: 'triad-explorer' }],
  });
  assert(/Invalid discriminator value/i.test(text), `expected a discriminator rejection, got: ${text}`);
  assert(!/lesson\.interactive/.test(text.split('Expected')[1] ?? ''), `lesson.interactive still listed as legal: ${text}`);
});

await test('createLesson rejects an empty body', async () => {
  const text = await callToolExpectingRejection('createLesson', { title: 'zzz mcp harness validation probe', body: [] });
  assert(/at least one block/i.test(text), `expected the empty-body message, got: ${text}`);
});

await test('createLesson rejects a theory-mode diagram missing stringSet', async () => {
  const text = await callToolExpectingRejection('createLesson', {
    title: 'zzz mcp harness validation probe',
    body: [{ __component: 'lesson.diagram', mode: 'theory', root: 'C', quality: 'major' }],
  });
  assert(/stringSet is required/i.test(text), `expected a missing-stringSet message, got: ${text}`);
});

await test('createLesson rejects a hyphen where stringSet needs an EN DASH', async () => {
  const text = await callToolExpectingRejection('createLesson', {
    title: 'zzz mcp harness validation probe',
    body: [{ __component: 'lesson.diagram', mode: 'theory', root: 'C', quality: 'major', stringSet: 'e-B-G' }],
  });
  assert(/EN DASH/i.test(text) && /e–B–G/.test(text), `expected the hyphen-correction message, got: ${text}`);
});

await test('createLesson rejects an over-length caption', async () => {
  // lesson.degree-chips has no caption field at all — lesson.table does.
  const text = await callToolExpectingRejection('createLesson', {
    title: 'zzz mcp harness validation probe',
    body: [
      {
        __component: 'lesson.table',
        headers: ['a', 'b'],
        rows: [['1', '2']],
        caption: 'x'.repeat(300),
      },
    ],
  });
  assert(/255/.test(text), `expected the 255-char caption message, got: ${text}`);
});

await test('updateLesson rejects a call with nothing to update', async () => {
  const text = await callToolExpectingRejection('updateLesson', { documentId: 'irrelevant-for-this-check' });
  assert(/Nothing to update/i.test(text), `expected the nothing-to-update message, got: ${text}`);
});

await test('updateLesson on an unknown documentId returns an error field (not a throw)', async () => {
  const { parsed } = await callTool('updateLesson', { documentId: 'definitely-not-a-real-document-id', order: 1 });
  assert(parsed?.error, `expected an error field, got: ${JSON.stringify(parsed)}`);
});

await test('getLesson with an unknown slug returns an error field', async () => {
  const { parsed } = await callTool('getLesson', { slug: 'definitely-not-a-real-lesson-slug-zzz' });
  assert(parsed?.error, `expected an error field, got: ${JSON.stringify(parsed)}`);
});

await test('listLessons returns the paged catalog shape', async () => {
  const { parsed } = await callTool('listLessons', { pageSize: 5 });
  assert(typeof parsed?.total === 'number', 'total missing');
  assert(Array.isArray(parsed?.lessons), 'lessons missing');
});

if (process.env.RUN_WRITES === '1') {
  let createdDocumentId = null;
  let createdSlug = null;

  await test('createLesson creates a minimal valid lesson', async () => {
    const { parsed } = await callTool('createLesson', {
      title: `MCP harness test lesson ${new Date().toISOString()}`,
      body: [{ __component: 'lesson.prose', body: 'Written by server/scripts/test-mcp.mjs — safe to delete.' }],
    });
    assert(parsed?.lessonDocumentId, 'lessonDocumentId missing from createLesson result');
    assert(parsed?.status === 'ai-generated', `expected default status "ai-generated", got ${parsed?.status}`);
    createdDocumentId = parsed.lessonDocumentId;
    createdSlug = parsed.slug;
  });

  await test('updateLesson applies a partial update', async () => {
    const { parsed } = await callTool('updateLesson', { documentId: createdDocumentId, order: 999 });
    assert(parsed?.updatedFields?.includes('order'), `expected "order" in updatedFields, got: ${JSON.stringify(parsed)}`);
  });

  await test('getLesson returns the full body for the created lesson', async () => {
    const { parsed } = await callTool('getLesson', { slug: createdSlug });
    assert(Array.isArray(parsed?.body) && parsed.body.length === 1, 'expected a 1-block body');
    assert(parsed.body[0].__component === 'lesson.prose', 'expected the prose block back');
  });

  await test('disposal: mark the created lesson unmistakably disposable (no delete permission by design)', async () => {
    const { parsed } = await callTool('updateLesson', {
      documentId: createdDocumentId,
      title: `[DISPOSABLE — delete me] MCP harness test lesson (${createdDocumentId})`,
      summary:
        'Created by server/scripts/test-mcp.mjs. The MCP token this harness uses has no delete permission on ' +
        'lessons BY DESIGN — please delete this row manually via the Strapi admin.',
      status: 'draft',
    });
    assert(parsed?.updatedFields?.length === 3, `expected title/summary/status updated, got: ${JSON.stringify(parsed)}`);
    leftoverRows.push({ type: 'lesson', documentId: createdDocumentId, slug: createdSlug });
  });
} else {
  console.log(
    '  \x1b[33m-\x1b[0m createLesson/updateLesson row-creating coverage (skipped — set RUN_WRITES=1 to run; ' +
      'it creates one lesson row and marks it disposable afterward, since this token has no delete permission)',
  );
}

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
      watchVerdict: 'skim',
      verdictSummary: 'Worth it if you care about testing this harness. Skip if you already trust it.',
      verdictReason: 'This is a synthetic summary written by server/scripts/test-mcp.mjs to exercise saveSummary. Delete before deploying.',
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
}
if (leftoverRows.length > 0) {
  console.log('\n\x1b[33m⚠ Rows left behind (this token has no delete permission on lessons BY DESIGN):\x1b[0m');
  for (const row of leftoverRows) {
    console.log(`  ${row.type} documentId=${row.documentId} slug=${row.slug} — delete manually via the Strapi admin.`);
  }
}
if (failed > 0) {
  process.exit(1);
}
