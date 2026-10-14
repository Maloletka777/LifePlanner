/**
 * What the operating system should be holding, given what the person asked for.
 *
 * `docs/Notifications.md` is the contract: a reminder row stores **intent**, the system
 * identifier and its status are **projections**, and the database's intent is reconciled
 * against the identifiers the OS actually holds at launch, on regaining focus, and after
 * a permission change. This module is that reconciliation, and it is a pure function —
 * no Expo import, no database, no clock of its own — so every rule below is asserted in
 * the Node test runner rather than observed on a device.
 *
 * **A reminder fires on the days its habit runs, not every day.** A daily trigger would
 * be one line of code and would nag on Tuesday about a Monday-Wednesday-Friday habit, so
 * what is scheduled is a **dated one-shot per occurrence**, over a bounded window that
 * every reconciliation tops back up. The window is what makes that affordable: the
 * contract already requires reconciliation at launch and on foreground, and refilling
 * the window is the same walk.
 *
 * **The identifier is ours and says so.** `lifeplanner.reminder.<reminder>.<date>` is
 * requested rather than accepted, which is what lets reconciliation tell one of ours
 * apart from anything else the OS is holding — and therefore lets it cancel an orphan
 * left by an item that no longer exists. What comes back from the OS is still what gets
 * stored, because the OS is the authority on its own identifiers.
 */

/** How many days ahead a reminder is scheduled for at a time. */
export const REMINDER_WINDOW_DAYS = 14;

/** Every identifier this application owns begins with this and nothing else does. */
export const REMINDER_IDENTIFIER_PREFIX = 'lifeplanner.reminder.';

/** The contract's six, and no seventh. */
export type ReminderScheduleStatus =
  | 'not_requested'
  | 'permission_required'
  | 'queued'
  | 'scheduled'
  | 'failed'
  | 'cancelled';

export const REMINDER_SCHEDULE_STATUSES: readonly ReminderScheduleStatus[] = Object.freeze([
  'not_requested', 'permission_required', 'queued', 'scheduled', 'failed', 'cancelled',
]);

/** Whether the person has let the application post anything at all. */
export type ReminderPermission = 'granted' | 'denied' | 'undetermined';

/**
 * One reminder, as intent, with the days it should actually fire on.
 *
 * `fires` is the caller's answer rather than this module's: whether a reminder should
 * fire is a question about a habit's schedule, its lifecycle, and — for a one-day task —
 * whether it has already been closed. Keeping it out here means each of those reasons is
 * decided and tested where it is known, and this module cannot disagree with any of them.
 */
export interface ReminderIntent {
  readonly reminderId: string;
  readonly habitId: string;
  readonly title: string;
  readonly triggerLocalTime: string;
  /**
   * The minute the item itself is planned for, when it has one.
   *
   * Not the same as the trigger: «ten minutes before» is resolved into a trigger time
   * before it is stored (PD-CREATE-019), so a reminder at 07:20 for an item at 07:30 is
   * the ordinary case — and the notification is worth more if it says which is which.
   */
  readonly plannedLocalTime?: string | null;
  /** False for a disabled reminder, an archived habit, or a task already closed. */
  readonly fires: boolean;
  /** The local dates inside the window this reminder is due on, in order. */
  readonly dates: readonly string[];
}

/** What the database currently believes the OS was told. */
export interface ReminderProjection {
  readonly reminderId: string;
  readonly systemIdentifier: string | null;
  readonly status: ReminderScheduleStatus;
  readonly scheduledFor: string | null;
}

export interface ReminderScheduleRequest {
  readonly identifier: string;
  readonly reminderId: string;
  /**
   * Which item this is about, carried so a tap can open it.
   *
   * The identifier encodes the reminder and the day, because that is what reconciliation
   * has to match on; the **item** is what a person wants when they press the banner, and
   * an identifier is the wrong place to smuggle it.
   */
  readonly habitId: string;
  readonly title: string;
  readonly localDate: string;
  readonly localTime: string;
  /** What the notification says under the item's name. */
  readonly body: string;
}

export interface ReminderProjectionWrite {
  readonly reminderId: string;
  readonly status: ReminderScheduleStatus;
  readonly systemIdentifier: string | null;
  readonly scheduledFor: string | null;
  /**
   * Why the OS refused, when it did.
   *
   * The plan never sets it — a plan is made before anything is attempted — and the
   * service fills it in on the way to `failed`, so a reminder that could not be set says
   * what went wrong rather than only that something did.
   */
  readonly failureReason?: string | null;
}

export interface ReminderNotificationPlan {
  /** To be scheduled, in date order, before anything is cancelled. */
  readonly schedule: readonly ReminderScheduleRequest[];
  /**
   * To be cancelled **after** the replacements are scheduled.
   *
   * The contract calls for a failure-safe sequence, and this is the only order that is
   * one: a cancel that runs first and a schedule that then fails leaves the person with
   * no reminder at all, where the reverse leaves them with one too many for a day.
   */
  readonly cancel: readonly string[];
  /** The projection rows to write once the two lists above have been carried out. */
  readonly projections: readonly ReminderProjectionWrite[];
}

