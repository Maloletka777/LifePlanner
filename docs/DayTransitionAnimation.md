# The day transition, as it stood before it was removed

**Written to be reversible.** On 2026-08-06, after sixteen attempts at one family of visual
defects, the owner asked for the page transition to be taken out entirely so that a clean
baseline could be judged: if the tearing survives with no animation at all, it was never
about the animation. This file is what the animation *was*, in enough detail to rebuild it
without reading a diff.

Nothing here is a recommendation. Several of these mechanisms are compensations for each
other and should not be restored together without deciding which of them is actually needed.

---

## The shape

`DayCarousel` drew **two** day trees on one horizontal track:

- **the arriving day** — `children`, in flow
- **the day leaving** — `previous.current`, a frozen React element of the tree as it was
  before the last change of `day`, absolutely positioned over it via `styles.carouselLeaving`

It kept them with:

```
const previous = useRef<React.ReactNode>(null);
const shown = useRef<{ day; tree }>({ day, tree: children });
if (shown.current.day !== day) {
  previous.current = shown.current.tree;
  heldHeight.current = measuredHeight.current;
}
shown.current = { day, tree: children };
```

`committed = canTurn && direction !== 0 && committing && previous.current !== null` decided
whether the outgoing tree was mounted at all. `canTurn = width > 0 && !reduceMotion`.

## What drove it

One shared value, `travel`, monotonic — 1, then 2, then 3 — never written at a journey's
start. A journey claims `[at, at + 1]` from wherever the value already stands. Every reader
interpolates over the journey's own `[inStart, inEnd]` and **clamps**; a reader left on
`[0, 1]` walks a page-width off screen per date change, which is a defect this project has
paid for twice.

The journey itself lived in a shared value, `dropSample`, written **synchronously** by
`commitJourney` before anything native moved:

```
{ direction, fromX, toX, inStart, inEnd, progress[], stretch[], squash[] }
```

`direction` is `Math.sign(plannerDaysBetween(from, to))`. It rides in the shared value
because a worklet reading it from a render is one commit behind — invisible while the
direction holds, violent the moment a second tap inverts it.

## The two position worklets

```
leaving:  translateX = interpolate(travel, [inStart, inEnd], [0, -direction * width], CLAMP)
arriving: translateX = interpolate(travel, [inStart, inEnd], [direction * width, 0], CLAMP)
```

Full width, both **opaque**. At share `s` the outgoing page holds `[-w·s, w(1-s)]` and the
incoming one `[w(1-s), w(2-s)]`: they meet at a moving edge and never share a pixel.

**Do not restore any opacity here.** Two attempts failed in opposite directions and both are
recorded: a cross-fade shows both pages at once and two nearly identical opaque lists print
through one another (reported as duplicated rows); a fade-through shows neither, and measured
off `тест1.MP4` the content sat below a quarter of its resting ink for **233–567 ms at a
time, 3767 ms of 12433**. Deleted with them: `JOURNAL_PAGE_BLOOM`,
`JOURNAL_PAGE_BLOOM_FLOOR`, `JOURNAL_PAGE_FADE_THROUGH`, `JOURNAL_PAGE_SHIFT_SHARE`.

The arriving view carried **one** animated style for its whole life — never swapped for
another — because Reanimated applies a newly assigned animated style on the frame *after* the
render that assigns it, so a swapped style drew one frame with the previous value.

## The compensations layered on top

Each closed a real seam. Together they are the reason the construction became hard to reason
about, and they are listed so that a rebuild can decide which are still needed.

