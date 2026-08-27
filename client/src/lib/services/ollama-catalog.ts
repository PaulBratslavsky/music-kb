// Enumerates the chat-capable models actually installed on the local Ollama
// host, so the model picker offers what is really there rather than the three
// ids pinned in env.ts.
//
// Server-side only: it talks to OLLAMA_HOST directly. The browser reaches it
// through the `listChatModels` server function, never by fetching Ollama.
//
// Ollama's native endpoint is `/api/tags` (NOT the OpenAI-compat `/v1/models`);
// OLLAMA_HOST is already the native host with any `/v1` suffix stripped by
// env.ts, so it is the correct base here.

import { OLLAMA_HOST } from '#/lib/env';

export type OllamaCatalogEntry = {
  /** Model id as Ollama reports it, e.g. "qwen3:14b". */
  id: string;
  /** Human label — the id is already the clearest name Ollama gives us. */
  label: string;
  /** Parameter size when Ollama reports it, e.g. "14.8B". */
  parameterSize?: string;
  /** Bytes on disk; used only to sort largest-last in the picker. */
  sizeBytes?: number;
};

/**
 * Models that can generate text but must never appear as a CHAT choice.
 *
 * Embedding models are installed alongside chat models and Ollama lists them
 * identically in /api/tags. Offering `nomic-embed-text` in a chat picker
 * produces a run that fails deep inside the adapter with an unhelpful error,
 * so they are filtered by family here rather than left for the user to avoid.
 */
const EMBEDDING_FAMILIES = new Set(['nomic-bert', 'bert']);
const EMBEDDING_ID_HINTS = [/embed/i, /minilm/i];

function isEmbeddingModel(id: string, family?: string): boolean {
  if (family && EMBEDDING_FAMILIES.has(family)) return true;
  return EMBEDDING_ID_HINTS.some((re) => re.test(id));
}

/**
 * Ask Ollama what is installed.
 *
 * Returns [] rather than throwing when Ollama is unreachable: a missing
 * catalogue must degrade the picker to "the configured default only", not take
 * down the chat page that renders it. The caller decides how to present that.
 */
export async function listInstalledOllamaModels(
  signal?: AbortSignal,
): Promise<OllamaCatalogEntry[]> {
  let res: Response;
  try {
    res = await fetch(`${OLLAMA_HOST}/api/tags`, { signal });
  } catch {
    return [];
  }
  if (!res.ok) return [];

  let body: { models?: Array<Record<string, any>> };
  try {
    body = await res.json();
  } catch {
    return [];
  }

  return (body.models ?? [])
    .map((m) => ({
      id: String(m.name ?? m.model ?? ''),
      label: String(m.name ?? m.model ?? ''),
      parameterSize: m.details?.parameter_size,
      sizeBytes: typeof m.size === 'number' ? m.size : undefined,
      family: m.details?.family as string | undefined,
    }))
    .filter((m) => m.id && !isEmbeddingModel(m.id, m.family))
    .map(({ family: _family, ...rest }) => rest)
    .sort((a, b) => a.id.localeCompare(b.id));
}
