/**
 * The time drum, from `Time drum.dc.html` frame `1a` — «засечка = длительность».
 *
 * The native two-wheel spinner asks for an hour and a minute and knows nothing about
 * the day it is choosing inside. The drum asks one question instead: **which notch**.
 * The day is cut into notches of the chosen length, so every start is exactly where
 * the one before it would have ended, and the wheel cannot be left in a position where
 * a thing does not stand squarely in the day.
 *
 * Everything here is a pure function over minutes, so the cut, the walk, the snap and
 * the row geometry are asserted in the Node test runner rather than inspected on a
 * device. React Native is not imported and neither is the feature barrel.
 *
 * **The length is the item's now, which it was not when this was written.** It used to
 * only cut the day and then go nowhere, because nothing stored it — PD-CREATE-030
 * recorded that, and the caption said so out loud. Schema v13 gives the planned-time
 * version its own `planned_duration_minutes`, so the cut a person chooses here is saved
 * beside the minute it produced and the day draws the plate as a span rather than as a
 * chip of some arbitrary height.
 *
 * The metric `duration` tracking mode is still a different thing entirely and is
 * untouched: that is how a habit is *measured*, this is how long it is *meant to take*.
 */

/** One notch, and the height every row on the drum is drawn at. */
export const TIME_DRUM_ROW_HEIGHT = 44;

/** The well: six rows of room, so three notches stand either side of the choice. */
export const TIME_DRUM_WELL_HEIGHT = 264;

/** Where the chosen row sits: the well's own middle, less half a row. */
export const TIME_DRUM_CENTRE = (TIME_DRUM_WELL_HEIGHT - TIME_DRUM_ROW_HEIGHT) / 2;

/** How far the drum is turned away from the eye, in degrees per row. */
export const TIME_DRUM_TILT = 17;

/** Past this many rows from the choice a row is not drawn at all. */
export const TIME_DRUM_REACH = 3.7;

/** How much a row shrinks and fades per row of distance. */
export const TIME_DRUM_SCALE_STEP = 0.05;
export const TIME_DRUM_FADE_STEP = 0.27;

/** The finger travels four fifths of a row to turn the drum by one. */
export const TIME_DRUM_DRAG_ROW = TIME_DRUM_ROW_HEIGHT * 0.8;

/** The lengths offered, and the bounds of the one that is typed. */
export const TIME_DRUM_DURATIONS: readonly number[] = Object.freeze([5, 10, 15, 30, 60, 90]);
export const TIME_DRUM_OWN_STEP = 5;
export const TIME_DRUM_OWN_MINIMUM = 5;
export const TIME_DRUM_OWN_MAXIMUM = 180;
export const TIME_DRUM_OWN_DEFAULT = 25;

/** The default length: half an hour cuts a day into notches a person recognises. */
export const TIME_DRUM_DEFAULT_DURATION = 30;

/**
 * The hours the drum offers, and the one rule that can widen them.
 *
 * `06:00 — 23:00` is the span a person plans in, and holding it fixed is what makes a
 * minute the same distance down the drum on every day. It widens **by whole hours** to
 * contain a time the item already carries, because a wheel that cannot reach the value
 * it was opened with is worse than a slightly longer one — the same rule the day bar's
 * own window runs on (PD-TODAY-056, PD-TODAY-130).
 */
export const TIME_DRUM_WINDOW_START = 6 * 60;
export const TIME_DRUM_WINDOW_END = 23 * 60;

export interface TimeDrumWindow {
  readonly start: number;
  readonly end: number;
}

export function timeDrumWindow(containing: number | null): TimeDrumWindow {
  if (containing === null || !Number.isFinite(containing)) {
    return Object.freeze({ end: TIME_DRUM_WINDOW_END, start: TIME_DRUM_WINDOW_START });
  }
  const minute = Math.max(0, Math.min(24 * 60 - 1, Math.round(containing)));
  const start = Math.min(TIME_DRUM_WINDOW_START, Math.floor(minute / 60) * 60);
  const end = Math.max(TIME_DRUM_WINDOW_END, Math.ceil((minute + 1) / 60) * 60);
  return Object.freeze({ end, start });
}

/**
 * Something already planned on the day the drum is cutting.
 *
 * **A block where a length is stored, and a point where it is not.** An occurrence used
 * to carry a start and no end, so «busy 09:00–09:30» was unconstructible and PD-CREATE-031
 * had to record that a notch could only say what *starts* in it. Schema v13 stores the
 * length, so a thing that runs across a notch is marked in the notch it runs across.
 * An item still lacking one keeps the older reading, and must: inventing a span would put
 * a false block on the one control that decides where a day's work goes.
 */
