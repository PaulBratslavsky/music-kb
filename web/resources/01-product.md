# TriadView

> Working name — change anytime.

## One-liner
A visual learning tool that shows the same chord, scale, or note simultaneously across a piano keyboard, a guitar fretboard, and the Ableton Push chromatic grid — so musicians can translate musical ideas between instruments at a glance.

## The problem
Musicians who play one instrument well often freeze when sitting down at another. A guitar player knows Cmaj7 by shape but can't find it on Push's chromatic grid. A piano player knows scale fingerings but can't see where the same scale lives on a fretboard. Each instrument has a totally different physical layout (piano is linear; guitar is mostly tuned in fourths; Push is a chromatic grid in fourths vertically), so the same musical idea looks completely different on each. There's no easy way to *see* a chord or scale on all three at once and learn how the shapes map between them.

## The value
Look up any chord, scale, or note once and instantly see it on all three instruments — including chord variations (maj, min, 7, maj7, sus, dim, etc.), inversions, and voicings. Use it as a quick reference when you're stuck mid-practice, or as a learning tool to internalize how shapes translate between instruments over time. The goal is to make the three instruments feel interchangeable, so you can play whatever's in front of you.

## Product category
Learning / reference tool. Initially a single-user practice aid; potentially shareable with other learners later.

## Scope (MVP-level)
- **Chords**: all common qualities (maj, min, dom7, maj7, min7, dim, aug, sus2, sus4, etc.) across all 12 root notes, plus inversions and multiple voicings.
- **Scales**: major, minor (natural/harmonic/melodic), modes, pentatonic, blues — across all 12 keys.
- **Single notes / intervals**: click a note, see exactly where it sits on each instrument.
- **Three instrument views**, always visible side-by-side or toggleable: piano keyboard, guitar fretboard (standard tuning to start), Ableton Push (chromatic grid in fourths).

## What success looks like
A year in:
- The builder (you) sits down at piano, guitar, or Push and feels comfortable on any of them — the tool got you fluent across instruments.
- Other learners — bedroom producers, guitarists curious about Push, pianists learning fretboard — use it as their go-to cross-instrument chord and scale reference.
- It's the thing you open *first* when you're stuck on "how do I play this on [other instrument]?"

## Parked for later stages
- **Chord data source** (stage 4/5): third-party music theory API vs. static chord library vs. algorithmic generation from scale + root + quality. Decide based on coverage, latency, and offline needs.
- **Alternate guitar tunings** (drop D, DADGAD, etc.) — likely v2.
- **Other Push grid layouts** (in-key mode, sequencer mode) — chromatic mode is the MVP target.
