# Functional Requirements

Capability statements derived from stages 1 (product) and 2 (users). Tech choices are deferred to stage 4.

## Core features (MVP)

### Instrument rendering
- The product must render a **piano keyboard view** showing at least 2–3 octaves, with individual notes highlightable.
- The product must render a **guitar fretboard view** in standard tuning (E-A-D-G-B-E), at least 12 frets visible, with individual notes highlightable.
- The product must render an **Ableton Push grid view** in chromatic mode (8×8 grid, tuned in fourths vertically), with individual pads highlightable.
- All three views must be visible **simultaneously** on the same screen (or via a clearly toggleable layout on smaller screens).
- All three views must stay **synchronized** — when the user selects a chord/scale/note, all three update together.

### Lookup (primary loop)
- The user must be able to select a **chord** by root note (12 options: C through B) and chord quality (at minimum: maj, min, dom7, maj7, min7, dim, aug, sus2, sus4 — extensible).
- The user must be able to select a **scale** by root note and scale type (at minimum: major, natural minor, harmonic minor, melodic minor, modes [Dorian, Phrygian, Lydian, Mixolydian, Aeolian, Locrian], pentatonic major, pentatonic minor, blues).
- The user must be able to select a **single note** (12 pitch classes) and see it across all three views.
- When a chord is selected, the user must be able to **cycle through inversions** (root position, 1st inversion, 2nd inversion, etc., depending on chord size).
- When a chord is selected, the user must be able to **cycle through voicings** — different physical arrangements of the same chord notes (e.g., open vs. closed, drop-2, spread vs. tight) — at least 2–3 per chord for MVP.
- The selected chord/scale/note must be displayed clearly as text alongside the visual (e.g., "Cmaj7 — 1st inversion").

### Exploration (secondary loop)
- The user must be able to pick a **key + scale** and see the **diatonic chords** that live in that scale (e.g., in C major: Cmaj, Dmin, Emin, Fmaj, Gmaj, Amin, Bdim).
- Each diatonic chord must be clickable, jumping the user into the lookup view for that chord.

### Shareable / bookmarkable state
- The current selection (chord or scale, root, quality, inversion, voicing) must be reflected in the URL, so any view can be bookmarked or revisited via a link.

## Account & auth
- **No accounts in MVP.** The tool is stateless and used by a single user (the builder). URL state replaces persistence.

## Data the product handles

These are conceptual entities, not database tables (that's stage 5).

- **Note** — one of 12 pitch classes (C, C#, D, D#, E, F, F#, G, G#, A, A#, B), optionally with octave when needed for rendering.
- **Chord** — composed of: root note, quality (maj, min, 7, etc.), inversion index, voicing index. Resolves to a set of notes.
- **Scale** — composed of: root note, scale type. Resolves to a set of notes.
- **Instrument layout** — a static description of how notes map to physical positions on each of the three instruments (piano keys, guitar fretboard positions, Push pad grid).

## Integrations

- **Chord/scale data source** — the product must produce correct notes for any selected chord (with inversions/voicings) or scale. This will be resolved in stage 4: third-party music theory library, custom algorithmic generation, or a static data file.
- No other third-party integrations required for MVP. No analytics, no email, no payments.

## Non-functional requirements

- **Performance**: View updates must feel instant (<100ms perceived latency) when the user changes a selection.
- **Scale**: Single user (the builder). No multi-user concerns.
- **Reliability**: No persistence, so reliability needs are minimal — just don't crash on a bad input.
- **Security**: No user data stored. No login. Standard web hygiene only.
- **Compliance**: None required (no personal data, no payments, no health data).
- **Device support**: Desktop browser is the primary target (since Push and instruments are typically used at a desk). Mobile-friendly is a nice-to-have, not a requirement.
- **Offline**: Not required for MVP. Web-only is fine.

## Out of scope for MVP

- **Reverse-lookup / translation loop** — clicking shapes on an instrument to identify the chord. Deferred to v1.1+.
- **Audio playback** — no MIDI output, no synthesized chord playback, no "click to hear it" button.
- **Hardware Push integration** — the Push view is purely visual; no MIDI sent to a real Push device.
- **Alternate guitar tunings** — drop D, DADGAD, open G, etc. Standard tuning only for MVP.
- **Other Push grid modes** — in-key mode, sequencer view. Chromatic mode only.
- **User accounts, favorites, saved chord lists, sharing/social features.**
- **Lessons, structured learning paths, progress tracking** — this is a reference/lookup tool, not a course.
- **Mobile-native apps** — web-only.
