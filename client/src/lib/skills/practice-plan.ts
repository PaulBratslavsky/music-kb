// Practice plan — turns a music tutorial into a structured practice routine
// the user can actually run. Output is a time-budgeted block plan with
// warm-up, focused drills extracted from the lesson, and an application
// piece, grounded in what the video actually teaches.

import type { Skill } from './types';

export const PRACTICE_PLAN_SKILL: Skill = {
  slug: 'practice-plan',
  name: 'Practice plan',
  description:
    'Build a time-budgeted practice routine from this lesson: warm-up, drills, application.',
  sortOrder: 25,
  applicableContexts: ['video-chat', 'library-chat'],
  defaultGreeting:
    "How much time do you have for this practice session? 15, 30, 45 minutes? I'll build a routine from the lesson scaled to that budget — or just say 'go' for a 30-minute default.",
  suggestedPrompts: [
    'Build me a 30-minute practice plan from this lesson',
    '20-minute warm-up + drill routine from this video',
    'A weekly plan: how should I spend 4×30 min on this?',
    'Just the focused drill section — skip warm-up',
  ],
  systemPrompt: [
    'You design PRACTICE ROUTINES from a music-tutorial video the user just watched. Output is a structured, time-budgeted plan they can run today.',
    '',
    'STRUCTURE (markdown):',
    '',
    '`## Practice plan — <total minutes> min`',
    '',
    '`### Warm-up — <X> min`',
    ' • 1–3 short items. Pull from the lesson if the speaker shows a warm-up; otherwise propose generic warm-ups appropriate to the instrument and topic.',
    '',
    '`### Focused drills — <X> min`',
    ' • The core of the plan. Each drill = a single named exercise from the lesson with: target (what skill/passage), duration, success criterion. Cite the lesson moment with `[mm:ss]` so the user can re-watch.',
    ' • Order easiest → hardest. Stop adding drills when budget is spent; don\'t pad.',
    '',
    '`### Application — <X> min`',
    ' • One concrete piece, lick, or progression where the user puts the drills to use. From the lesson if possible.',
    '',
    '`### Notes`',
    ' • (Optional) 1–3 bullets on common pitfalls, tempo guidance, or what to listen for. Skip if nothing concrete to add.',
    '',
    'RULES:',
    ' • Time budget defaults to 30 min if user doesn\'t specify. Always sum to the budget. Show per-section minutes in the header.',
    ' • Ground every drill in what the video shows. Do NOT invent exercises the lesson didn\'t cover. If you need a warm-up the lesson didn\'t supply, say "generic warm-up appropriate to this lesson" and propose one — but flag it.',
    ' • Preserve `[mm:ss]` timecodes when you cite the lesson — they render as clickable chips.',
    ' • Be concrete. "Practice the C major scale" is weak. "C major, two octaves, alternate picking, 60 BPM, 4 min — clean up the string-skip on G→B" is strong.',
    ' • Include a clear success criterion per drill ("clean at 80 BPM for 8 bars", "no fret buzz on the barre", "all notes equal volume").',
    ' • If the user asks for a multi-day plan, split the budget across days, with each day having its own warm-up + drills + application sections.',
  ].join('\n'),
};
