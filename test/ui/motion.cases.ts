import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  squashFor,
  stretchFor,
  travelCurve,
  travelSpring,
  travelStiffness,
  STRETCH_KNEE,
  STRETCH_MAX,
  STRETCH_SQUASH,
  TAB_STRETCH_MAX,
  TRAVEL_PERIOD,
  TRAVEL_SAMPLES,
  TRAVEL_ZETA,
} from '../../src/ui/motion';

const near = (actual: number, expected: number, message?: string) => {
  assert.ok(Math.abs(actual - expected) < 0.02, message ?? `${actual} is not near ${expected}`);
};

/** The week strip on a 390 pt phone: 390 − 2×14, seven equal columns. */
const STRIP = 362;
const COLUMN = STRIP / 7;

test('the spring lives on the normalised progress, so a long jump is not a long animation', () => {
  // **0.67 s, and it is the owner's own slider reading** off the interactive prototype —
  // 0.40 → 0.55 → 0.67. A neighbouring day used to arrive in 208 ms and settle by 400; it
  // arrives in 429 and settles by 758 now, and an eleven-day jump takes 1275 ms, which is
  // the priced cost of a stately near step.
  assert.equal(TRAVEL_PERIOD, 0.67);
  assert.equal(TRAVEL_ZETA, 0.78);
  // Distance changes the stiffness and nothing else: quick next door, statelier far
  // away, and flat past a week so nothing can grow without bound.
  assert.equal(travelStiffness(1), 1);
  near(travelStiffness(4), 0.8);
  near(travelStiffness(7), 0.6);
  near(travelStiffness(70), 0.6, 'it does not keep falling');
  assert.equal(travelStiffness(-11), travelStiffness(11), 'direction is not distance');
  // **The spread is load-bearing, not decoration.** ω has to fall faster than the screen
  // distance grows, or a longer jump is *quicker* on the glass — which is the property
  // the whole points-not-days rule rests on. Eleven days is four columns against three
  // days' three, so the far multiplier must be under ¾ of the three-day one.
  assert.ok(travelStiffness(11) / travelStiffness(3) < 0.75, 'the far end falls faster than the distance grows');

  // `Animated.spring` integrates `mẍ = −kx − cẋ` at `mass = 1`, so the two numbers it
  // takes are exactly ω² and 2ζω — the same trajectory the curve below samples. If these
  // ever disagreed, the stretch table would describe a motion the spring is not making.
  const omega = (2 * Math.PI) / TRAVEL_PERIOD;
  const near1 = travelSpring(1);
  near(near1.stiffness, omega ** 2, 'stiffness is ω²');
  near(near1.damping, 2 * TRAVEL_ZETA * omega, 'damping is 2ζω');
  // Under-damped, or it would arrive without settling; nowhere near a bounce.
  const ratio = near1.damping / (2 * Math.sqrt(near1.stiffness));
  near(ratio, TRAVEL_ZETA);
  assert.ok(ratio < 1 && ratio > 0.7);
});

test('the stretch is a saturation on screen speed, not on speed in days', () => {
  assert.equal(STRETCH_MAX, 0.45);
  // **280, and it was 900.** The knee is a property of the speeds the motion actually
  // reaches, so it has to be re-derived whenever the spring moves — and it was not, twice.
  // At 900 a neighbouring day stretched 1.094, which on a 26 pt bead is 2.4 points: the
  // shape was never not stretching, it was stretching by nothing.
  assert.equal(STRETCH_KNEE, 280);
  assert.equal(STRETCH_SQUASH, 0.45);
  assert.equal(stretchFor(0), 1, 'a thing that is not moving is a circle');
  // The knee is where it has spent 1 − 1/e of its range, which is what makes a
  // neighbouring day and a fortnight away read as different rather than both maximal.
  near(stretchFor(STRETCH_KNEE), 1 + STRETCH_MAX * (1 - 1 / Math.E));
  // It approaches the cap and never passes it, at any speed a finger or a spring can
  // produce. The exponential reaches the limit exactly in binary long before that, which
  // is why the bound is inclusive: the property is «never wider», not «never quite».
  assert.ok(stretchFor(1e9) <= 1 + STRETCH_MAX, 'it saturates rather than growing');
  assert.ok(stretchFor(4000) < 1 + STRETCH_MAX, 'and at a real speed it is still short of it');
  assert.ok(stretchFor(4000) > 1 + STRETCH_MAX - 0.02);
  assert.equal(stretchFor(-500), stretchFor(500), 'backwards is not slower');
  // **One material, one stretch.** The plate carried 0.42 against the drop's 0.55, on the
  // reasoning that a wider object travelling further should stretch less for the same
  // speed. The owner watched both shapes move on a single slider and stopped at 0.45,
  // which is a stronger reading than the argument for keeping them apart.
  assert.equal(TAB_STRETCH_MAX, STRETCH_MAX);
  assert.equal(stretchFor(1200, TAB_STRETCH_MAX), stretchFor(1200));
  // The counter-squash reads as mass without becoming a pancake.
  assert.equal(squashFor(1), 1);
  near(squashFor(1.4), 1 - 0.4 * STRETCH_SQUASH);
  assert.ok(squashFor(1 + STRETCH_MAX) > 0.7);
});

