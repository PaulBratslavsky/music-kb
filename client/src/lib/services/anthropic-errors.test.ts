import { describe, expect, it } from 'vitest';
import { friendlyAnthropicError } from './anthropic-errors';

describe('friendlyAnthropicError', () => {
  describe('auth patterns', () => {
    it.each([
      'Structured output generation failed: 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}',
      '403 permission_denied: your API key does not have access to this resource',
      'invalid api key provided',
    ])('detects %j as an auth failure', (raw) => {
      expect(friendlyAnthropicError(raw)).toMatch(/rejected the configured API key/);
    });
  });

  describe('rate-limit patterns', () => {
    it.each([
      'Structured output generation failed: 429 {"type":"error","error":{"type":"rate_limit_error","message":"Number of requests has exceeded your rate limit"}}',
      'rate limit exceeded, please retry later',
    ])('detects %j as a rate limit', (raw) => {
      expect(friendlyAnthropicError(raw)).toMatch(/rate limit hit/);
    });
  });

  describe('timeout patterns', () => {
    it.each(['Request timeout', 'connection error: timed out', 'request aborted'])(
      'detects %j as a timeout',
      (raw) => {
        expect(friendlyAnthropicError(raw)).toMatch(/timed out/);
      },
    );
  });

  it('never echoes an unrecognized raw provider payload back to the user', () => {
    const raw =
      'Structured output generation failed: 500 {"type":"error","error":{"type":"api_error","message":"internal server hiccup with request-id abc123"}}';
    const result = friendlyAnthropicError(raw);
    expect(result).not.toContain('request-id');
    expect(result).not.toContain('abc123');
    expect(result).not.toContain('hiccup');
    expect(result).toMatch(/Frontier AI request failed/);
  });

  it('empty input returns a generic canned failure, not an empty string', () => {
    expect(friendlyAnthropicError('   ')).toBe('Frontier AI request failed.');
  });

  // The core security property: no branch of this function ever includes
  // any substring of its input in its output, so a secret embedded
  // anywhere in a raw error — however it got there — cannot surface.
  it('never includes a fabricated secret from the input in any branch output', () => {
    const secret = 'sk-ant-api03-should-never-appear-anywhere';
    const cases = [
      `401 authentication_error invalid x-api-key ${secret}`,
      `429 rate_limit_error too many requests, key ${secret}`,
      `timeout while using key ${secret}`,
      `some unrecognized shape mentioning ${secret}`,
    ];
    for (const raw of cases) {
      expect(friendlyAnthropicError(raw)).not.toContain(secret);
    }
  });
});
