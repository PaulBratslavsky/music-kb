import { describe, expect, it } from 'vitest';
import { friendlyOllamaError } from './ollama-errors';

describe('friendlyOllamaError', () => {
  describe('host-unreachable patterns', () => {
    it.each([
      'fetch failed',
      'TypeError: fetch failed',
      'ECONNREFUSED 127.0.0.1:11434',
      'connect ECONNREFUSED ::1:11434',
      'NetworkError when attempting to fetch',
      'Failed to fetch',
      'Request to http://localhost:11434/api/chat failed',
    ])('detects %j as host unreachable', (raw) => {
      expect(friendlyOllamaError(raw)).toMatch(/AI server unreachable/);
    });
  });

  describe('model-not-found patterns', () => {
    it.each([
      "model 'gemma4-kb' not found",
      'model "nonexistent" not found, try `ollama pull` to download it',
      'no such model: foo',
      'Pull the model first',
    ])('detects %j as model missing', (raw) => {
      expect(friendlyOllamaError(raw)).toMatch(/can.t find the configured model/);
    });
  });

  describe('timeout patterns', () => {
    it.each(['Request timeout', 'timed out after 30s', 'request aborted'])(
      'detects %j as timeout',
      (raw) => {
        expect(friendlyOllamaError(raw)).toMatch(/timed out/);
      },
    );
  });

  it('passes unrelated errors through unchanged', () => {
    expect(friendlyOllamaError('Strapi error 500: bad request')).toBe(
      'Strapi error 500: bad request',
    );
    expect(friendlyOllamaError('Some random message')).toBe(
      'Some random message',
    );
  });

  it('handles empty / whitespace input', () => {
    expect(friendlyOllamaError('')).toBe('AI request failed.');
    expect(friendlyOllamaError('   ')).toBe('AI request failed.');
  });
});
