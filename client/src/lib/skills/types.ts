// Skill type — the shape each skill module exports.
//
// A Skill is a persona/pedagogy package the chat can adopt. It's a
// code module (not CMS content) that lives alongside tools. The chat
// composes its final system prompt as `base grounding + skill.systemPrompt`,
// so skills focus on HOW to behave, not WHAT to reason over.
//
// Adding a skill: create a new file under `client/src/lib/skills/`,
// export a const of this shape, import + register it in `index.ts`.

// Chat surfaces a skill can apply to. A skill declares which contexts
// it supports; the picker filters accordingly. A "Summarize everything
// in 60s" skill might only make sense in library-chat, a "Tutor" skill
// can work across all three.
export type SkillContext =
  | 'video-chat'
  | 'library-chat'
  | 'digest-chat'
  | 'project-chat'
  | 'notes-composer';

export type Skill = {
  /** Stable kebab-case identifier. Used in the wire protocol (skillSlug
   * in `/api/chat` body) and in UI state. Don't change after ship. */
  slug: string;
  /** Human-facing label shown on the picker pill. */
  name: string;
  /** One-sentence blurb shown as a tooltip on the picker pill. */
  description: string;
  /** The persona/pedagogy prompt for CHAT use. Appended to the base
   * grounding context by the chat handler — focus on HOW to behave.
   * Optional because some skills are notes-composer-only (no chat
   * persona makes sense). Required if the skill appears in any
   * chat-like context. */
  systemPrompt?: string;
  /** Chat surfaces this skill should appear in. */
  applicableContexts: SkillContext[];
  /** Optional opening message the assistant posts when this skill is
   * selected on an empty conversation. Lets the tutor/etc. greet first. */
  defaultGreeting?: string;
  /** Optional emoji or short icon label for the picker. */
  icon?: string;
  /** Optional starter prompts surfaced as chips below the chat header
   * while the user hasn't engaged yet. Clicking a chip auto-sends.
   * The first entry doubles as the input-prefill on skill change so
   * the Send button is immediately enabled (user can edit, swap to
   * another chip, or just hit Send). Skills without explicit prompts
   * fall back to a generic Q&A set defined in `VideoChat`. */
  suggestedPrompts?: string[];
  /** Lower numbers sort earlier in the picker. Built-ins use 10/20/30;
   * later-added skills can slot in between (15, 25…). */
  sortOrder: number;
  /** Optional — overrides the generic note-summarization prompt when
   * "Summarize to note" is clicked on a conversation that used this
   * skill. Q&A can fall back to the default "study note" format; Social
   * Post wants the drafts preserved verbatim; Tutor wants the learning
   * arc captured in first-person voice. If omitted, the generic prompt
   * is used. */
  notePrompt?: string;
  /** Optional — system prompt for the standalone Notes composer
   * (generate a note directly from a prompt + video context, no chat
   * history). Required for any skill that appears in `notes-composer`
   * context. Should instruct the model on both INITIAL generation (no
   * `currentContent`) and ITERATIVE refinement (user prompt carries a
   * revision instruction against an existing draft — AI decides update-
   * in-place vs append vs restructure based on intent, always returns
   * the full new note). */
  composerPrompt?: string;
};
