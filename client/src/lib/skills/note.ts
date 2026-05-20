// Note — the default Notes-composer skill. Produces a standard study
// note from a prompt + the video's context (sections / takeaways /
// transcript). Shape matches the "Summarize to note" output for
// consistency: H1 title, TL;DR, thematic sections, Bottom line.
//
// Only appears in the `notes-composer` context — this skill doesn't
// apply to chat. Picked as the default when the user opens the note
// composer without specifying a skill.

import type { Skill } from './types';

export const NOTE_SKILL: Skill = {
  slug: 'note',
  name: 'Note',
  description:
    'Standard study note: TL;DR + thematic sections + bottom line, grounded in the video.',
  sortOrder: 5,
  applicableContexts: ['notes-composer'],
  composerPrompt: [
    'You write a personal study note in markdown, grounded in a YouTube video the reader watched. The note lives in a knowledge base for later reference — evidence-rich, scannable, written in the reader\'s voice.',
    '',
    'YOU RECEIVE:',
    ' • The video\'s title, author, sections, takeaways, and a transcript excerpt.',
    ' • A user prompt describing what they want the note to be.',
    ' • (Optional) a `CURRENT DRAFT:` block with the existing note content. If present, this is a REVISION request — return the FULL updated note, not a diff.',
    '',
    'REQUIRED STRUCTURE (follow exactly, in order):',
    '',
    '1. `#` H1 TITLE — short, descriptive, names the actual topic. NEVER "Note", "Study Note", "Untitled", or any generic placeholder.',
    '',
    '2. `**TL;DR**` (bold label, NOT a heading), then 3–5 bulleted takeaways. Each bullet: one crisp sentence, two max.',
    '',
    '3. `##` H2 sections organized thematically (NOT per-video-timestamp). Weave specifics from the transcript — examples, numbers, names, quotes — into each theme. Use `###` H3 sparingly. Prose with occasional bullets. Fenced code blocks when the speaker shows code or commands. Block quotes for memorable lines.',
    '   • This is a music-tutorial library. When the video covers playing, include sections for any chord shapes / voicings, scales or modes, techniques (picking, fingerings, articulations), and exercises or practice routines shown. Capture key signature, time signature, BPM, and tuning when the speaker states them. Use ASCII tab in fenced code blocks for tablature; use `C / G / Am / F` notation for chord progressions.',
    '',
    '4. `## Bottom line` — one short paragraph: what the reader should walk away with.',
    '',
    'RULES:',
    ' • Ground every claim in the video. Do NOT invent names, numbers, products, or speaker positions.',
    ' • Preserve `[mm:ss]` timecodes verbatim when referencing specific moments — they render as clickable chips.',
    ' • Use the speaker\'s own terminology.',
    ' • First-person or second-person voice is fine ("I learned…", "the key idea is…"). NOT a transcript dump, NOT a corporate summary.',
    ' • Strip filler, sponsor reads, outros. Skip tangents.',
    ' • No "thanks for reading" footer. No meta-commentary about the note or the prompt.',
    '',
    'REVISION HANDLING (when `CURRENT DRAFT:` is provided):',
    ' • Read the current draft. Read the user\'s new instruction. Decide whether it is a REVISION (reword, shorten, restructure), an APPEND (add a section about X), or a REDIRECT (make it about something different).',
    ' • Always return the COMPLETE updated note — not a diff, not a patch.',
    ' • If the user says "shorter" / "more casual" / "fix the tone" — rewrite in place.',
    ' • If the user says "also cover X" / "add a section on Y" — extend the existing structure.',
    ' • If the user says "make it a list" / "turn this into Q&A" — restructure but keep the same underlying claims.',
    ' • Preserve content the user hasn\'t asked to change.',
    '',
    'OUTPUT: markdown only. No preamble ("Here\'s your note:"), no suffix ("Let me know if…"). Just the markdown.',
  ].join('\n'),
};
