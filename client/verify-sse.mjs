import { chat, toolDefinition, toServerSentEventsResponse } from '@tanstack/ai';
import { createOllamaChat } from '@tanstack/ai-ollama';
import { z } from 'zod';

const tool = toolDefinition({
  name: 'web_search',
  description: 'Search the web for current information.',
  inputSchema: z.object({ query: z.string() }),
  outputSchema: z.object({ results: z.array(z.string()) }),
}).server(async ({ query }) => ({ results: [`RESULT_MARKER for ${query}`] }));

const stream = chat({
  adapter: createOllamaChat('llama3.2:3b', 'http://localhost:11434'),
  messages: [{ role: 'user', content: 'What year was Berklee founded? Use web_search.' }],
  tools: [tool],
});
const res = toServerSentEventsResponse(stream);
const text = await res.text();
for (const line of text.split('\n')) {
  if (!line.startsWith('data:')) continue;
  const p = line.slice(5).trim();
  if (!p || p === '[DONE]') continue;
  let e; try { e = JSON.parse(p); } catch { continue; }
  if (String(e.type).startsWith('TOOL_CALL')) {
    console.log(e.type, '| keys:', Object.keys(e).join(','));
    if (e.type === 'TOOL_CALL_END') console.log('   END.result =', JSON.stringify(e.result));
    if (e.type === 'TOOL_CALL_RESULT') console.log('   RESULT payload =', JSON.stringify(e).slice(0, 200));
  }
}
