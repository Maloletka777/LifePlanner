/**
 * The one travel model, and both surfaces that travel read it.
 *
 * It lives in `src/ui` rather than beside Today because the date drop and the tab bar's
 * plate are the *same* movement in two places (owner instruction, 2026-08-05), and a
 * shared motion is shared presentation — 301 UI's, not Planner's. The alternative was the
 * app shell importing a planner model to draw its own chrome, which couples the whole
 * navigation layer to one module for the sake of two springs.
 *
 * Nothing here touches React. It is arithmetic over a spring, so it can be asserted
 * without rendering anything, and it is asserted.
 */

/**
 * The travel spring, in the two numbers `Animated.spring` actually takes.
 *
 * Period 0.67 s and damping ratio 0.78 — an overshoot of about 3 %, which on a
 * neighbouring day is a point and a half: the drop *settles* rather than stopping dead.
 * `Animated.spring` integrates `mẍ = −kx − cẋ` with `mass = 1`, so `k = ω²` and
 * `c = 2ζω` describe exactly the trajectory `travelCurve` samples below. That
 * agreement is the whole point — the stretch table would otherwise describe a motion the
 * spring is not making.
 *
 * **0.40 → 0.55 → 0.67**, and the last step is the owner's own reading off the
 * interactive prototype rather than a value proposed here: they moved the slider and
 * stopped at 0.67. A neighbouring day *arrived* in 208 ms at 0.40 and had settled by 400;
 * it arrives in **429 ms** now and settles by **758**. Every figure is integrated from the
 * spring at 240 Hz rather than estimated. **A long jump is now over a second** — eleven
 * days settles at 1275 ms — which is the priced cost of a stately near step. **One number moves both surfaces**, because the drop and the tab
 * bar's plate are the same movement by decision — nothing on either is timed separately.
 */
export const TRAVEL_PERIOD = 0.67;
export const TRAVEL_ZETA = 0.78;
const TRAVEL_OMEGA = (2 * Math.PI) / TRAVEL_PERIOD;

/**
 * Distance changes the stiffness and nothing else: `1.00` at one day, falling to `0.60`
 * at seven and staying there. A neighbouring day settles in 758 ms and an eleven-day
 * jump in 1275 ms — statelier, not proportional. **Re-measured at the longer period and
 * the spread still holds**: eleven days peaks at 502 pt/s against three days' 545.
 *
 * The pair fell with the period rather than staying at 1.25/0.80: the multiplier scales
 * ω, so leaving it would have taken back a third of the slowing on exactly the journey
 * the complaint was about — the one-day step, which is the one a person makes all day.
 *
 * **And the far end had to fall further than the near one, which a test caught rather
 * than a person.** The spread is what keeps the model's own stated property true: eleven
 * days is four columns against three days' three, so if ω does not fall faster than the
 * distance grows, a longer jump becomes *quicker on the glass* — and «further in days,
 * gentler on screen» is the entire reason the stretch is stated in points rather than in
 * days. At the first pass, 1.00 → 0.72, eleven days peaked at 735 pt/s against three
 * days' 695 and the property was simply false. At 0.60 it is 613 against 665, an 8 %
 * margin, and the assertion that holds it was already in the suite.
 */
export function travelStiffness(distanceDays: number): number {
  const distance = Math.abs(distanceDays);
  return 1.00 - 0.40 * Math.min(1, Math.max(0, distance - 1) / 6);
}

export interface TravelSpring {
  readonly stiffness: number;
  readonly damping: number;
}

export function travelSpring(distanceDays: number): TravelSpring {
  const omega = TRAVEL_OMEGA * travelStiffness(distanceDays);
  return Object.freeze({ damping: 2 * TRAVEL_ZETA * omega, stiffness: omega * omega });
}

/**
 * How far the drop stretches, from **the speed it crosses the glass at** — not from the
 * speed it crosses the calendar at.
 *
 * The two differ, and the difference is the whole reason this is stated in points. On a
 * jump across a week the strip pages underneath, so in days the drop is flying and on
 * screen it is walking; driven by the day-speed it would pin at its maximum for the whole
 * flight and read as a permanently smeared blob. Saturating on `pt/s` gives ×1.22 to a
 * neighbouring day and ×1.40 to a long jump, which is the difference the eye is actually
 * being told about.
 */
/**
 * **One stretch for both travelling shapes, and it is the owner's own number.**
 *
 * The drop carried 0.55 and the tab plate 0.42, on the reasoning that a wider object
 * travelling further should stretch less for the same speed. The prototype put **one**
 * slider on both shapes and the owner stopped at **0.45**, having watched them move
 * together — which is a stronger reading than the argument for keeping them apart, since
 * the two are meant to be one material. `TAB_STRETCH_MAX` survives as a separate name
 * because callers pass it, and it now holds the same value.
 */
