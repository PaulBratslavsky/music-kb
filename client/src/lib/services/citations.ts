/**
 * The citations that `/api/ask` sends with each answer — the one wire contract
 * between `/api/ask` and the library chat UI.
 *
 * It lived twice: as `CitationPayload` in the route that builds it and as
 * `Citation` in the client that renders it, field-for-field identical and
 * free to drift. One declaration, imported by both sides, cannot.
 *
 * The route retrieves passages before the model writes, so it sends them as an
 * AG-UI `CUSTOM` event named `CITATIONS_EVENT` (TanStack AI docs: Custom
 * Events). A chat middleware emits the event when each assistant message
 * starts, with that message's id. The library chat reads the event with
 * `useChat({ onCustomEvent })` and stores the citations under that message id.
 */
export type Citation = {
  /**
   * Position in the retrieved set, 0-based — it is the array index the
   * producer emits (`passages.map(toCitation)`), and the `[N]` marker the
   * model is told to cite with. Kept 0-based rather than "fixed" to 1: the
   * prompt, the model's output and the renderer already agree on it, and
   * shifting it would silently mis-link every existing citation.
   */
  index: number;
  videoDocumentId: string;
  youtubeVideoId: string;
  videoTitle: string | null;
  videoAuthor: string | null;
  videoThumbnailUrl: string | null;
  startSec: number;
  endSec: number;
  /** The passage itself, so the UI can show what a citation actually says. */
  text: string;
};

/** The name of the CUSTOM event that carries an answer's citations. */
export const CITATIONS_EVENT = 'library-ask:citations';

/** The `value` of a `CITATIONS_EVENT` CUSTOM event. */
export type CitationsEventValue = {
  /** The assistant message these citations ground. */
  messageId: string;
  citations: Citation[];
  /** The model that answers. The UI ignores it; the eval harness records it. */
  model: string;
};

/**
 * Narrow an `onCustomEvent` payload to `CitationsEventValue`.
 *
 * `onCustomEvent` types the value as `unknown`, because the client cannot know
 * the shape of an app's own events. This guard checks the two fields the UI
 * uses, so a malformed event is ignored instead of crashing the render.
 */
export function isCitationsEventValue(value: unknown): value is CitationsEventValue {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as { messageId?: unknown; citations?: unknown };
  return typeof v.messageId === 'string' && Array.isArray(v.citations);
}
