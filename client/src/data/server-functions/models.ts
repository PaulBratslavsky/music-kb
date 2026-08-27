import { createServerFn } from '@tanstack/react-start';
import { listInstalledOllamaModels } from '#/lib/services/ollama-catalog';
import { frontierAvailable } from '#/lib/services/frontier-model';
import { modelIdFor } from '#/lib/services/model-policy';
import { LESSON_MODEL } from '#/lib/env';

/**
 * One selectable entry in the model picker.
 *
 * `token` is what the client sends back on a chat request — never a bare model
 * id, so the server can validate it against the installed catalogue before
 * building an adapter.
 */
export type ChatModelOption = {
  token: string;
  label: string;
  tier: 'local' | 'frontier';
  /** Extra detail for the UI, e.g. "14.8B" or "hosted". */
  detail?: string;
  /** True for the entry that runs when no explicit choice is made. */
  isDefault?: boolean;
};

/**
 * The models a chat surface may be pointed at, for the picker.
 *
 * Server-side: it reaches OLLAMA_HOST directly and reads whether an Anthropic
 * key is configured. The browser never learns the key — only whether a frontier
 * OPTION exists, which is the minimum the UI needs to decide what to render.
 *
 * Ollama being down yields the default entry alone rather than an error: the
 * picker degrading to one choice is a better failure than a chat page that
 * will not render.
 */
export const listChatModelsFn = createServerFn({ method: 'GET' })
  .validator((surface: string) => surface)
  .handler(async ({ data: surface }): Promise<ChatModelOption[]> => {
    const defaultId = (() => {
      try {
        return modelIdFor(surface as never);
      } catch {
        return null;
      }
    })();

    const installed = await listInstalledOllamaModels();

    const options: ChatModelOption[] = [];

    if (defaultId) {
      options.push({
        token: 'default',
        label: `${defaultId} (default)`,
        tier: 'local',
        detail: installed.find((m) => m.id === defaultId)?.parameterSize,
        isDefault: true,
      });
    }

    for (const m of installed) {
      // The default is already listed above; listing it twice would let the
      // user pick "the same model" through two tokens that log differently.
      if (m.id === defaultId) continue;
      options.push({
        token: `local:${m.id}`,
        label: m.id,
        tier: 'local',
        detail: m.parameterSize,
      });
    }

    if (frontierAvailable()) {
      options.push({
        token: 'frontier',
        label: LESSON_MODEL,
        tier: 'frontier',
        detail: 'hosted',
      });
    }

    return options;
  });
