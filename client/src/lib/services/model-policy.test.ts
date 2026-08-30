// THE LOCAL-FIRST PIN, part 1 of 2: real adapters + structural guards.
//
// CLAUDE.md's local-first rule ("Local-first, with exactly one documented
// exception", decided 2026-08-21) says lesson generation MAY use a hosted
// model and that the exception must not be widened to chat, summaries,
// embeddings or extraction without the same kind of evidence. This file and
// its sibling `model-policy.tiers.test.ts` are that rule, mechanised. If
// either goes red, someone either widened the exception or re-pointed a
// surface at a different model — both need a human decision, not a green
// build.
//
// WHY TWO FILES: `vi.mock` is hoisted and applies to the whole module graph,
// so a file that mocks `@tanstack/ai-ollama` can never also assert on a real
// adapter. This file therefore mocks NOTHING. Neither adapter constructor
// does any I/O (verified: both construct clean in a bare Node process with
// no Ollama running), so there is nothing here that needs mocking anyway.
// The env-varying / constructor-spying half lives in the sibling.
//
// The assertions below are deliberately about the ADAPTER — `.name`,
// `.constructor.name`, `.model` — not about the `tier` string the resolved
// object supplies about itself. A label is what a broken implementation
// would still get right.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  LOCAL_SURFACES,
  modelIdFor,
  resolveModel,
  type LocalSurface,
} from './model-policy';
import {
  OLLAMA_CHAT_MODEL,
  OLLAMA_MODEL,
  OLLAMA_SYNTHESIS_MODEL,
} from '#/lib/env';

// Independently hardcoded. NOT derived from modelIdFor — an expectation
// derived from the thing under test proves nothing.
const EXPECTED_MODEL: Record<LocalSurface, string> = {
  summary: OLLAMA_MODEL,
  'music-extraction': OLLAMA_MODEL,
  reader: OLLAMA_MODEL,
  'note-summarize': OLLAMA_MODEL,
  'digest-synthesis': OLLAMA_MODEL,
  'digest-article': OLLAMA_MODEL,
  'video-chat': OLLAMA_CHAT_MODEL,
  'query-rewrite': OLLAMA_CHAT_MODEL,
  'digest-chat': OLLAMA_CHAT_MODEL,
  'library-ask': OLLAMA_SYNTHESIS_MODEL,
  'note-compose': OLLAMA_SYNTHESIS_MODEL,
};

