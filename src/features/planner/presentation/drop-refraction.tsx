import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Reanimated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { useLifePlannerTheme } from '@/src/ui/theme';

import {
  JOURNAL_DATE_TYPE_SIZE,
  JOURNAL_DROP_BAND,
  JOURNAL_DROP_RADIUS,
  JOURNAL_LABEL_MAX_SCALE,
  LENS_FIT_SHARE,
  LENS_MAGNIFICATION,
} from './day-journal-model';

/**
 * The lens: the date under the bead, enlarged — **by magnifying the strip's own text rather
 * than by drawing a substitute for it.**
 *
 * This was Skia, and Skia was the wrong tool for one plain reason: **it cannot read React
 * Native views**, so it had to redraw the numeral, and redrawing a numeral means resolving a
 * typeface. `matchFont` defaults to the family name `System`, hands whatever comes back —
 * including `null` — to `Skia.Font`, and `Text`'s own `font` prop accepts `null`; the
 * fallback then walked the font manager's family list and took the first face that could
 * draw a digit, which on iOS is an alphabetical accident. The device showed a **serif 6
 * between a sans-serif 5 and 7**. That is not a bug in the fallback, it is the fallback
 * being asked a question it cannot answer: *which face is the one React Native is using?*
 *
 * A magnifier does not ask. It enlarges what is underneath it, which is what this does now:
 * the numerals are the same `<Text>` under the **same style object** the strip's own cells
 * use, so they are the same face, weight and size **by construction** — there is no font to
 * resolve, and no way for the two to drift apart. It also takes the whole Skia dependency
 * out of the running application: this file was the only importer.
 *
 * **The magnification is in the geometry, not in a `transform`.** Scaling the layer was the
 * obvious way and it came back from the device as «шрифт под каплей выглядит странно»:
 * `transform: scale` enlarges a view that has already been rasterised, so a 17 pt glyph
 * blown up 1.7× is 17 pt of pixels stretched over 29, which is soft edges and nothing else.
 * Every length here is multiplied instead — the type size, the column, the band — so the
 * text is laid down at its final size and drawn from its outline. Same arithmetic, and the
 * only difference is that one of them is sharp.
 *
 * **Two boxes, each with one job.**
 *
 * 1. `clip` is the bead's own circle. `overflow: hidden` here rather than on the bead
 *    itself, because on iOS a view that clips its own overflow draws no shadow.
 * 2. `content` carries the numerals at **magnified** content coordinates and slides by the
 *    bead's magnified place in them.
 *
 * A content point `p` lands at `R + M·(p − trackX)`: the bead's centre when `p` is the date
 * it is standing on, and a magnifying glass held over the strip everywhere else.
 */