/**
 * What the notification says under the item's own name.
 *
 * The name is the title, so the body has one job: say **when the thing itself is**, which
 * is the fact a reminder exists to deliver and the one the title cannot carry. A reminder
 * that arrives early therefore reads «Gym / Starts at 07:30» rather than repeating its own
 * minute, which the notification's own timestamp already shows.
 *
 * Where the two coincide — or where the item has no minute at all — there is nothing to
 * add, and the body says so with one word rather than restating the title or padding it
 * with something that sounds like encouragement.
 */
export function reminderNotificationBody(intent: Readonly<{
  triggerLocalTime: string;
  plannedLocalTime?: string | null;
}>): string {
  const planned = intent.plannedLocalTime ?? null;
  if (planned === null || planned === intent.triggerLocalTime) return 'Reminder';
  return `Starts at ${planned}`;
}

/** The identifier a given reminder's given day is scheduled under. */
export function reminderNotificationIdentifier(reminderId: string, localDate: string): string {
  return `${REMINDER_IDENTIFIER_PREFIX}${reminderId}.${localDate}`;
}

/** Whether an identifier the OS is holding is one of ours. */
export function isReminderNotificationIdentifier(identifier: string): boolean {
  return identifier.startsWith(REMINDER_IDENTIFIER_PREFIX);
}

/** Which reminder an identifier of ours belongs to, or null when it is not ours. */
export function reminderIdOfNotification(identifier: string): string | null {
  if (!isReminderNotificationIdentifier(identifier)) return null;
  const rest = identifier.slice(REMINDER_IDENTIFIER_PREFIX.length);
  const split = rest.lastIndexOf('.');
  return split <= 0 ? null : rest.slice(0, split);
}

/**
 * The difference between what the person asked for and what the OS is holding.
 *
 * Four rules, and every one of them is about the OS's own list rather than about the
 * projection: the projection records what happened, and the **held set is the authority
 * on what is true**. A projection saying `scheduled` for an identifier the OS has
 * forgotten — dropped on a restore, cleared by the system, revoked with a permission —
 * is a row to act on, not a reason to do nothing.
 *
 * 1. Permission not granted: nothing is scheduled, everything ours is cancelled, and
 *    every firing reminder is marked `permission_required`. **The configuration is
 *    kept** — the contract is explicit that denial saves it.
 * 2. A reminder that fires wants exactly one identifier per date in its window. What is
 *    missing is scheduled; what is held and not wanted is cancelled.
 * 3. A reminder that no longer fires wants none, so all of its identifiers go and it is
 *    marked `cancelled`.
 * 4. An identifier of ours belonging to no intent at all is an orphan — an item deleted
 *    while the app was closed — and is cancelled.
 */
export function reminderNotificationPlan(input: Readonly<{
  intents: readonly ReminderIntent[];
  projections: readonly ReminderProjection[];
  /** Every identifier the OS is currently holding, ours and anybody else's. */
  held: readonly string[];
  permission: ReminderPermission;
}>): ReminderNotificationPlan {
  const ours = input.held.filter(isReminderNotificationIdentifier);
  const heldByReminder = new Map<string, string[]>();
  for (const identifier of ours) {
    const reminderId = reminderIdOfNotification(identifier);
    if (reminderId === null) continue;
    const list = heldByReminder.get(reminderId) ?? [];
    list.push(identifier);
    heldByReminder.set(reminderId, list);
  }
  const known = new Set(input.intents.map(({ reminderId }) => reminderId));
  const projected = new Map(input.projections.map((row) => [row.reminderId, row]));

  const schedule: ReminderScheduleRequest[] = [];
  const cancel: string[] = [];
  const projections: ReminderProjectionWrite[] = [];

  for (const intent of input.intents) {
    const held = heldByReminder.get(intent.reminderId) ?? [];
    const wanted = intent.fires && input.permission === 'granted'
      ? intent.dates.map((localDate) => reminderNotificationIdentifier(intent.reminderId, localDate))
      : [];
    const wantedSet = new Set(wanted);
    for (const identifier of held) if (!wantedSet.has(identifier)) cancel.push(identifier);
    const heldSet = new Set(held);
    for (const [at, identifier] of wanted.entries()) {
      if (heldSet.has(identifier)) continue;
      schedule.push(Object.freeze({
        body: reminderNotificationBody(intent),
        habitId: intent.habitId,
        identifier,
        localDate: intent.dates[at],
        localTime: intent.triggerLocalTime,
        reminderId: intent.reminderId,
        title: intent.title,
      }));
    }
    const status = reminderStatusFor({
      fires: intent.fires,
      missing: wanted.filter((identifier) => !heldSet.has(identifier)).length,
      permission: input.permission,
      wanted: wanted.length,
    });
    const first = wanted[0] ?? null;
    // The minute the request was made **for**, kept for `queued` as well as for
    // `scheduled`: it is what lets the next reconciliation see that intent has moved,
    // and a reminder waiting on the OS was still asked for a particular minute.
    const scheduledFor = wanted.length > 0 ? intent.triggerLocalTime : null;
    const previous = projected.get(intent.reminderId);
    // Nothing is written where nothing moved: a projection that already says this is
    // left alone, so reconciliation on an unchanged day writes no rows at all.
    if (
      previous !== undefined
      && previous.status === status
      && previous.systemIdentifier === first
      && previous.scheduledFor === scheduledFor
    ) continue;
    projections.push(Object.freeze({
      reminderId: intent.reminderId,
      scheduledFor,
      status,
      systemIdentifier: first,
    }));
  }

  // An identifier of ours whose reminder is not in the intent list at all: the item was
  // deleted, or the reminder was, while the application was not running.
  for (const [reminderId, identifiers] of heldByReminder) {
    if (known.has(reminderId)) continue;
    for (const identifier of identifiers) cancel.push(identifier);
  }

  return Object.freeze({
    cancel: Object.freeze([...new Set(cancel)].sort()),
    projections: Object.freeze(projections),
    schedule: Object.freeze(schedule),
  });
}

