import type { ImportanceLevel } from '../domain';

import { IMPORTANCE_STOPS } from './planner-form-control-model';

/*
 * `PRIORITY_TRACK_BANDS` and `mixHexColors` are **deleted with the gradient they drew.**
 *
 * Twenty-four bands walked from the low ink to the alarm, which read as a continuous
 * severity scale — and there is no such scale. The plate draws **three** states, two of
 * them empty: low and normal carry no spine at all and are deliberately
 * indistinguishable (PD-PLATE-017). A track that ramps between them promises a reading
 * the day cannot deliver, which is the same class of thing as a value computed and never
 * used: it describes something nothing draws.
 */

/**
 * Which stop a position along the track belongs to.
 *
 * Rounding rather than flooring is what makes the slider snap to the nearest stop
 * under the finger instead of only advancing once a stop is fully passed.
 */
export function prioritySliderStopIndex(ratio: number, stops: number = IMPORTANCE_STOPS.length): number {
  if (!Number.isFinite(ratio) || stops <= 1) return 0;
  return Math.min(stops - 1, Math.max(0, Math.round(ratio * (stops - 1))));
}

export function prioritySliderRatio(level: ImportanceLevel, stops: readonly ImportanceLevel[] = IMPORTANCE_STOPS): number {
  const index = stops.indexOf(level);
  if (index < 0 || stops.length <= 1) return 0;
  return index / (stops.length - 1);
}

export function prioritySliderLevel(ratio: number, stops: readonly ImportanceLevel[] = IMPORTANCE_STOPS): ImportanceLevel {
  return stops[prioritySliderStopIndex(ratio, stops.length)] ?? stops[0] ?? 'normal';
}

/**
 * The track, **one band per stop and each band the colour that stop actually draws.**
 *
 * Low and normal share `quiet` because the plate gives them the same thing — nothing —
 * and saying so is the point: the first half of the track buys no marker, and the person
 * can see that before they let go. High takes the spine's own amber and critical the
 * spine's own `over`, so the control is a preview of its consequence rather than a
 * legend beside one.
 *
 * Derived from `IMPORTANCE_STOPS` rather than counted, so a fifth level would arrive
 * here as a band instead of as a silent mismatch between four colours and five stops.
 */
export function priorityTrackBands(quiet: string, high: string, critical: string): readonly string[] {
  return Object.freeze(IMPORTANCE_STOPS.map(
    (stop) => stop === 'critical' ? critical : stop === 'high' ? high : quiet,
  ));
}

/**
 * How wide each band is, as a share of the track — **the width of the region that
 * actually snaps to that stop**, not an equal quarter.
 *
 * `prioritySliderStopIndex` rounds, so the stop at `i / (n - 1)` owns everything within
 * half a step of it: the two end stops own half a region each and the inner ones own a
 * whole one. Four equal quarters would put every boundary in the wrong place — the
 * thumb would sit over the amber band while releasing to `normal` — and a control whose
 * colour disagrees with its own outcome is worse than one with no colour at all.
 *
 * For the four levels this is `1 : 2 : 2 : 1`, and it is derived so it stays true if the
 * stops ever change.
 */
export function priorityTrackWeights(stops: number = IMPORTANCE_STOPS.length): readonly number[] {
  if (stops <= 1) return Object.freeze([1]);
  const step = 1 / (stops - 1);
  return Object.freeze(Array.from({ length: stops }, (_unused, index) => {
    const from = Math.max(0, (index - 0.5) * step);
    const to = Math.min(1, (index + 0.5) * step);
    return to - from;
  }));
}
