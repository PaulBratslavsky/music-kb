// Skills registry entry point. Importing this module has the
// side effect of registering every built-in skill, so any consumer
// (chat routes, picker UI) that imports from `#/lib/skills` gets a
// fully-populated registry.
//
// Add a new built-in:
//   1. Create `client/src/lib/skills/<slug>.ts` exporting a `Skill` const.
//   2. Import it here and call `registerSkill(...)` below.
//   3. (Optional) Pick a `sortOrder` that positions it in the picker.

import { registerSkill } from './registry';
import { QA_SKILL } from './qa';
import { TUTOR_SKILL } from './tutor';
import { SOCIAL_POST_SKILL } from './social-post';
import { NOTE_SKILL } from './note';
import { YOUTUBE_SCRIPT_SKILL } from './youtube-script';

registerSkill(QA_SKILL);
registerSkill(TUTOR_SKILL);
registerSkill(SOCIAL_POST_SKILL);
registerSkill(NOTE_SKILL);
registerSkill(YOUTUBE_SCRIPT_SKILL);

export type { Skill, SkillContext } from './types';
export { listAllSkills, listSkills, getSkill } from './registry';