export interface TimeDrumBusy {
  readonly minute: number;
  readonly name: string;
  /**
   * How long it takes, or `null` when nobody stated a length.
   *
   * **This is what PD-CREATE-031 had to withhold.** The design marked busy *time*; an
   * occurrence stored a start and no end, so a block was unconstructible and a notch
   * could only say that something *starts* inside it. Schema v13 stores the length, so a
   * thing that runs across a notch is now marked in the notch it runs across — which is
   * the whole difference between «Standup starts here» and «Standup is happening here».
   *
   * An item that still states no length keeps the older reading, and must: inventing a
   * span for it would put a false block on the one control that decides where a day's
   * work goes.
   */
  readonly durationMinutes?: number | null;
}

export interface TimeDrumRow {
  readonly minute: number;
  /** The first thing already planned inside this notch, or null when it is clear. */
  readonly busyName: string | null;
}

/**
 * The step between notches: the chosen length, and never less than five minutes.
 *
 * The floor is what keeps a day from being cut into a thousand rows if a length ever
 * arrives smaller than the smallest chip.
 */
export function timeDrumStep(durationMinutes: number): number {
  return Math.max(TIME_DRUM_OWN_MINIMUM, Math.round(durationMinutes));
}

/**
 * The day, cut into notches of the chosen length.
 *
 * A notch is offered only where the whole length still fits inside the window, so the
 * drum can never be left in a position where the thing would run past the end of the
 * day it is being planned in. A window too short to hold even one length keeps its own
 * first minute rather than returning nothing, because a wheel with no rows is a wheel
 * that cannot be answered.
 */
export function timeDrumRows(input: Readonly<{
  window: TimeDrumWindow;
  durationMinutes: number;
  busy?: readonly TimeDrumBusy[];
}>): readonly TimeDrumRow[] {
  const duration = timeDrumStep(input.durationMinutes);
  const step = timeDrumStep(input.durationMinutes);
  const busy = input.busy ?? [];
  const rows: TimeDrumRow[] = [];
  for (let minute = input.window.start; minute + duration <= input.window.end; minute += step) {
    rows.push(Object.freeze({ busyName: timeDrumBusyAt(busy, minute, duration)?.name ?? null, minute }));
  }
  if (rows.length === 0) rows.push(Object.freeze({ busyName: null, minute: input.window.start }));
  return Object.freeze(rows);
}

/**
 * What is already planned inside a notch, by name, or nothing.
 *
 * **Two readings, and which one applies is a property of the data rather than a choice.**
 * A thing with a stated length occupies `[start, start + length)` and collides with the
 * notch when the two intervals overlap — so an hour-long thing at 09:00 marks every notch
 * it runs through, not only the one it begins in. A thing with no stated length is a
 * point, and can only be reported where it starts.
 *
 * Both are half-open at both ends: a thing beginning exactly where this notch ends does
 * not collide with it, which is the whole point of cutting the day this way.
 *
 * Where several collide, the earliest is reported — a notch has room to name one, and the
 * first one to begin is the one a person is most likely to be thinking of.
 */
export function timeDrumBusyAt(
  busy: readonly TimeDrumBusy[],
  minute: number,
  durationMinutes: number,
): TimeDrumBusy | null {
  const end = minute + timeDrumStep(durationMinutes);
  let found: TimeDrumBusy | null = null;
  for (const block of busy) {
    const span = block.durationMinutes ?? null;
    if (span !== null && span > 0) {
      const overlaps = block.minute < end && minute < block.minute + span;
      if (!overlaps) continue;
      if (found === null || block.minute < found.minute) found = block;
      continue;
    }
    if (block.minute < minute || block.minute >= end) continue;
    if (found === null || block.minute < found.minute) found = block;
  }
  return found;
}

/** Which row a minute belongs to: the nearest notch, and ties go to the earlier one. */
export function timeDrumIndexOf(rows: readonly TimeDrumRow[], minute: number): number {
  let index = 0;
  let best = Infinity;
  rows.forEach((row, at) => {
    const gap = Math.abs(row.minute - minute);
    if (gap < best) {
      best = gap;
      index = at;
    }
  });
  return index;
}

/** A turn of the drum, bounded by its own ends. */
export function timeDrumClampIndex(rows: readonly TimeDrumRow[], target: number): number {
  return Math.max(0, Math.min(rows.length - 1, Math.round(target)));
}

/** How many notches a drag of `dy` points has turned the drum by. Up is later. */
export function timeDrumDragRows(dy: number): number {
  return withoutNegativeZero(Math.round(-dy / TIME_DRUM_DRAG_ROW));
}

/**
 * `-0` is a number nobody means.
 *
 * Negating zero keeps its sign, so a drag of nothing came back as `-0` and a row at the
 * middle of the drum asked for `rotateX: '-0deg'`. Neither is wrong to a renderer and
 * both are wrong to a reader — and one of them is wrong to `Object.is`, which is what a
 * test compares with.
 */