/**
 * What a reminder's row should say about where it stands.
 *
 * **`queued` means a request is outstanding**, not merely that notifications are wanted:
 * a reminder whose whole window the OS is already holding is `scheduled` and has nothing
 * pending, and saying `queued` about it would make every reconciliation look like work
 * in progress. The service turns `queued` into `scheduled` or `failed` once the OS has
 * answered the requests this plan carries.
 *
 * A reminder that fires but has **no occurrence** in the window — a habit whose next run
 * is a month out — is `cancelled` rather than pending: there is nothing to hold, and
 * saying otherwise would claim a notification exists.
 */
export function reminderStatusFor(input: Readonly<{
  fires: boolean;
  permission: ReminderPermission;
  wanted: number;
  /** How many of the wanted identifiers the OS is not holding yet. */
  missing: number;
}>): ReminderScheduleStatus {
  if (!input.fires) return 'cancelled';
  if (input.permission === 'denied') return 'permission_required';
  if (input.permission === 'undetermined') return 'not_requested';
  if (input.wanted === 0) return 'cancelled';
  return input.missing > 0 ? 'queued' : 'scheduled';
}

/**
 * What a reminder row says out loud, once the OS has answered.
 *
 * A `scheduled` status means **accepted by the OS, not delivered** — focus modes, device
 * state and OS policy all sit between the two, and the contract says so in as many
 * words. The wording here promises acceptance and no more.
 */
export function reminderStatusLabel(status: ReminderScheduleStatus, localTime: string | null): string {
  switch (status) {
    case 'scheduled': return localTime === null ? 'Set' : localTime;
    case 'queued': return 'Setting up…';
    case 'permission_required': return 'Needs permission';
    case 'failed': return 'Could not be set';
    case 'cancelled': return 'Off';
    case 'not_requested': return localTime === null ? 'not set' : localTime;
  }
}

/**
 * What a person meant by touching a reminder.
 *
 * Two things they can mean and one they cannot yet. **Opening** is the banner itself:
 * it should land on the item, on the day the reminder was about, because a reminder
 * arriving on Tuesday about Tuesday's run should not open Thursday. **Completing** is the
 * action button, which closes the item without opening anything.
 *
 * The payload is read defensively because it crosses the operating system: it was written
 * by a build that may no longer be the one running, and a notification scheduled a
 * fortnight ago outlives an upgrade.
 */
export type ReminderResponseIntent =
  | Readonly<{ kind: 'open'; habitId: string; localDate: string }>
  | Readonly<{ kind: 'complete'; habitId: string; localDate: string }>
  | null;

/** The action a «Done» button carries, and the only one this application registers. */
export const REMINDER_ACTION_DONE = 'lifeplanner.reminder.done';

/** The category every reminder is posted under, so its buttons are the ones it declared. */
export const REMINDER_CATEGORY = 'lifeplanner.reminder';

export function reminderResponseIntent(input: Readonly<{
  actionIdentifier?: unknown;
  data?: unknown;
}>): ReminderResponseIntent {
  const data = input.data as Readonly<{ habitId?: unknown; localDate?: unknown }> | null | undefined;
  const habitId = typeof data?.habitId === 'string' && data.habitId !== '' ? data.habitId : null;
  const localDate = typeof data?.localDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.localDate) ? data.localDate : null;
  if (habitId === null || localDate === null) return null;
  return input.actionIdentifier === REMINDER_ACTION_DONE
    ? Object.freeze({ habitId, kind: 'complete' as const, localDate })
    : Object.freeze({ habitId, kind: 'open' as const, localDate });
}
