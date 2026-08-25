import { z } from 'zod';
import { createLessonTool } from '../src/mcp/tools/create-lesson.ts';
import { updateLessonTool } from '../src/mcp/tools/update-lesson.ts';

for (const t of [createLessonTool, updateLessonTool]) {
  try {
    const js: any = z.toJSONSchema(t.schema as any, { io: 'input' });
    const s = JSON.stringify(js);
    const items = js.properties?.body?.items ?? {};
    const bodyVariants = items.anyOf?.length ?? items.oneOf?.length ?? 'n/a';
    const descCount = (s.match(/"description":/g) || []).length;
    console.log(`${t.name}: OK  jsonschema ${s.length} bytes, body variants=${bodyVariants}, descriptions=${descCount}`);
  } catch (e: any) {
    console.log(`${t.name}: THROWS ${e?.message}`);
  }
}