function withoutNegativeZero(value: number): number {
  return value === 0 ? 0 : value;
}

/**
 * Where the drum lands when the length changes: the notch nearest the minute it held.
 *
 * Re-cutting the day moves every notch, so the minute a person had chosen is usually
 * not one any more. Snapping to the nearest keeps the choice as close as the new cut
 * allows instead of throwing it away — and it is why changing the length reads as the
 * day being re-cut under a fixed choice rather than as the choice being reset.
 */
export function timeDrumSnap(rows: readonly TimeDrumRow[], minute: number): number {
  const row = rows[timeDrumIndexOf(rows, minute)];
  return row === undefined ? minute : row.minute;
}

export interface TimeDrumRowGeometry {
  readonly translateY: number;
  readonly rotateX: number;
  readonly scale: number;
  readonly opacity: number;
  readonly drawn: boolean;
}

/**
 * How a row stands, given how many notches away from the choice it is.
 *
 * The three effects are one movement: a row further from the middle is smaller, turned
 * further away, and quieter — and its travel is reduced by exactly the amount it has
 * shrunk, so the rows stay a stack rather than opening gaps as they recede. Shrinking
 * stops after three rows, which is also where the drum stops drawing them.
 */
export function timeDrumRowGeometry(distance: number, tilt: number = TIME_DRUM_TILT): TimeDrumRowGeometry {
  const away = Math.abs(distance);
  const shrink = TIME_DRUM_SCALE_STEP * Math.min(away, 3);
  return Object.freeze({
    drawn: away <= TIME_DRUM_REACH,
    opacity: Math.max(0, 1 - away * TIME_DRUM_FADE_STEP),
    rotateX: withoutNegativeZero(-distance * tilt),
    scale: 1 - shrink,
    translateY: withoutNegativeZero(distance * TIME_DRUM_ROW_HEIGHT * (1 - shrink)),
  });
}

/** A length in words: `30 min`, `1 h`, `1 h 30 min`. */
export function timeDrumDurationLabel(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  if (total % 60 === 0) return `${total / 60} h`;
  if (total < 60) return `${total} min`;
  return `${Math.floor(total / 60)} h ${total % 60} min`;
}

/** The same length on a chip, where there is room for four characters at most. */
export function timeDrumChipLabel(minutes: number): string {
  if (minutes === 60) return '1h';
  if (minutes === 90) return '1.5h';
  return String(minutes);
}

/** A length typed rather than chosen, stepped five minutes at a time and bounded. */
export function timeDrumOwnDuration(current: number, delta: number): number {
  const stepped = Math.round(current + delta);
  return Math.max(TIME_DRUM_OWN_MINIMUM, Math.min(TIME_DRUM_OWN_MAXIMUM, stepped));
}

/** `HH:MM` from a minute of the day. */
export function timeDrumLocalTime(minute: number): string {
  const bounded = ((Math.round(minute) % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${String(Math.floor(bounded / 60)).padStart(2, '0')}:${String(bounded % 60).padStart(2, '0')}`;
}

/** A minute of the day from `HH:MM`, or null for anything that is not one. */
export function timeDrumMinuteOfLocalTime(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (match === null) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * What the sheet says under the drum.
 *
 * It states what the length **does** — cuts the day — rather than what the item will
 * carry, because the item carries a start. The second sentence is the honest half of
 * PD-CREATE-020 and belongs on the surface rather than only in the register.
 */
export function timeDrumCaption(durationMinutes: number): string {
  const length = timeDrumDurationLabel(durationMinutes);
  return `Notches are ${length} apart, so every start is where the one before it ends. The length is saved with the item and drawn as its span on the day.`;
}

/** What the notch that is chosen would run over, said in the item's own name. */
export function timeDrumWarning(busy: TimeDrumBusy | null): string | null {
  if (busy === null) return null;
  const span = busy.durationMinutes ?? null;
  // **A range where one is known, a minute where it is not.** The old wording could only
  // ever say «starts at», because that was the only fact there was; saying it of a thing
  // whose whole hour this notch sits inside would be true and useless.
  if (span === null || span <= 0) return `${busy.name} starts at ${timeDrumLocalTime(busy.minute)}, inside this notch.`;
  return `${busy.name} runs ${timeDrumLocalTime(busy.minute)} — ${timeDrumLocalTime(busy.minute + span)}.`;
}

/** How the day the drum is cutting stands relative to today, in the fewest words. */
export function timeDrumDayNote(dayOffset: number): string {
  if (dayOffset === 0) return 'today';
  if (dayOffset === 1) return 'tomorrow';
  if (dayOffset === -1) return 'yesterday';
  const days = Math.abs(dayOffset);
  return dayOffset < 0 ? `${days} days ago` : `in ${days} days`;
}
