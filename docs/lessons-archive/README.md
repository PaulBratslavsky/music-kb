# Lesson archive

Verbatim copies of the 8 hardcoded lesson routes as they existed before the
migration to Strapi (`docs/superpowers/specs/2026-08-20-strapi-lessons-design.md`).

They are here to be read side-by-side while authoring the Strapi replacement —
git history preserves them too, but `git show` is a worse reading experience
than an open file.

**Do not import from this folder.** It sits outside `client/` deliberately:
`client/tsconfig.json` includes `**/*.tsx`, so an archive inside `client/`
would still be typechecked and would fail once the components these files
import are deleted. Anything left under `client/src/routes/` would also be
picked up by the file-based router and served as a live route.

Delete this folder once every lesson renders from Strapi and has been
verified against its original.