export function DropLens({ trackX, digits, columnWidth }: {
  /** The bead's place in the strip's **content**, so a browse cancels against the digits. */
  readonly trackX: SharedValue<number>;
  /** The numerals within reach, at their column centres in the strip's content. */
  readonly digits: readonly DropLensDigit[];
  /** One column, so a numeral is centred in the same box the real cell centres it in. */
  readonly columnWidth: number;
}) {
  const theme = useLifePlannerTheme();
  /**
   * **What the widest date actually measures, and the magnification that lets it fit.**
   *
   * Reported from the device: `29` and `30` were cut by the rim on both sides. The disc was
   * sized from a single digit's width, and two thirds of a month has two of them — a circle
   * is the worst container for a pair, because the glyphs are widest exactly where it
   * narrows. The probe below renders `30` at the requested size, off in the clipped margin
   * where nothing can see it, and reports what it really occupies; the magnification is then
   * whatever fits, **the same for every date**, which is what «унифицировать все даты» asks
   * for. A per-date fit would make `1` and `30` different sizes, which is the opposite.
   *
   * The probe never changes size, so measuring it cannot move it and there is no loop.
   */
  const [widest, setWidest] = useState(0);
  const requested = JOURNAL_DATE_TYPE_SIZE * LENS_MAGNIFICATION;
  const room = (JOURNAL_DROP_RADIUS * 2 - LENS_RIM) * LENS_FIT_SHARE;
  const magnification = widest === 0
    ? LENS_MAGNIFICATION
    : Math.min(LENS_MAGNIFICATION, LENS_MAGNIFICATION * (room / widest));
  /**
   * The bead's own place, magnified with everything else — `R − M·trackX`, so that the date
   * it stands on lands on the bead's centre and its neighbours fall the magnified distance
   * away. Magnifying the offsets and not the position would slide the glass off its subject.
   */
  const shift = useAnimatedStyle(() => ({
    transform: [{ translateX: JOURNAL_DROP_RADIUS - magnification * trackX.value }],
  }), [magnification]);
  const column = columnWidth * magnification;
  /**
   * Stated rather than left to `auto`. The children are absolutely positioned at content
   * coordinates that run to tens of thousands of points, and a parent that measures zero is
   * a parent whose children may or may not be drawn depending on the platform's overflow
   * behaviour — the kind of thing that works on one and not the other.
   */
  const width = digits.length === 0 ? 0 : digits[digits.length - 1]!.x * magnification + column;
  const band = JOURNAL_DROP_BAND * magnification;

  return <View pointerEvents="none" style={styles.clip}>
    {/* The probe: the widest date this calendar can hold, at the size the lens would like to
        use, parked outside the disc so the clip swallows it. It is measured, never seen. */}
    <Text
      maxFontSizeMultiplier={JOURNAL_LABEL_MAX_SCALE}
      onLayout={(event) => setWidest(event.nativeEvent.layout.width)}
      style={[styles.probe, { fontSize: requested }]}
    >{LENS_WIDEST_DATE}</Text>
    <Reanimated.View
      style={[styles.content, { height: band, top: JOURNAL_DROP_RADIUS - band / 2, width }, shift]}
    >
      {digits.map((digit) => <View
        key={digit.key}
        style={[styles.cell, { height: band, left: digit.x * magnification - column / 2, width: column }]}
      >
        {/* The strip's own numeral at the fitted size — one declaration of what a date is set
            in, in `day-journal-model`, so the two can never drift apart. */}
        <Text
          maxFontSizeMultiplier={JOURNAL_LABEL_MAX_SCALE}
          style={[styles.number, { color: theme.today.primaryText, fontSize: JOURNAL_DATE_TYPE_SIZE * magnification }]}
        >{digit.text}</Text>
      </View>)}
    </Reanimated.View>
  </View>;
}

/** One numeral the lens may have to enlarge, at its column centre in the strip's content. */
export interface DropLensDigit {
  readonly key: string;
  readonly text: string;
  /** The column's **centre**, the same coordinate the bead itself travels along. */
  readonly x: number;
}

/** The widest string a date can be — every month has a 28th, and none has a 32nd. */
const LENS_WIDEST_DATE = '30';
/** The bead's hairline, which the numeral must stay inside rather than sit under. */
const LENS_RIM = 2;

const styles = StyleSheet.create({
  clip: { ...StyleSheet.absoluteFillObject, borderRadius: JOURNAL_DROP_RADIUS, overflow: 'hidden' },
  /**
   * **The magnified band, hung so its middle is the bead's middle.**
   *
   * The date band's centre already *is* the bead's centre — `journalDropCentre()` is
   * `JOURNAL_WEEK_LETTER + JOURNAL_DROP_BAND / 2` and the numeral is centred in that same
   * band — so magnifying about that point is a matter of centring the taller box on it,
   * and there is no vertical offset to derive at all. Asserting it is worth more than
   * computing it: the day the two stop sharing a centre, the glass slides off the number.
   */
  content: { left: 0, position: 'absolute' },
  // The real cell's own band at the magnified size: centred in both axes, one column wide.
  cell: { alignItems: 'center', justifyContent: 'center', position: 'absolute', top: 0 },
  // Laid down at its final size, never scaled — see the note at the top of this file.
  number: { fontWeight: '500' },
  // Outside the disc, so the clip swallows it. Measured, never seen.
  probe: { left: 0, position: 'absolute', top: -1000 },
});