| Mechanism | What it compensated for |
|---|---|
| `key={day}` on the arriving view | The view was reused, so on the commit frame it held the previous applied `translateX: 0` — the same place the outgoing page stands. A remount makes `useAnimatedStyle` compute its first value synchronously, off-screen. |
| `minHeight: committed ? max(minHeight, heldHeight) : minHeight` | Two days both taller than the pane settled by their difference the instant content committed. |
| `pageMinHeight` = pane − header − bottom | A day shorter than the viewport shortened the page; measured at 78 px in one frame, three times, in `тест7.MP4`. |
| `readyDay` / `dayIsWhole` | The page was assembled from four reads answering at different moments — a row whose text was grey beside an empty checkbox. |
| `pendingJourney` | The spring started on the tap while its content arrived whenever it arrived; on a cold day the page appeared *at its destination*. |
| `arrived()` — one render on settle | Collapsing a journey makes `from === to`, so direction is 0 and a worklet reading 0 puts **both** pages at `translateX: 0`. The outgoing day came back on top and stayed until an unrelated render unmounted it. |

## The header, which is not the carousel

`heroArrival` fades the day header and the NOW line from `JOURNAL_HERO_ARRIVAL_FLOOR` (0.35)
to 1 across the same journey share, because the header is an ordinary render and commits a
frame before the list moves. `todayPresence` cross-fades the elapsed meter over
`JOURNAL_TODAY_FADE` (280 ms) — the meter is the only element whose *existence* depends on
which date is chosen.

## What must survive any rebuild

The drop's own travel model, PD-TODAY-146: monotonic `travel`, journeys claiming
`[at, at + 1]`, nothing written at a journey's start, every reader clamped to the journey's
own range. Six device defects bought those rules and they are unrelated to the page.

---

## THE VERDICT — confirmed on the device, 2026-08-06

**Removing the transition removed every one of the defects.** Owner: «да, убрав анимацию, мы
действительно избавились от всех проблем».

That settles a question sixteen attempts could not: the tearing, the duplicated rows, the
ticks resetting before the turn and the one-frame flash of the new day were **all** properties
of this construction, not of the data, the timing, the easing or the ordering. Every fix that
adjusted a curve, a distance, an opacity or a mount was aimed at a symptom of it.

**What the construction actually was, and why it could not be made to work:** one page whose
content is rewritten under it, plus a frozen snapshot of what it used to be, with the pair
positioned by an animated style. React commits content synchronously; an animated style lands
on the next frame. Those two facts are irreconcilable inside that shape — every compensation
in the table above buys one frame back somewhere and loses it somewhere else.

**Do not restore this design.** If a transition is wanted again, build the one the owner
described: days as separate mounted pages, position from layout, the turn a translate of a
container that nobody re-renders. Then content and position cannot disagree, because nothing
is being rewritten while it moves.

---

## THE REBUILD — built 2026-08-06, awaiting the device

Owner approved rebuilding the transition in the shape that makes the defect impossible rather
than compensated. **The rule that decides everything: at a change of date, no page's content
is rewritten.** Only one container moves.

### Why that removes the defect rather than hiding it

The defect was: position is a function of the animation, content changes when the animation
starts, and an animated style lands a frame after React commits. So one frame drew new
content at the old position. Every compensation bought back one route to that frame; there
were more routes than compensations.

In the new shape a page's position comes from **layout** — `left: i × width`, fixed for its
whole life — and the only animated value is the container's `translateX`. Content is never
rewritten while anything moves, so the frame that carried the defect cannot occur.

### Steps, in this order

1. **Extract `DayPage({ date })`** from the 104 lines currently inside `<DayCarousel>`. It
   owns its own reads — `usePlannerOccurrences`, catalogue, checklists, closure rules — and
   its own `day`, `blocks`, `emptyDay`, `anytimeOptions`. Pure refactor, no behaviour change:
   the gate must stay green **before** anything else is touched.
   *Note:* the header keeps reading the **selected** date for `tally`, `hero` and
   `dayElapsed`. Those are statements about the chosen day, not about a page.
2. **A stable window** of five dates around the selection, keyed by date. Render all five.
3. **`translateX = -index × width`** on the container, animated, and nothing else animated.
4. **Recentre the window only after the turn has settled**, adjusting the offset in the same
   commit so the picture does not move. **This is the single place a relapse can enter** — a
   window that shifts mid-turn changes every page's index, which changes every page's
   position, which is the original defect from the other end.
