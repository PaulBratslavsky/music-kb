// The ONE module the interactive routes call to turn a request's model choice
// into a resolved model.
//
// It exists so `resolveChatModel` has a single importer rather than four. Each
// of api.chat.tsx, api.digest-chat.tsx, api.ask.tsx and api.notes.compose.tsx
// calling the resolver directly would mean a four-entry allow-list in
// model-policy.test.ts, and every future surface would widen it again. With one
// choke point the allow-list stays at one name, so adding a fifth caller is
// visible in review as an edit to THIS file's consumers rather than as a
// quietly-longer list.
//
// It also owns the I/O the resolver deliberately does not do: fetching the
// installed Ollama catalogue so a `local:<id>` choice can be validated against
// what actually exists before an adapter is built.

import { listInstalledOllamaModels } from '#/lib/services/ollama-catalog';
import { resolveChatModel } from '#/lib/services/frontier-model';
import type { SwitchableSurface } from '#/lib/services/model-policy';
import type { ResolvedModel } from '#/lib/services/model-policy';

export type ChatModelResolution = {
  model: ResolvedModel;
  /**
   * Set when the request did NOT get the model it asked for — an uninstalled
   * local id, or 'frontier' with no key. Routes surface it to the user rather
   * than silently answering from a different model than the picker shows.
   */
  notice?: string;
};

/**
 * Resolve the model for one interactive request.
 *
 * `modelChoice` is the raw wire token from the client — never a model id and
 * never trusted. An unparseable or unknown token degrades to the surface
 * default rather than throwing: a bad choice must not turn a working chat into
 * a 500.
 */
export async function resolveRequestModel(
  surface: SwitchableSurface,
  modelChoice: unknown,
): Promise<ChatModelResolution> {
  // A 'default' or 'frontier' choice needs no catalogue, and the fetch is a
  // network round-trip on every chat turn — so only pay for it when a
  // `local:` choice actually has to be validated.
  const needsCatalogue =
    typeof modelChoice === 'string' && modelChoice.startsWith('local:');

  const installed = needsCatalogue
    ? (await listInstalledOllamaModels()).map((m) => m.id)
    : [];

  return resolveChatModel(surface, modelChoice as string | undefined, installed);
}