export const STRETCH_MAX = 0.45;
/**
 * Where the stretch has spent 1 − 1/e of its range — **and it was calibrated for a spring
 * that no longer exists.**
 *
 * 900 pt/s was right when the period was 0.40 s and a neighbouring day peaked at 446. The
 * period has since gone to 0.55 and then to 0.67, and a day now peaks at **210** — which
 * against a 900 knee is a stretch of **1.094**, or 2.4 points on a 26 pt bead. That is
 * invisible, and «просто статично едет на дату» is the accurate report of it: the
 * shape was never not stretching, it was stretching by nothing.
 *
 * At **280** the same day gives 1.237 — 6.2 points — and a long jump 1.375. The knee is a
 * property of the *speeds the motion reaches*, so it has to be re-derived whenever the
 * spring moves, and it was not.
 */
export const STRETCH_KNEE = 280;
/** The counter-squash, at 45 % of the stretch: enough to read as mass, short of a pancake. */
export const STRETCH_SQUASH = 0.45;
/** Held at the same value: one material, one stretch. See `STRETCH_MAX` above. */
export const TAB_STRETCH_MAX = 0.45;

export function stretchFor(pointsPerSecond: number, max = STRETCH_MAX): number {
  return 1 + max * (1 - Math.exp(-Math.abs(pointsPerSecond) / STRETCH_KNEE));
}

export function squashFor(stretch: number): number {
  return 1 - (stretch - 1) * STRETCH_SQUASH;
}

/**
 * The stretch, sampled against progress so that it can be an **interpolation**.
 *
 * Stretch is a function of velocity and velocity is the derivative of progress, which no
 * `Animated` graph can take. So the same spring is integrated here, once per transition,
 * and handed to `interpolate` as an input/output pair — the trick the metaball already
 * used for its radii, and the reason none of this ever leaves the UI thread. Thirty-three
 * exponentials per date change is not a cost worth naming.
 *
 * Only the **rising limb** is sampled, up to the first arrival at 1. `interpolate` needs a
 * strictly increasing input range and the 3 % overshoot past it is not increasing; it is
 * also travelling slowly enough that its stretch is 1 to two decimal places, so clamping
 * there loses nothing.
 */
export const TRAVEL_SAMPLES = 33;

export interface TravelCurve {
  readonly progress: readonly number[];
  readonly stretch: readonly number[];
  readonly squash: readonly number[];
  /** The fastest the drop goes on this journey, in points per second. Reported, not drawn. */
  readonly peak: number;
}

export function travelCurve({ distanceDays, screenDistance, velocity = 0, max = STRETCH_MAX }: {
  readonly distanceDays: number;
  /** How far the object moves **on screen**, in points, over the whole transition. */
  readonly screenDistance: number;
  /** Progress per second the transition inherits from a finger, for a release that carries on. */
  readonly velocity?: number;
  readonly max?: number;
}): TravelCurve {
  const { damping, stiffness } = travelSpring(distanceDays);
  const step = 1 / 240;
  const rising: { p: number; v: number }[] = [{ p: 0, v: Math.abs(velocity) }];
  let p = 0;
  let v = velocity;
  // Integrated at 240 Hz rather than at the display's rate: the table describes the
  // spring, and a table that changed with the refresh rate would not.
  for (let index = 0; index < 2400 && p < 1; index += 1) {
    v += (-stiffness * (p - 1) - damping * v) * step;
    p += v * step;
    if (p >= 1) break;
    rising.push({ p, v: Math.abs(v) });
  }
  const progress: number[] = [];
  const stretch: number[] = [];
  const squash: number[] = [];
  let peak = 0;
  for (let index = 0; index < TRAVEL_SAMPLES; index += 1) {
    const at = index / (TRAVEL_SAMPLES - 1);
    const sample = rising[Math.min(rising.length - 1, Math.round(at * (rising.length - 1)))];
    // Strictly increasing, because `interpolate` refuses anything else: a repeated
    // sample — which a short journey can produce — is nudged past its predecessor.
    const previous = progress[progress.length - 1];
    const value = previous === undefined ? sample.p : Math.max(sample.p, previous + 1e-6);
    const speed = Math.abs(sample.v) * Math.abs(screenDistance);
    const grown = stretchFor(speed, max);
    peak = Math.max(peak, speed);
    progress.push(index === TRAVEL_SAMPLES - 1 ? Math.max(1, value) : value);
    stretch.push(index === TRAVEL_SAMPLES - 1 ? 1 : grown);
    squash.push(index === TRAVEL_SAMPLES - 1 ? 1 : squashFor(grown));
  }
  return Object.freeze({
    peak,
    progress: Object.freeze(progress),
    squash: Object.freeze(squash),
    stretch: Object.freeze(stretch),
  });
}