describe('local-first policy — every surface but lesson resolves a real Ollama adapter', () => {
  it('LOCAL_SURFACES is exactly these 11 keys', () => {
    // A new surface fails this until someone declares it here — the point
    // being that the surface table has to be the COMPLETE inventory of
    // adapter bindings, or "every surface stays local" is not a claim this
    // suite can make.
    expect([...LOCAL_SURFACES].sort()).toEqual([
      'digest-article',
      'digest-chat',
      'digest-synthesis',
      'library-ask',
      'music-extraction',
      'note-compose',
      'note-summarize',
      'query-rewrite',
      'reader',
      'summary',
      'video-chat',
    ]);
  });

  it.each([...LOCAL_SURFACES])(
    'resolveModel(%s) returns a REAL OllamaTextAdapter, not just a "local" label',
    (surface) => {
      const m = resolveModel(surface);

      // The two adapters' own-key sets are IDENTICAL (kind, model, requires,
      // config, name, client), so a structural duck-type check would not
      // distinguish them. `.name` and `.constructor.name` are the
      // discriminators that actually work.
      expect(m.adapter.name).toBe('ollama');
      expect(m.adapter.constructor.name).toBe('OllamaTextAdapter');
      expect(m.adapter.constructor.name).not.toBe('AnthropicTextAdapter');
      expect(m.tier).toBe('local');
    },
  );

  it.each([...LOCAL_SURFACES])(
    'resolveModel(%s) binds the ADAPTER to this surface\'s env constant',
    (surface) => {
      const m = resolveModel(surface);
      // `.model` read off the adapter itself, not off the label beside it.
      expect((m.adapter as unknown as { model: string }).model).toBe(EXPECTED_MODEL[surface]);
      expect(m.model).toBe(EXPECTED_MODEL[surface]);
      // modelIdFor is documented as "the model id without constructing an
      // adapter" and is what every persisted provenance stamp and staleness
      // key uses. If it disagrees with resolveModel, those are all wrong.
      expect(modelIdFor(surface)).toBe(EXPECTED_MODEL[surface]);
    },
  );

  it('a local model carries Ollama-shaped sampling and the ECHOING error mapper', () => {
    const m = resolveModel('summary');
    expect(m.modelOptions(0.3)).toEqual({ model: m.model, options: { temperature: 0.3 } });
    // friendlyOllamaError echoes unmatched input — safe, because Ollama is
    // localhost. This is the half of the tier pairing that must NOT be the
    // Anthropic one; the sibling file asserts the frontier half.
    expect(m.friendlyError('some totally unrecognised local blurb')).toBe(
      'some totally unrecognised local blurb',
    );
    expect(m.friendlyError('fetch failed')).toContain('Ollama');
    // No-op locally; it exists so digest.ts's frontier-inherited path has
    // something to call before logging.
    expect(m.redact('sk-ant-anything')).toBe('sk-ant-anything');
  });

  it('does not memoize — each resolution builds its own adapter', () => {
    // Memoizing would reintroduce exactly the process-lifetime binding this
    // module exists to remove, and would hold Ollama.ongoingStreamedRequests
    // entries for the life of the process on any stream that ends by throw.
    const a = resolveModel('summary');
    const b = resolveModel('summary');
    expect(a.adapter).not.toBe(b.adapter);
    expect(a.model).toBe(b.model);
  });
});

// ---------------------------------------------------------------------------
// Structural guards — what stops this refactor rotting back.
//
// These exclude `*.test.ts(x)`. A `vi.mock('@tanstack/ai-ollama', …)`
// factory is not a binding site — it is the opposite, an interception. The
// exemption is narrow ON PURPOSE and must not be widened to anything that
// actually runs in production.
// ---------------------------------------------------------------------------

const SRC_ROOT = new URL('../../', import.meta.url).pathname; // → client/src/

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * A mention inside a comment is not a binding site. Strip comments before
 * scanning, so prose explaining WHY a rule exists cannot trip the rule.
 *
 * ORDER IS LOAD-BEARING: line comments FIRST, then block comments. Doing it
 * the other way round is how the first draft of this file silently passed a
 * mutation test. `learning.ts:306` carries the line comment
 *
 *     //   /*.json:   takeaway.text 280, section.heading 200,
 *
 * whose `/*` opens a block comment as far as the block regex is concerned,
 * and the non-greedy match then ran to the next `*\/` — 15,529 characters
 * later, swallowing a third of the file including several call sites the
 * scans below are supposed to police. The 'stripComments removes comments
 * WITHOUT eating code' test below is the regression test for exactly that.
 *
 * The `[^:]` guard on the line regex keeps `https://…` inside a comment or
 * string from truncating its line.
 */
function stripComments(src: string): string {
  return src.replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/\/\*[\s\S]*?\*\//g, '');
}

const PROD_FILES = walk(SRC_ROOT).filter((f) => !/\.test\.tsx?$/.test(f));
const rel = (f: string) => f.slice(SRC_ROOT.length);
const bodyOf = (f: string) => stripComments(readFileSync(f, 'utf8'));

