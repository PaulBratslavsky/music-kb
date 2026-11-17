/**
 * Sampling options for a `chat({ modelOptions })` call against the Ollama
 * adapter.
 *
 * Three rules are encoded here so call sites don't have to repeat them. The
 * first two come from the types of `@tanstack/ai-ollama` 1.1.1; the third
 * comes from Ollama itself.
 *
 * 1. **Sampling knobs are nested.** Up to `@tanstack/ai-ollama` 0.6 a bare
 *    top-level `temperature` on `chat()` was accepted. It was removed in 0.9,
 *    and `chat()` in `@tanstack/ai` 1.4.0 has no top-level `temperature`
 *    either. `temperature`, `top_p` and `num_predict` live under
 *    `modelOptions.options`, mirroring Ollama's own request body. The 1.1.1
 *    adapter copies `modelOptions.options` into that request body.
 *
 * 2. **`model` is required but ignored.** The adapter types its options as
 *    `ResolveModelOptions<TModel>`, which narrows to a per-model option type
 *    only when the model name is a *literal* the package knows. Ours arrive
 *    from env as plain `string`, so in 1.1.1 the conditional falls through to
 *    `Omit<ChatRequest, 'think'>` from the `ollama` package, where `model` is
 *    required. The adapter never reads it: the model is bound when the
 *    adapter is constructed. So `model` exists only to satisfy the type. Pass
 *    the same constant the adapter was built with to keep the two honest.
 *
 * 3. **Output is unbounded by default.** Ollama keeps generating until the
 *    model decides to stop, and a small instruct model asked for a one-line
 *    answer will happily write six hundred tokens of essay. That is fine for
 *    prose surfaces and fatal for any call with a latency budget, so
 *    `numPredict` caps it. Measured on gemma4-kb: uncapped 679 tokens /
 *    12.2s, capped at 32 tokens / 0.89s for the same prompt.
 */
export function samplingOptions(
  model: string,
  temperature: number,
  numPredict?: number,
) {
  return {
    model,
    options: numPredict === undefined ? { temperature } : { temperature, num_predict: numPredict },
  };
}