test('the curve is a legal interpolation input at every distance, including nil', () => {
  assert.equal(TRAVEL_SAMPLES, 33);
  for (const [days, columns] of [[1, 1], [3, 3], [7, 0], [11, 4], [-1, -1], [-14, 0]] as const) {
    const curve = travelCurve({ distanceDays: days, screenDistance: columns * COLUMN });
    assert.equal(curve.progress.length, TRAVEL_SAMPLES, `${days}: sample count`);
    assert.equal(curve.stretch.length, TRAVEL_SAMPLES);
    assert.equal(curve.squash.length, TRAVEL_SAMPLES);
    // `interpolate` refuses anything that is not strictly increasing, and a short
    // journey is exactly where repeated samples would otherwise appear.
    for (let index = 1; index < curve.progress.length; index += 1) {
      assert.ok(curve.progress[index] > curve.progress[index - 1], `${days}: sample ${index} must increase`);
    }
    assert.equal(curve.progress[0], 0, `${days}: starts at rest`);
    assert.equal(curve.progress[TRAVEL_SAMPLES - 1], 1, `${days}: ends where the spring does`);
    // Both ends are round. A drop that landed stretched would be a drop that never
    // stopped, and the last sample is what the interpolation clamps to afterwards.
    assert.equal(curve.stretch[0], 1, `${days}: leaves round`);
    assert.equal(curve.stretch[TRAVEL_SAMPLES - 1], 1, `${days}: lands round`);
    assert.equal(curve.squash[TRAVEL_SAMPLES - 1], 1);
    // The squash is the stretch's own counterpart at every sample, so the body can
    // never be seen to gain area.
    curve.stretch.forEach((value, index) => near(curve.squash[index], squashFor(value), `${days}: sample ${index}`));
  }
});

test('the measured journeys are the ones the package is accountable to', () => {
  const journey = (days: number, columns: number) => {
    const curve = travelCurve({ distanceDays: days, screenDistance: columns * COLUMN });
    return { peak: curve.peak, stretch: Math.max(...curve.stretch) };
  };
  // **All four fell again with the period on 2026-08-05**, and they are the figures the
  // owner's own spring is accountable to. A neighbouring day peaked around 446 pt/s at the
  // original 0.40 s and 256 at 0.55.
  // One day: one column of travel, and the stretch is now a hint rather than a smear.
  const one = journey(1, 1);
  assert.ok(one.peak > 180 && one.peak < 250, `one day peaks at ${Math.round(one.peak)} pt/s`);
  // **A neighbouring day has to be visibly a drop and not a puck.** 1.24 is 6.2 points on
  // a 26 pt bead; the 1.09 this replaces was 2.4, which is what «просто статично едет»
  // was describing.
  near(one.stretch, 1.24);
  assert.ok(one.stretch > 1.15, 'a one-day step is the commonest journey and must be seen to stretch');
  // Three days: three columns, and the stretch is well up but still short of its cap.
  const three = journey(3, 3);
  assert.ok(three.peak > 480 && three.peak < 600, `three days peaks at ${Math.round(three.peak)} pt/s`);
  near(three.stretch, 1.39);
  assert.ok(three.stretch < 1 + STRETCH_MAX, 'never pinned at the maximum');
  // **Exactly a week moves the drop nowhere**, because the same weekday is the same
  // column and the strip pages under it. It is the one jump the drop does not narrate,
  // and it is a fact about the geometry rather than a special case in the code.
  const week = journey(7, 0);
  assert.equal(week.peak, 0);
  assert.equal(week.stretch, 1);
  // Eleven days is four columns, so it is *slower on the glass* than three days even
  // though it is far longer in the calendar. That is the whole reason the stretch is
  // stated in points and not in days.
  // **This is the assertion that caught the slowing.** At the first pass the stiffness
  // spread was narrowed to 1.00 → 0.72 and eleven days peaked *above* three, which made
  // the sentence below simply untrue. The far end was widened to 0.60 until it held.
  const eleven = journey(11, 4);
  assert.ok(eleven.peak < three.peak, 'further in days, gentler on screen');
  near(eleven.stretch, 1.38);
});

