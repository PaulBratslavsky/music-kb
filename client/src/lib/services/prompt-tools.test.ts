import { describe, it, expect } from 'vitest';
import { buildChatSystemPrompt } from './learning';

// The prompt's TOOLS AVAILABLE block must be derived from the tools the caller
// actually passes to chat(). It used to be unconditional, so
// askAboutVideoService — which passes no tools — told the model it had a web
// search it could not reach. These assertions fail if that drift returns.

const video = {
  videoTitle: 'T', youtubeVideoId: 'y1', summaryTitle: null,
  summaryDescription: null, summaryOverview: null,
  sections: [], keyTakeaways: [], tags: [],
} as any;

describe('buildChatSystemPrompt — TOOLS AVAILABLE is derived, not hardcoded', () => {
  it('omits the block entirely when no tools are passed', () => {
    const p = buildChatSystemPrompt(video, [], null);
    expect(p).not.toContain('TOOLS AVAILABLE');
    // and never leaks a stray literal from a nullable array entry
    expect(p).not.toContain('null');
  });

  it('names exactly the tools it is given', () => {
    const p = buildChatSystemPrompt(video, [], null, [{ name: 'kb_web_search' }]);
    expect(p).toContain('TOOLS AVAILABLE');
    expect(p).toContain('`kb_web_search(query)`');
  });

  it('does not hardcode a name — a renamed tool is reflected', () => {
    const p = buildChatSystemPrompt(video, [], null, [{ name: 'renamed_tool' }]);
    expect(p).toContain('`renamed_tool(query)`');
    expect(p).not.toContain('kb_web_search');
  });

  it('an empty array is the same as none', () => {
    expect(buildChatSystemPrompt(video, [], null, [])).not.toContain('TOOLS AVAILABLE');
  });
});
