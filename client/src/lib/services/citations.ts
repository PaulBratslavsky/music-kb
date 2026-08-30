/**
 * The `CITATIONS` frame's payload — the one wire contract between
 * `/api/ask` and the library chat UI.
 *
 * It lived twice: as `CitationPayload` in the route that builds it and as
 * `Citation` in the client that renders it, field-for-field identical and
 * free to drift. One declaration, imported by both sides, cannot.
 *
 * The frame is written as raw bytes AHEAD of the SDK's stream, because
 * retrieval happens before generation. It is re-bound to the message it
 * grounds by the transport interceptor — see components/chat/capture-frames.ts.
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
