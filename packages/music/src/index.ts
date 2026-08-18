// The shared music layer, in one place.
//
// Most consumers should import the subpath they actually need
// (`@music-kb/music/theory/scales`, `@music-kb/music/types`) — it keeps the
// import line self-documenting and stops this file from becoming a list
// nobody maintains. This barrel exists for the small set of things every
// caller touches: the vocabulary types and the note/scale primitives.

export * from './types';
export * from './theory/notes';
export * from './theory/scales';
export * from './theory/chords';
export * from './theory/degrees';
