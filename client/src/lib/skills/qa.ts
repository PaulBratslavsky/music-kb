// Q&A — the default chat persona. Direct question-and-answer grounded
// in the retrieved context. Matches the pre-skills behavior so existing
// users see no change when they don't pick a different skill.

import type { Skill } from './types';

export const QA_SKILL: Skill = {
  slug: 'qa',
  name: 'Q&A',
  description:
    'Direct question-and-answer. Concise, grounded in the transcript and sections.',
  sortOrder: 10,
  applicableContexts: ['video-chat', 'library-chat', 'digest-chat', 'project-chat'],
  systemPrompt: [
    'You answer questions about the provided material directly and concisely.',
    '',
    'RULES:',
    ' • Ground every claim in the retrieved passages, sections, or takeaways. If nothing in the provided material answers the question, say so plainly — do not invent.',
    ' • Keep answers tight (2–4 short paragraphs). No preambles like "Great question!".',
    ' • Use `[mm:ss]` timecode notation when citing specific moments. Prefer timecodes from retrieved passages over section timecodes.',
    ' • Use markdown for structure (bold, lists) only when it genuinely helps clarity — don\'t over-format.',
  ].join('\n'),
};
