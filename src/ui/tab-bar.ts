/**
 * Geometry of the bottom tab bar.
 *
 * The bar stopped hugging its contents: it spans the screen inside a 14 pt inset
 * on three sides — `left 14 / right 14 / bottom 14` — at radius 22 with 4 pt of
 * padding (`design_handoff_today` §6). That withdrew the 272 pt capsule of
 * PD-GLOBAL-006/008, whose width had to be derived from the plates it carried for
 * exactly the reason a flexing slot does not care.
 *
 * **The labels came back.** §6 removed them so a fourth and fifth module could
 * arrive without the row reflowing, and the owner's reference puts them back —
 * `Today · Overview · More` under the icons, 11/600. Flexing slots keep that
 * promise anyway: a new module makes each slot narrower rather than reflowing the
 * row, which is what the capsule could not do.
 *
 * These live here rather than in `app/(tabs)/_layout.tsx` so that screens under
 * `src/features` never import from the routing layer: that direction of import
 * inverts the project's layering and makes module initialisation order matter.
 */
/**
 * **The bar floats again: an oval that hovers over the page** (owner instruction,
 * reported from a device).
 *
 * PD-PLATE-009 made it full width and anchored to the bottom edge, so that it added no
 * surface level and read as the bottom of the screen the way the header is the top of
 * it. On the device that reads as a slab: the day stops at a wall rather than passing
 * under something. So it comes off all four edges again — a 16 pt inset, a radius that
 * is half its own height so the shape is a true oval rather than a rounded rectangle,
 * and the day's ground running unbroken beneath it.
 *
 * **This still does not reopen PD-TODAY-016.** That finding was about the strip *around*
 * a floating pill belonging to the navigator and staying white; the layer paints nothing
 * and passes touches through, so there is no strip to tear. That was already true when
 * PD-GLOBAL-008 moved the geometry out of `tabBarStyle`, and it is why the capsule could
 * come back at all.
 *
 * **The safe area moves back under the bar**, because a floating bar does not reach the
 * screen's edge and has no home-indicator room to hold: the inset is measured from the
 * safe area instead, so the oval sits above the indicator rather than around it.
 */
export const TAB_BAR_INSET = 16;
export const TAB_BAR_PADDING = 6;
export const TAB_BAR_ICON_SIZE = 21;
export const TAB_BAR_LABEL_SIZE = 11;
/** Between the icon and its word, as the reference draws it. */
export const TAB_BAR_ICON_LABEL_GAP = 3;
/** The plate the reference gives a slot: icon, gap and word, with room around them. */
export const TAB_BAR_SLOT_HEIGHT = 44;

/** Content, with the same padding above and below it. */
export const TAB_BAR_HEIGHT = TAB_BAR_SLOT_HEIGHT + TAB_BAR_PADDING * 2;

/**
 * **A true oval, not a rounded rectangle**: the radius is half the height, so the ends
 * are semicircles whatever the bar's height becomes.
 */
export const TAB_BAR_RADIUS = TAB_BAR_HEIGHT / 2;

/** The active slot keeps the bar's own curve, minus the padding around it. */
export const TAB_BAR_SLOT_RADIUS = TAB_BAR_RADIUS - TAB_BAR_PADDING;

/** What a screen must clear so its last row is never under the bar. */
export const TAB_BAR_CLEARANCE = TAB_BAR_HEIGHT + TAB_BAR_INSET;