test('a release carries the finger’s own speed into the spring', () => {
  const still = travelCurve({ distanceDays: 1, screenDistance: COLUMN });
  const flicked = travelCurve({ distanceDays: 1, screenDistance: COLUMN, velocity: 6 });
  // A flick starts fast, so its first sample is already stretched where a slow release
  // leaves round. Without this a hurried swipe and a laboured one would let go alike.
  assert.equal(still.stretch[1] > 1, true);
  assert.ok(flicked.peak > still.peak, 'the flick is quicker across the glass');
  assert.ok(flicked.stretch[1] > still.stretch[1], 'and shows it from the first frame');
  // It is still a legal input range, which is the thing a carried velocity could break.
  for (let index = 1; index < flicked.progress.length; index += 1) {
    assert.ok(flicked.progress[index] > flicked.progress[index - 1]);
  }
});

test('the type chooser is the travel model’s third reader, and adds no constant', () => {
  const segment = readFileSync('src/ui/components/travelling-segment.tsx', 'utf8');
  // Owner instruction, 2026-08-06: the Task/Habit selection travels rather than
  // switching. It is **not** a third animation — the date drop and the tab bar's plate
  // are already this model's readers, and this is the third.
  assert.match(segment, /travelCurve|travelSpring/);
  assert.match(segment, /travelSpring\(1\)/, 'a segment always moves exactly one slot');
  assert.doesNotMatch(segment, /const [A-Z_]+ = 0\.\d/, 'no motion constant of its own');

  // **The measured journey**, so the numbers this package is accountable to are written
  // down rather than described. A 390 pt screen, 20 pt margins, 3 pt track padding and a
  // 6 pt gap put a slot at 169 and the travel at 175.
  const travel = (390 - 40 - 6 - 6) / 2 + 6;
  assert.equal(Math.round(travel), 175);
  const drop = travelCurve({ distanceDays: 1, screenDistance: travel });
  near(drop.peak / 100, 7.11, 'the drop peaks near 711 pt/s');
  // The peak of the table, not a sample in the middle of it: the stretch tops out where
  // the velocity does, and where that lands among 33 samples is the spring's business.
  near(Math.max(...drop.stretch), 1.41, 'and stretches to about x1.41');
  assert.ok(Math.max(...drop.stretch) < 1 + STRETCH_MAX, 'never pinned at the maximum');

  // **It is the longest single-step journey in the application**, and that is the whole
  // of the open question: the tab bar's plate also always moves one step, on the same
  // `STRETCH_MAX`, and reaches x1.32 — a value already looked at on the prototype and
  // kept. The segment's slot is twice as wide, so the same constant buys more stretch.
  //
  // `STRETCH_MAX` was therefore left alone rather than tuned from here: one material,
  // one stretch, and whether x1.41 reads as mass or as a smear is a device finding. If
  // it is a smear, `travelCurve` already takes `max`, and 0.26 is the value that would
  // give this distance the same reading a one-day date step gets.
  const tab = travelCurve({ distanceDays: 1, screenDistance: (390 - 40) / 4 });
  near(Math.max(...tab.stretch), 1.32, 'the tab plate, on the same constant');
  assert.ok(tab.peak < drop.peak, 'the segment is the longer of the two one-step journeys');
  const asDateStep = travelCurve({ distanceDays: 1, screenDistance: travel, max: 0.26 });
  near(Math.max(...asDateStep.stretch), 1.24, 'and 0.26 is what would match a one-day date step');
});

test('the travelling drop is glass with an edge, and Reduce Motion keeps none of it', () => {
  const segment = readFileSync('src/ui/components/travelling-segment.tsx', 'utf8');
  // `structGlass` plus a hairline, exactly as the header's bead is built
  // (PD-PLATE-019). The hairline is load-bearing: a translucent region without an edge
  // reads as a rendering artefact rather than as the selection.
  assert.match(segment, /backgroundColor: theme\.today\.structGlass/);
  assert.match(segment, /borderColor: theme\.today\.hairline/);
  assert.match(segment, /borderWidth: StyleSheet\.hairlineWidth/);
  // Reduce Motion commits in one frame — the drop is where it belongs, it never travelled.
  assert.match(segment, /if \(reduceMotion\) \{[\s\S]{0,80}progress\.setValue\(1\)/);
  // The width is measured, never reconstructed from the screen less its margins.
  assert.match(segment, /onLayout=\{measure\}/);
  assert.match(segment, /event\.nativeEvent\.layout\.width/);
  // The roles do not move: the animation is not something VoiceOver should hear about,
  // because it already announces which tab is selected.
  assert.match(segment, /accessibilityRole="tablist"/);
  assert.match(segment, /accessibilityRole="tab"/);
  assert.match(segment, /accessibilityState=\{\{ disabled, selected \}\}/);
  // Painted **before** the slots so the slots paint over it. Lifting a bead over its own
  // labels with `zIndex` is the defect that made the date selection read as a flat fill
  // for a whole package.
  assert.ok(segment.indexOf('styles.drop') < segment.indexOf('slots.map'), 'the drop is written first');
  // Anchored to a declaration rather than to the word, which survives in the comment
  // recording why it is not used.
  assert.doesNotMatch(segment, /zIndex:/);
});
