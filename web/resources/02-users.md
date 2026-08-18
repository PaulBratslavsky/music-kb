# Users & Usage

## Personas

### Persona 1 — The multi-instrumentalist learner (the builder, primary persona)
- **Background**: Plays one instrument with reasonable comfort (guitar, piano, or Push), wants to get fluent on the other two. Owns or has access to all three.
- **Current workaround**: Googles chord diagrams per instrument one at a time, watches YouTube tutorials, mentally tries to translate shapes between instruments — slow and error-prone.
- **Tech comfort**: High. Comfortable with web apps, music software, Ableton.

### Persona 2 — The bedroom producer with Push
- **Background**: Owns an Ableton Push, makes music in Ableton Live. Push's chromatic grid is intimidating; usually leans on in-key mode or programs notes one at a time. Knows some piano or guitar.
- **Current workaround**: Uses Push's in-key mode to dodge the chromatic layout, or builds chords by clicking notes in the Ableton piano roll instead of playing them on Push.
- **Tech comfort**: High.

### Persona 3 — The single-instrument player branching out
- **Background**: A guitarist curious about keys, or a pianist curious about fretboard. Knows chord *names* and theory from their main instrument but is a beginner on the other.
- **Current workaround**: Chord-finder websites (one instrument at a time), beginner books, trial and error.
- **Tech comfort**: Medium to high.

## Jobs-to-be-done

- When **practicing on a less-familiar instrument** and stuck on how to play a chord they know, the multi-instrumentalist wants to **look up the chord and see it on all three layouts at once**, so they can play it immediately and start to internalize the shape.
- When **producing in Ableton and reaching for a chord on Push**, the bedroom producer wants to **see exactly which pads to hit for a named chord**, so they can keep their flow without switching to the piano roll.
- When **studying a key or scale**, the learner wants to **see which chords live in that scale and what they look like on each instrument**, so they can understand the relationship between scale and chord shapes.
- When **learning over time**, the learner wants to **revisit the same chords across instruments repeatedly**, so the shapes become muscle memory rather than lookups.

## Primary user journey

1. **Discovery**: Learner is mid-practice (or mid-production) and gets stuck — they know a chord on one instrument but can't play it on another. They open the tool.
2. **First use**: They type or select a chord name (e.g., "Cmaj7"). All three instrument views render the chord simultaneously — piano keys highlighted, guitar fretboard dots, Push pads lit.
3. **Aha moment**: They pick a chord they already know cold on one instrument (e.g., Cmaj on guitar), watch the same notes appear on the piano and Push grid, and realize the instruments are just different physical layouts of the same notes. The instruments stop feeling like separate worlds.
4. **Ongoing use**: They keep the tool open during practice or production sessions. Each time they hit a "how do I play this on X?" moment, they look it up, play it, move on. Over weeks, the lookups happen less because the shapes are becoming familiar.

## Core loop (MVP — Lookup)

**The repeated action**: Pick a chord (or scale, or single note) → see it rendered simultaneously on the piano keyboard, guitar fretboard, and Push grid → optionally cycle through inversions or voicings → play it on whichever instrument is in front of you.

**What pulls users back**: Every practice or production session generates new "I don't know how to play this on X" moments. The tool stays open as a sidekick.

## Secondary loops (also MVP, but lookup is the front door)

- **Exploration loop**: Pick a key + scale → browse the diatonic chords inside it → click any chord to see its three-instrument view. Useful for songwriting and understanding key relationships.

## Deferred loops (post-MVP)

- **Translation loop (reverse-lookup)**: Tap notes on one instrument view → tool identifies the chord and shows the equivalents on the other two. Genuinely harder (one guitar shape can map to multiple chord names), so deferred to v1.1 or v2.

## Not in scope for MVP

- Reverse-lookup (translation loop) — deferred.
- Recording, MIDI playback, audio output — this is a visual tool, not an instrument simulator.
- Direct integration with Ableton Push hardware (the Push view is a *visual representation*, not a hardware controller).
- User accounts, saving favorites, sharing — possibly v1.1.
