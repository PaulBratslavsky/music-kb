import { describe, expect, it } from 'vitest';
import {
  aggregateSignalScore,
  computeCompressionRatio,
  computeFillerDensity,
  computeLexicalDensity,
  computeSignalScores,
  computeSpeakingPace,
  computeSponsorPresence,
  SIGNAL_WEIGHTS,
  type SignalScores,
} from './content-signals';

// ---------------------------------------------------------------------------
// computeFillerDensity
// ---------------------------------------------------------------------------

describe('computeFillerDensity', () => {
  it('returns 100 for filler-free text', () => {
    const text =
      'The transcript discusses three key concepts that the speaker presents in sequence.';
    expect(computeFillerDensity(text)).toBe(100);
  });

  it('drops the score as filler density rises', () => {
    // Use longer fixtures — the metric is calibrated against typical
    // 200+ word transcripts where 1–3% filler is normal and 10%+ is
    // pathological. Tiny fixtures saturate the score in either direction.
    const cleanProse = (
      'The speaker walks through the architecture of a distributed system, ' +
      'covers the trade-offs of consensus protocols, explains how Byzantine fault ' +
      'tolerance works in practice, gives concrete examples from production ' +
      'deployments at major cloud providers, and closes with practical advice ' +
      'on when to use Raft versus Paxos. Each section includes specific code ' +
      'samples and benchmarks measured under realistic load.'
    );
    const lightFiller = cleanProse + ' Um, basically that is the core idea.';
    const heavyFiller =
      cleanProse +
      ' Um basically you know the speaker uh kind of you know walks ' +
      'through um basically the kind of you know architecture you know ' +
      'um basically literally the kind of you know thing you know um.';
    const cleanScore = computeFillerDensity(cleanProse);
    const lightScore = computeFillerDensity(lightFiller);
    const heavyScore = computeFillerDensity(heavyFiller);
    expect(cleanScore).toBeGreaterThan(lightScore);
    expect(lightScore).toBeGreaterThan(heavyScore);
  });

  it('returns 0 for empty input', () => {
    expect(computeFillerDensity('')).toBe(0);
  });

  it('clamps at 0 for pathologically high filler density', () => {
    const allFiller = 'um uh um uh um uh um uh um uh';
    expect(computeFillerDensity(allFiller)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// computeLexicalDensity
// ---------------------------------------------------------------------------

describe('computeLexicalDensity', () => {
  it('scores higher for content-word-rich text', () => {
    const dense =
      'distributed-systems consensus algorithms leverage Byzantine fault tolerance to ensure reliable replication';
    const sparse =
      'so the the the and to a of in for is it on with at by from this that these those';
    expect(computeLexicalDensity(dense)).toBeGreaterThan(
      computeLexicalDensity(sparse),
    );
  });

  it('returns 0 for empty input', () => {
    expect(computeLexicalDensity('')).toBe(0);
  });

  it('clamps at 0 for all-stopwords text', () => {
    expect(computeLexicalDensity('the and of in for is it on with at by')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// computeCompressionRatio
// ---------------------------------------------------------------------------

describe('computeCompressionRatio', () => {
  it('scores lower for repetitive text (compresses tightly)', () => {
    const repetitive = 'banana '.repeat(200);
    const varied =
      'The migration of the production database revealed unexpected interactions ' +
      'between concurrent connections, schema constraints, and the ORM layer that had ' +
      'been masking inconsistencies for several quarters before someone finally noticed.';
    const repetitiveScore = computeCompressionRatio(repetitive);
    const variedScore = computeCompressionRatio(
      varied + ' ' + varied.split('').reverse().join(''),
    );
    expect(repetitiveScore).toBeLessThan(variedScore);
  });

  it('returns 0 for tiny input (<100 chars)', () => {
    expect(computeCompressionRatio('too short')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// computeSpeakingPace
// ---------------------------------------------------------------------------

describe('computeSpeakingPace', () => {
  it('scores 100 inside the natural band (130–160 wpm)', () => {
    expect(computeSpeakingPace(900, 360)).toBe(100); // 150 wpm
    expect(computeSpeakingPace(780, 360)).toBe(100); // 130 wpm
    expect(computeSpeakingPace(960, 360)).toBe(100); // 160 wpm
  });

  it('drops the score for slow pace (<130 wpm)', () => {
    expect(computeSpeakingPace(500, 360)).toBeLessThan(100); // ~83 wpm
  });

  it('drops the score for fast pace (>160 wpm)', () => {
    expect(computeSpeakingPace(1200, 360)).toBeLessThan(100); // 200 wpm
  });

  it('returns a neutral 50 when duration is missing or too short', () => {
    expect(computeSpeakingPace(500, null)).toBe(50);
    expect(computeSpeakingPace(500, 10)).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// computeSponsorPresence
// ---------------------------------------------------------------------------

describe('computeSponsorPresence', () => {
  it('returns 100 for text with no sponsor language', () => {
    const text =
      'The speaker walks through the design of a distributed key-value store and the trade-offs of strong vs eventual consistency.';
    expect(computeSponsorPresence(text)).toBe(100);
  });

  it('drops the score when a sponsor read is detected', () => {
    const text =
      "Today's video is brought to you by Acme. Use code SPEAKER for 10% off. " +
      'Now back to the actual content of the video.';
    expect(computeSponsorPresence(text)).toBeLessThan(100);
  });

  it('drops further with multiple sponsor markers', () => {
    const text =
      "Sponsored by Acme. Use code SPEAKER. Sign up at example.com. " +
      "Today's sponsor is Acme as well. Check out their affiliate link.";
    expect(computeSponsorPresence(text)).toBeLessThan(20);
  });

  it('returns 100 for empty input', () => {
    expect(computeSponsorPresence('')).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// computeSignalScores + aggregateSignalScore
// ---------------------------------------------------------------------------

describe('computeSignalScores', () => {
  it('returns all five sub-metrics in 0–100 range', () => {
    const result = computeSignalScores({
      rawText:
        'This is a clear, focused explanation of how distributed systems handle consensus, with concrete examples drawn from production deployments at scale.',
      cleanedText:
        'This is a clear, focused explanation of how distributed systems handle consensus, with concrete examples drawn from production deployments at scale.',
      wordCount: 23,
      durationSec: 9, // ~150 wpm
    });
    for (const value of Object.values(result)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });
});

// ---------------------------------------------------------------------------
// End-to-end pipeline check (the path the per-video Generate-score
// button + the bulk backfill both go through). Verifies that the
// composition of all signal functions + aggregator produces
// meaningful, distinguishable scores for realistic input shapes.
// ---------------------------------------------------------------------------

describe('computeSignalScores + aggregateSignalScore (end-to-end)', () => {
  // Realistic talking-head video, ~10 minutes, dense + specific.
  // Every sentence carries technical claims; minimal filler; no
  // sponsor language. This is a "worth_it" tier transcript by
  // construction.
  const HIGH_QUALITY = (
    'In this video we walk through the design of a distributed key-value ' +
    'store that uses Raft for consensus, examines why leader rotation ' +
    'matters for write throughput, and benchmarks three configurations ' +
    'against the same workload. The first configuration uses a single ' +
    'replica per region, which trades availability for latency. The ' +
    'second uses three replicas with quorum reads, doubling tail ' +
    'latency at the 99th percentile but eliminating split-brain ' +
    'scenarios. The third uses leaderless replication via Hermes, which ' +
    'sidesteps the consensus bottleneck entirely at the cost of more ' +
    'complex reconciliation logic. We measure throughput, p50 / p99 ' +
    'latency, and recovery time after a forced partition. The data ' +
    'shows that quorum reads are actually faster than the single-replica ' +
    'config for read-heavy workloads beyond a certain QPS threshold, ' +
    'because the single-replica config saturates its CPU on serialization ' +
    'before the quorum config saturates its network. We close with ' +
    'specific tuning recommendations: fsync intervals, snapshot cadence, ' +
    'and which workloads benefit from which configuration.'
  );

  // Filler-heavy, sponsor-laden video padded with repetition. This is
  // the kind of content the signal score should down-rank.
  const LOW_QUALITY = (
    'Hey guys welcome back to the channel, um you know basically today ' +
    "we're going to talk about, uh, you know, a really cool topic. " +
    "So basically, um, like I said, this is going to be um basically " +
    "you know really really helpful for you. But first, today's video " +
    'is brought to you by Acme. Use code SPEAKER for 10% off. Sign up ' +
    'at example.com today. So basically um you know what we want to ' +
    'talk about today is um basically you know how to do the thing. ' +
    "Um you know like I said, um basically the thing is um you know " +
    "really important. Sponsored by Acme as well today. " +
    "Um basically the thing is um basically the thing is um basically " +
    "the thing is um you know basically the thing is the thing. " +
    "And basically you know that's basically what I wanted to say um " +
    "basically. Check out our affiliate link, today's sponsor is Acme. " +
    "Um you know basically that's the video, um basically thanks for " +
    "watching."
  );

  it('produces all five sub-metrics in 0–100 range for high-quality input', () => {
    const scores = computeSignalScores({
      rawText: HIGH_QUALITY,
      cleanedText: HIGH_QUALITY,
      wordCount: 200, // ~length, doesn't have to be exact
      durationSec: 80, // → ~150 wpm
    });
    for (const value of Object.values(scores)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });

  it('high-quality transcript composite > low-quality transcript composite', () => {
    const highWords = (HIGH_QUALITY.match(/\b[\w'-]+\b/g) ?? []).length;
    const lowWords = (LOW_QUALITY.match(/\b[\w'-]+\b/g) ?? []).length;
    const high = aggregateSignalScore(
      computeSignalScores({
        rawText: HIGH_QUALITY,
        cleanedText: HIGH_QUALITY,
        wordCount: highWords,
        durationSec: highWords / 2.5, // ~150 wpm — natural speech
      }),
    );
    const low = aggregateSignalScore(
      computeSignalScores({
        rawText: LOW_QUALITY,
        cleanedText: LOW_QUALITY,
        wordCount: lowWords,
        durationSec: lowWords / 2.5,
      }),
    );
    expect(high).toBeGreaterThan(low);
    // Honest range expectations: high should be solidly in the upper
    // range; low should be visibly down-ranked. The exact gap depends
    // on weight tuning — keeping the bounds loose so weight tweaks
    // don't reflexively break the test.
    expect(high).toBeGreaterThan(60);
    expect(low).toBeLessThan(55);
    expect(high - low).toBeGreaterThan(15);
  });

  it('flags heavy-filler input via fillerDensity dropping', () => {
    const lowWords = (LOW_QUALITY.match(/\b[\w'-]+\b/g) ?? []).length;
    const scores = computeSignalScores({
      rawText: LOW_QUALITY,
      cleanedText: LOW_QUALITY,
      wordCount: lowWords,
      durationSec: lowWords / 2.5,
    });
    expect(scores.fillerDensity).toBeLessThan(50);
  });

  it('flags sponsor-laden input via sponsorPresence dropping', () => {
    const lowWords = (LOW_QUALITY.match(/\b[\w'-]+\b/g) ?? []).length;
    const scores = computeSignalScores({
      rawText: LOW_QUALITY,
      cleanedText: LOW_QUALITY,
      wordCount: lowWords,
      durationSec: lowWords / 2.5,
    });
    expect(scores.sponsorPresence).toBeLessThan(50);
  });

  it('reproducibly returns the same score for the same input', () => {
    // Determinism is the whole point of the programmatic path. Two
    // identical calls must produce byte-identical sub-scores +
    // composite, regardless of when they run.
    const input = {
      rawText: HIGH_QUALITY,
      cleanedText: HIGH_QUALITY,
      wordCount: 200,
      durationSec: 80,
    };
    const a = computeSignalScores(input);
    const b = computeSignalScores(input);
    expect(a).toEqual(b);
    expect(aggregateSignalScore(a)).toBe(aggregateSignalScore(b));
  });
});

describe('aggregateSignalScore', () => {
  it('returns a weighted average of the sub-scores', () => {
    const all100: SignalScores = {
      fillerDensity: 100,
      lexicalDensity: 100,
      compressionRatio: 100,
      speakingPace: 100,
      sponsorPresence: 100,
    };
    expect(aggregateSignalScore(all100)).toBe(100);

    const all0: SignalScores = {
      fillerDensity: 0,
      lexicalDensity: 0,
      compressionRatio: 0,
      speakingPace: 0,
      sponsorPresence: 0,
    };
    expect(aggregateSignalScore(all0)).toBe(0);
  });

  it("respects each signal's declared weight", () => {
    // Mix where only fillerDensity is 100, others 0. Result should equal
    // round(SIGNAL_WEIGHTS.fillerDensity * 100).
    const onlyFiller: SignalScores = {
      fillerDensity: 100,
      lexicalDensity: 0,
      compressionRatio: 0,
      speakingPace: 0,
      sponsorPresence: 0,
    };
    expect(aggregateSignalScore(onlyFiller)).toBe(
      Math.round(SIGNAL_WEIGHTS.fillerDensity * 100),
    );
  });

  it('clamps to 0–100', () => {
    // Should never produce values outside [0,100] for valid inputs.
    const mid: SignalScores = {
      fillerDensity: 50,
      lexicalDensity: 50,
      compressionRatio: 50,
      speakingPace: 50,
      sponsorPresence: 50,
    };
    const result = aggregateSignalScore(mid);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(100);
  });
});