describe('structural guards', () => {
  it('stripComments removes comments WITHOUT eating code (guard on the guard)', () => {
    // Every scan below is only as good as the stripper. When it over-deletes
    // it does so silently and the scan passes vacuously — which is precisely
    // what happened during this refactor's own mutation test. These three
    // tokens sit in the three files the scans actually depend on, each of
    // them downstream of a comment.
    expect(bodyOf(join(SRC_ROOT, 'lib/services/learning.ts'))).toContain(
      "resolveModel('summary')",
    );
    expect(bodyOf(join(SRC_ROOT, 'lib/services/lesson-generation.ts'))).toContain(
      'resolveLessonModel()',
    );
    expect(bodyOf(join(SRC_ROOT, 'lib/services/model-policy.ts'))).toContain('createOllamaChat(');
    // And it does still strip: model-policy.ts's header prose names
    // createAnthropicChat, but only in comments and a type position.
    expect(bodyOf(join(SRC_ROOT, 'lib/services/model-policy.ts'))).not.toContain(
      'NOT memoized, deliberately',
    );
  });

  it('the file walk found production sources (guard on the guard)', () => {
    // If walk() silently returned [] every assertion below would pass
    // vacuously — the classic way a source-text pin dies unnoticed.
    expect(PROD_FILES.length).toBeGreaterThan(50);
    expect(PROD_FILES.map(rel)).toContain('lib/services/model-policy.ts');
    expect(PROD_FILES.map(rel)).toContain('lib/services/learning.ts');
  });

  it('only model-policy.ts CALLS createOllamaChat', () => {
    const callers = PROD_FILES.filter((f) => /\bcreateOllamaChat\s*\(/.test(bodyOf(f))).map(rel);
    expect(callers).toEqual(['lib/services/model-policy.ts']);
  });

  it('only frontier-model.ts CALLS createAnthropicChat', () => {
    // The local-first rule at its narrowest: exactly one module in the app
    // may construct a frontier client.
    const callers = PROD_FILES.filter((f) => /\bcreateAnthropicChat\s*\(/.test(bodyOf(f))).map(rel);
    expect(callers).toEqual(['lib/services/frontier-model.ts']);
  });

  it('only frontier-model.ts IMPORTS ANTHROPIC_API_KEY from env.ts', () => {
    // Matches the import, not the bare identifier: `anthropic-errors.ts`
    // names ANTHROPIC_API_KEY inside its canned user-facing hint strings
    // ("…or leave it unset to use the local model instead"), which is text,
    // not a read of the secret.
    const readers = PROD_FILES.filter((f) => {
      if (rel(f) === 'lib/env.ts') return false;
      const src = bodyOf(f);
      return [...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'#\/lib\/env'/g)].some((m) =>
        /\bANTHROPIC_API_KEY\b/.test(m[1]),
      );
    }).map(rel);
    expect(readers).toEqual(['lib/services/frontier-model.ts']);
  });

  it('model-policy.ts imports @tanstack/ai-anthropic TYPE-ONLY', () => {
    // verbatimModuleSyntax: true (client/tsconfig.json) erases `import
    // type`, so the eleven local surfaces never pull @anthropic-ai/sdk into
    // their import graph. A value import here would quietly undo that.
    const src = readFileSync(join(SRC_ROOT, 'lib/services/model-policy.ts'), 'utf8');
    expect(src).toMatch(/^import type .*'@tanstack\/ai-anthropic'/m);
    expect(src).not.toMatch(/^import\s+(?!type\b)[^;]*'@tanstack\/ai-anthropic'/m);
  });

  it('resolveLessonModel has exactly one importer: lesson-generation.ts', () => {
    // THE KEYSTONE. The type-level guard makes `resolveModel('lesson')` a
    // compile error, but it cannot stop
    //
    //   const m = ANTHROPIC_API_KEY ? resolveLessonModel() : resolveModel('summary');
    //
    // appearing in learning.ts — an edit that leaves every tier assertion in
    // this suite green (they iterate LOCAL_SURFACES) and every constructor
    // scan green (learning.ts would call neither constructor; it calls a
    // resolver), while summaries quietly run on Claude. This refactor even
    // makes that edit EASIER, because ResolvedModel is now the universal
    // currency every surface already consumes, so the shapes no longer
    // fight. This test is the thing that makes it impossible.
    const importers = PROD_FILES.filter((f) => /\bresolveLessonModel\b/.test(bodyOf(f)))
      .map(rel)
      .filter((f) => f !== 'lib/services/frontier-model.ts');
    expect(importers).toEqual(['lib/services/lesson-generation.ts']);
  });

  it('frontier-model.ts exports nothing that could alias the frontier resolver', () => {
    // The keystone above counts IMPORTERS of `resolveLessonModel`, which is
    // exactly the hole an adversarial audit walked through:
    //
    //   // inside frontier-model.ts — no new importer of resolveLessonModel
    //   export function resolvePreferredModel() { return resolveLessonModel(); }
    //
    // learning.ts then imports `resolvePreferredModel`, the importer list
    // still reads ['lesson-generation.ts'], every tier assertion stays green,
    // and summaries run on Claude. Pinning the module's whole export surface
    // is what closes it: a new export here is red until someone adds it to
    // this list on purpose, at which point the alias is a deliberate,
    // reviewed act rather than an accident.
    const src = readFileSync(join(SRC_ROOT, 'lib/services/frontier-model.ts'), 'utf8');
    const exported = [...src.matchAll(/^export\s+(?:async\s+)?(?:function|const|class|type|interface)\s+(\w+)/gm)]
      .map((m) => m[1])
      .sort();
    //
    // Amended 2026-08-27 (ADR 0011). `resolveChatModel` is a SECOND deliberate
    // frontier entry point, for the interactive surfaces. It is pinned by its
    // own importer test below, exactly as resolveLessonModel is — the pattern
    // is "every export that can RETURN a frontier model has a pinned importer
    // list", not "there is only one such export".
    //
    // The other three additions cannot return a model at all:
    //   parseModelChoice   -> a parsed token, no adapter
    //   frontierAvailable  -> boolean
    //   ModelChoiceToken / ParsedModelChoice -> types, erased at build
    expect(exported).toEqual([
      'ModelChoiceToken',
      'ParsedModelChoice',
      'frontierAvailable',
      'parseModelChoice',
      'redactAnthropicKey',
      'resolveChatModel',
      'resolveLessonModel',
    ]);
    // `export { resolveLessonModel as resolvePreferredModel }` and
    // `export * from` would both slip past the declaration scan above.
    expect(src).not.toMatch(/^export\s*\{/m);
    expect(src).not.toMatch(/^export\s+\*/m);
    // The scan found the real exports, rather than a regex that matches
    // nothing and passes vacuously.
    expect(exported).toHaveLength(7);
  });

  it('resolveChatModel is imported ONLY by switchable-surface entry points', () => {
    // The sibling keystone to the resolveLessonModel test above. resolveChatModel
    // can return a frontier model, so an import of it from (say) learning.ts's
    // summary path or music-extraction.ts would reopen exactly the hole the
    // lesson-side test closes: a local-only surface reaching frontier without
    // calling a constructor and without touching LOCAL_SURFACES.
    //
    // The allow-list is the four SWITCHABLE_SURFACES' entry points and nothing
    // else. Adding a file here is a deliberate, reviewed act.
    const importers = PROD_FILES.filter((f) => /\bresolveChatModel\b/.test(bodyOf(f)))
      .map(rel)
      .filter((f) => f !== 'lib/services/frontier-model.ts')
      .sort();
    const allowed = [
      'lib/services/chat-model-request.ts',
    ];
    expect(importers).toEqual(allowed);
  });

  it('every literal resolveModel(...) argument in the tree is a declared surface', () => {
    // Belt-and-braces on top of the type: catches a `resolveModel(x as
    // never)` or a stringly-typed call that slipped past review.
    const known = new Set<string>(LOCAL_SURFACES);
    const calls: string[] = [];
    for (const f of PROD_FILES) {
      for (const m of bodyOf(f).matchAll(/\bresolveModel\(\s*'([^']*)'\s*\)/g)) {
        calls.push(m[1]);
        expect(known, `${rel(f)} calls resolveModel('${m[1]}')`).toContain(m[1]);
      }
    }
    // And the scan actually found calls, rather than a regex that matches
    // nothing passing vacuously.
    expect(calls.length).toBeGreaterThanOrEqual(11);
  });
});