5. Keep the drop exactly as it is. It was never implicated.

### How to know it worked

Not by the suite — it cannot see a frame. Tap between two days of **different lengths**, back
and forth quickly, and on a **cold** day. The three symptoms to watch for are the ones that
were reported: a flash of the new day before the turn, rows duplicated mid-turn, ticks
resetting before the page moves. If any survives, the answer is not another compensation —
it is that step 4 was got wrong, and the baseline to fall back to is the current no-animation
build, which is known good.

### As built

- `DayPage({ date })` reads its own day — occurrences, catalogue, checklists, closure rules —
  and **carries its own date into every action**, so a page for the 5th closes the 5th even
  while the selection is elsewhere. `toggleDone`, `toggleStep`, `openEditor` and `openCreateIn`
  all take a date rather than reading `selected`.
- `journalPageWindow(centre)` gives seven dates, `JOURNAL_PAGE_WINDOW_RADIUS` either side.
  Three is what a turn needs: a neighbour is always mounted, and the two beyond absorb a
  second tap arriving before the first has settled.
- The track is `flexDirection: 'row'` with full-width slots. Verified on the web bench: seven
  slots of 1280 standing at 10, 1290, 2570, 3850, 5130, 6410, 7690 — **edge to edge, never
  overlapping**. The only animated value is the track's own `translateX`.
- `pageX` springs to `journalPageOffset(index, width)` with the drop's own spring parameters,
  so the page and the bead arrive together without either reading the other.
- `parkTrack` places the track without animating: first layout, width change, and the
  recentring. Guarded by `flying.current` so it cannot fight a turn in progress.
- **The window is recentred only in `settle`**, with the offset put back in the same commit.
  The chosen day lands in the middle of the new window, so the same page stays under the same
  pixels; pages that fall off the ends unmount and new ones mount off-screen.

**Not yet judged on a device.** The web bench cannot help here: its pane does not composite,
so Reanimated never applies the track's transform, and it was only ever able to prove the
layout — which it did.

### Device round 1 — three defects, all mine, all closed

- **Neighbours visible in the margins.** The track had no clip. Seven days stand side by side
  and six are off-screen *by design*; unclipped they are merely beside the screen.
  `pageViewport: { overflow: 'hidden' }`.
- **The turn played exactly once.** The parking effect had `selected` in its dependencies, so
  a tap put the track straight on its destination before the spring could start — the start
  waits for the day to be whole, and `flying` is still false at that moment. Parking answers
  a change of **geometry**, never of date; a journey running or waiting owns the track.
- **Plates ran past the right edge.** The ground's side padding sat on the scroll container
  and inset the whole track once, leaving every slot a full pane wide. It belongs to a page.
- **Dates beyond the window did not load.** Seven days are mounted; anything further has no
  page at all, so there was nothing to slide to. A date outside the window is a **jump**: the
  window is rebuilt around it and parked before the spring is given anything to do. There is
  no animation because there is no continuity to animate.

**The window now has exactly two writers** — the jump and the settle — and neither runs while
a turn does. A rebuild mid-turn would change every page's index, and an index is a position:
the original defect arriving from the other end.

### Device round 2 — a distant date now travels

**«На непрогруженные страницы не работает анимация».** True by construction: the track held
seven days, so anything further had no page to slide to and the jump was silent.

Sliding the real distance is not the answer — thirty screens of travel says nothing anybody
reads. **Every calendar moves one screen however far the date is**, and that is what a
two-page window gives: the day being left and the day being gone to, side by side in the
direction of travel. Built at the tap, parked on the day being left, and recentred to the
ordinary seven once the turn settles.

`pageWindowRef` exists for this: `begin` runs a render after the tap that decided it, because
it waits for the day to be whole. Its closure holds the window from before the rebuild — a
page no longer on the track — so it reads the ref instead.

**The window now has three writers**, and the rule is unchanged and is the one to keep: none
of them runs *during* a turn. A rebuild mid-turn changes every page's index, and an index is
a position — the original defect arriving from the other end.
