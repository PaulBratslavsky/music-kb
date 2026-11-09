// MCP tag tools match a tag name the way the server stores it (issue #14).
//
// The document-service middleware stores every tag name trimmed, lower-cased
// and with whitespace runs collapsed. The MCP tools used to look names up with
// trim + lower-case only, so a name with a double space missed the row it
// meant, and failed three different ways depending on the tool:
//   - tagVideo / addVideo: the lookup missed, the create was renamed by the
//     middleware to the existing name, and the unique constraint threw;
//   - untagVideo: silently removed nothing;
//   - the read tools: filtered on a name nothing is stored under.
// Strapi is faked at the `documents(uid)` seam; the tools are the real ones.
import { describe, expect, it } from 'vitest';
import { listVideosTool } from './list-videos';
import { tagVideoTool, untagVideoTool } from './tags';

const VIDEO = { documentId: 'video-1', youtubeVideoId: 'dQw4w9WgXcQ' };

function fakeStrapi(storedTags: Array<{ documentId: string; name: string }>, videoTags: string[] = []) {
  const calls = { creates: [] as unknown[], updates: [] as any[], filters: [] as any[] };
  const strapi = {
    // listVideos counts through the query engine rather than documents().
    db: { query: () => ({ count: async () => 0 }) },
    documents: (uid: string) => {
      if (uid === 'api::tag.tag') {
        return {
          findFirst: async ({ filters }: any) =>
            storedTags.find((t) => t.name === filters?.name?.$eq) ?? null,
          create: async ({ data }: any) => {
            // The unique constraint. (The real middleware would also collapse
            // a double-spaced name into an existing one before this check,
            // which is how a missed lookup became a throw; here, a create at
            // all is what the tests treat as the bug.)
            if (storedTags.some((t) => t.name === data.name)) throw new Error('This attribute must be unique: name');
            calls.creates.push(data);
            return { documentId: `new-${data.name}` };
          },
        };
      }
      if (uid === 'api::video.video') {
        return {
          findFirst: async (args: any) => {
            calls.filters.push(args?.filters);
            return {
              ...VIDEO,
              tags: storedTags.filter((t) => videoTags.includes(t.name)),
            };
          },
          findMany: async (args: any) => {
            calls.filters.push(args?.filters);
            return [];
          },
          count: async () => 0,
          findOne: async () => null,
          update: async (args: any) => {
            calls.updates.push(args.data);
            return VIDEO;
          },
        };
      }
      throw new Error(`unexpected uid ${uid}`);
    },
  };
  return { strapi: strapi as never, calls };
}

describe('tagVideo', () => {
  it('a double-spaced name finds the existing tag instead of throwing', async () => {
    const { strapi, calls } = fakeStrapi([{ documentId: 'tag-jb', name: 'jazz blues' }]);
    const args = tagVideoTool.schema.parse({ videoId: VIDEO.youtubeVideoId, tags: ['Jazz  Blues'] });
    const result = (await tagVideoTool.execute(args as never, { strapi })) as Record<string, any>;
    expect(result.error).toBeUndefined();
    expect(calls.creates).toEqual([]);
    expect(calls.updates[0].tags).toContain('tag-jb');
  });

  it('a genuinely new tag is created with the normalized name and its slug', async () => {
    const { strapi, calls } = fakeStrapi([]);
    const args = tagVideoTool.schema.parse({ videoId: VIDEO.youtubeVideoId, tags: ['Hip_Hop  Beats'] });
    await tagVideoTool.execute(args as never, { strapi });
    expect(calls.creates).toEqual([{ name: 'hip_hop beats', slug: 'hip-hop-beats' }]);
  });
});

describe('untagVideo', () => {
  it('a double-spaced name removes the tag it means', async () => {
    const { strapi, calls } = fakeStrapi([{ documentId: 'tag-jb', name: 'jazz blues' }], ['jazz blues']);
    const args = untagVideoTool.schema.parse({ videoId: VIDEO.youtubeVideoId, tags: ['jazz  blues'] });
    await untagVideoTool.execute(args as never, { strapi });
    expect(calls.updates[0].tags).not.toContain('tag-jb');
  });
});

describe('the read tools', () => {
  it('listVideos filters on the name as stored', async () => {
    const { strapi, calls } = fakeStrapi([]);
    const args = listVideosTool.schema.parse({ tag: 'Jazz  Blues' });
    await listVideosTool.execute(args as never, { strapi });
    expect(JSON.stringify(calls.filters)).toContain('"jazz blues"');
    expect(JSON.stringify(calls.filters)).not.toContain('jazz  blues');
  });
});
