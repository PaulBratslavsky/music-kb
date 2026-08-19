import { chat, toolDefinition } from '@tanstack/ai';
import { createOllamaChat } from '@tanstack/ai-ollama';
import { z } from 'zod';

let called = false;
const tool = toolDefinition({
  name: 'web_search',
  description: 'Search the web for current information.',
  inputSchema: z.object({ query: z.string().describe('the search query') }),
  outputSchema: z.object({ results: z.array(z.string()) }),
}).server(async ({ query }) => {
  called = true;
  console.log('  >>> TOOL EXECUTED with query:', query);
  return { results: [`Berklee College of Music was founded in 1945.`] };
});

const MODEL = process.argv[2];
console.log(`=== model: ${MODEL} ===`);
const stream = chat({
  adapter: createOllamaChat(MODEL, 'http://localhost:11434'),
  messages: [{ role: 'user', content: 'What year was Berklee College of Music founded? Use web_search.' }],
  tools: [tool],
});
const seen = {};
for await (const ev of stream) {
  const t = ev?.type;
  if (t) seen[t] = (seen[t] || 0) + 1;
  if (t === 'TOOL_CALL_START') console.log('  TOOL_CALL_START:', ev.toolName ?? ev.toolCallName);
  if (t === 'TOOL_CALL_END') console.log('  TOOL_CALL_END  input:', JSON.stringify(ev.input ?? ev.args), 'result:', JSON.stringify(ev.result)?.slice(0,60));
}
console.log('  events:', Object.entries(seen).filter(([k]) => k.startsWith('TOOL')).map(([k,v]) => `${k}x${v}`).join(', ') || '(none)');
console.log('  tool actually executed:', called);
