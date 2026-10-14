import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { failure, success } from '../../../src/features/planner/domain';
import { createPlannerPersistenceError } from '../../../src/features/planner/repositories';
import {
  reconcileReminderNotifications,
  type ReminderNotificationGateway,
} from '../../../src/features/planner/application/notifications/reconcile-reminder-notifications';
import {
  isReminderNotificationIdentifier,
  reminderIdOfNotification,
  reminderNotificationIdentifier,
  reminderNotificationBody,
  reminderNotificationPlan,
  reminderStatusFor,
  reminderStatusLabel,
  REMINDER_IDENTIFIER_PREFIX,
  REMINDER_SCHEDULE_STATUSES,
  REMINDER_WINDOW_DAYS,
  type ReminderIntent,
  type ReminderPermission,
  type ReminderProjection,
  type ReminderProjectionWrite,
  type ReminderScheduleRequest,
} from '../../../src/features/planner/application/notifications/reminder-notification-plan';

const plan = readFileSync('src/features/planner/application/notifications/reminder-notification-plan.ts', 'utf8');

const intent = (overrides: Partial<ReminderIntent> = {}): ReminderIntent => ({
  dates: ['2026-08-01', '2026-08-02'],
  fires: true,
  habitId: 'h1',
  reminderId: 'r1',
  title: 'Gym',
  triggerLocalTime: '07:00',
  ...overrides,
});

const projection = (overrides: Partial<ReminderProjection> = {}): ReminderProjection => ({
  reminderId: 'r1',
  scheduledFor: '07:00',
  status: 'scheduled',
  systemIdentifier: reminderNotificationIdentifier('r1', '2026-08-01'),
  ...overrides,
});

const identifiers = (reminderId: string, dates: readonly string[]) =>
  dates.map((date) => reminderNotificationIdentifier(reminderId, date));

// ── The identifier namespace ────────────────────────────────────────────────

test('every identifier this application owns says so, and can be read back', () => {
  const identifier = reminderNotificationIdentifier('r1', '2026-08-01');
  assert.equal(identifier, `${REMINDER_IDENTIFIER_PREFIX}r1.2026-08-01`);
  assert.equal(isReminderNotificationIdentifier(identifier), true);
  assert.equal(reminderIdOfNotification(identifier), 'r1');
  // Requesting our own identifier is what lets reconciliation tell one of ours from
  // anything else the OS is holding — and therefore cancel an orphan rather than
  // everything.
  assert.equal(isReminderNotificationIdentifier('some-other-app-thing'), false);
  assert.equal(reminderIdOfNotification('some-other-app-thing'), null);
  // A reminder id containing a dot still reads back whole: the date is the last part.
  assert.equal(reminderIdOfNotification(reminderNotificationIdentifier('a.b.c', '2026-08-01')), 'a.b.c');
  assert.equal(reminderIdOfNotification(`${REMINDER_IDENTIFIER_PREFIX}nodate`), null);
});

// ── The plan ────────────────────────────────────────────────────────────────

test('a reminder wants one notification per day its habit actually runs', () => {
  // **Not a daily trigger.** A daily one is a line of code and nags on Tuesday about a
  // Monday-Wednesday-Friday habit; dated one-shots over a window fire only on the days
  // the schedule produced, and every reconciliation tops the window back up.
  const result = reminderNotificationPlan({
    held: [],
    intents: [intent({ dates: ['2026-08-03', '2026-08-05', '2026-08-07'] })],
    permission: 'granted',
    projections: [],
  });
  assert.deepEqual(result.schedule.map(({ localDate }) => localDate), ['2026-08-03', '2026-08-05', '2026-08-07']);
  assert.deepEqual(result.schedule.map(({ localTime }) => localTime), ['07:00', '07:00', '07:00']);
  assert.deepEqual(result.cancel, []);
  assert.deepEqual(result.projections, [{
    reminderId: 'r1',
    scheduledFor: '07:00',
    status: 'queued',
    systemIdentifier: reminderNotificationIdentifier('r1', '2026-08-03'),
  }]);
  assert.ok(REMINDER_WINDOW_DAYS >= 7, 'the window has to outlast a weekly habit');
});

test('what the OS already holds is left alone, and only the difference moves', () => {
  const dates = ['2026-08-01', '2026-08-02', '2026-08-03'];
  const result = reminderNotificationPlan({
    held: identifiers('r1', ['2026-08-01', '2026-08-02']),
    intents: [intent({ dates })],
    permission: 'granted',
    projections: [],
  });
  // Only the third is missing, so only the third is asked for: reconciliation on a day
  // where nothing changed does no work at all.
  assert.deepEqual(result.schedule.map(({ localDate }) => localDate), ['2026-08-03']);
  assert.deepEqual(result.cancel, []);
});

test('a projection that already says this writes no row', () => {
  const dates = ['2026-08-01', '2026-08-02'];
  const quiet = reminderNotificationPlan({
    held: identifiers('r1', dates),
    intents: [intent({ dates })],
    permission: 'granted',
    projections: [projection({ status: 'scheduled' })],
  });
  assert.deepEqual(quiet.schedule, []);
  assert.deepEqual(quiet.cancel, []);
  assert.deepEqual(quiet.projections, []);
});

test('the held set is the authority, not the projection', () => {
  // A row saying `scheduled` for an identifier the OS has forgotten — dropped on a
  // restore, cleared by the system — is a row to act on rather than a reason to sit
  // still. This is the case a projection-only reconciliation gets silently wrong.
  const result = reminderNotificationPlan({
    held: [],
    intents: [intent({ dates: ['2026-08-01'] })],
    permission: 'granted',
    projections: [projection({ status: 'scheduled' })],
  });
  assert.deepEqual(result.schedule.map(({ identifier }) => identifier), [reminderNotificationIdentifier('r1', '2026-08-01')]);
});

test('a moved trigger time schedules the replacement before cancelling the old', () => {
  // The contract asks for a failure-safe sequence, and this is the only order that is
  // one: cancel first and a failing schedule leaves the person with no reminder, where
  // this way round leaves them with one too many for a day.
  const result = reminderNotificationPlan({
    held: identifiers('r1', ['2026-08-01']),
    intents: [intent({ dates: ['2026-08-02'], triggerLocalTime: '08:30' })],
    permission: 'granted',
    projections: [projection()],
  });
  assert.deepEqual(result.schedule.map(({ identifier }) => identifier), [reminderNotificationIdentifier('r1', '2026-08-02')]);
  assert.deepEqual(result.cancel, identifiers('r1', ['2026-08-01']));
  assert.equal(result.projections[0]?.scheduledFor, '08:30');
  // Stated as an invariant of the type rather than of this one case: the plan carries
  // the two lists separately, so the caller cannot interleave them and the order is the
  // failure-safe one by construction.
  assert.match(plan, /To be cancelled \*\*after\*\* the replacements are scheduled/);
});

test('a reminder that no longer fires loses every notification and says so', () => {
  for (const dates of [['2026-08-01', '2026-08-02'], []]) {
    const result = reminderNotificationPlan({
      held: identifiers('r1', ['2026-08-01', '2026-08-02']),
      intents: [intent({ dates, fires: false })],
      permission: 'granted',
      projections: [projection()],
    });
    assert.deepEqual(result.schedule, []);
    assert.deepEqual(result.cancel, identifiers('r1', ['2026-08-01', '2026-08-02']));
    assert.deepEqual(result.projections, [{ reminderId: 'r1', scheduledFor: null, status: 'cancelled', systemIdentifier: null }]);
  }
});

test('denial keeps the configuration and schedules nothing', () => {
  // The contract is explicit: denial saves the reminder configuration and reports
  // `permission_required`. Nothing about the habit changes and nothing is deleted.
  const result = reminderNotificationPlan({
    held: identifiers('r1', ['2026-08-01']),
    intents: [intent()],
    permission: 'denied',
    projections: [projection()],
  });
  assert.deepEqual(result.schedule, []);
  assert.deepEqual(result.cancel, identifiers('r1', ['2026-08-01']));
  assert.deepEqual(result.projections, [{ reminderId: 'r1', scheduledFor: null, status: 'permission_required', systemIdentifier: null }]);
});

test('permission never asked for is not the same as permission refused', () => {
  const result = reminderNotificationPlan({
    held: [],
    intents: [intent()],
    permission: 'undetermined',
    projections: [],
  });
  assert.deepEqual(result.schedule, []);
  assert.equal(result.projections[0]?.status, 'not_requested');
});

test('an identifier of ours belonging to nothing is an orphan and is cancelled', () => {
  // The item was deleted while the application was closed, so its notifications are
  // still in the OS and nothing in the database points at them any more.
  const result = reminderNotificationPlan({
    held: [...identifiers('gone', ['2026-08-01', '2026-08-02']), ...identifiers('r1', ['2026-08-01'])],
    intents: [intent({ dates: ['2026-08-01'] })],
    permission: 'granted',
    projections: [projection()],
  });
  assert.deepEqual(result.cancel, identifiers('gone', ['2026-08-01', '2026-08-02']));
  assert.deepEqual(result.schedule, []);
});

test('nothing that is not ours is ever cancelled', () => {
  const foreign = ['another.app.thing', 'calendar-42'];
  const result = reminderNotificationPlan({
    held: foreign,
    intents: [],
    permission: 'granted',
    projections: [],
  });
  assert.deepEqual(result.cancel, []);
  // Even with permission denied, when everything ours goes, theirs stays.
  const denied = reminderNotificationPlan({ held: foreign, intents: [intent()], permission: 'denied', projections: [] });
  assert.deepEqual(denied.cancel, []);
});

// ── Statuses ────────────────────────────────────────────────────────────────

test('the six statuses are the contract six, and each is reached by one rule', () => {
  assert.deepEqual([...REMINDER_SCHEDULE_STATUSES], ['not_requested', 'permission_required', 'queued', 'scheduled', 'failed', 'cancelled']);
  assert.equal(reminderStatusFor({ fires: false, missing: 0, permission: 'granted', wanted: 3 }), 'cancelled');
  assert.equal(reminderStatusFor({ fires: true, missing: 3, permission: 'denied', wanted: 3 }), 'permission_required');
  assert.equal(reminderStatusFor({ fires: true, missing: 3, permission: 'undetermined', wanted: 3 }), 'not_requested');
  // **`queued` means a request is outstanding**, not merely that notifications are
  // wanted: a window the OS already holds is `scheduled` and has nothing pending.
  assert.equal(reminderStatusFor({ fires: true, missing: 3, permission: 'granted', wanted: 3 }), 'queued');
  assert.equal(reminderStatusFor({ fires: true, missing: 1, permission: 'granted', wanted: 3 }), 'queued');
  assert.equal(reminderStatusFor({ fires: true, missing: 0, permission: 'granted', wanted: 3 }), 'scheduled');
  // A firing reminder with nothing in the window — a habit whose next run is a month
  // out — is not pending either: there is nothing to hold.
  assert.equal(reminderStatusFor({ fires: true, missing: 0, permission: 'granted', wanted: 0 }), 'cancelled');
  // `failed` is the OS's answer alone, so no rule here produces it.
  assert.notEqual(reminderStatusFor({ fires: true, missing: 1, permission: 'granted', wanted: 1 }), 'failed');
});

test('a status reads as what it is, and promises acceptance rather than delivery', () => {
  assert.equal(reminderStatusLabel('scheduled', '07:00'), '07:00');
  assert.equal(reminderStatusLabel('queued', '07:00'), 'Setting up…');
  assert.equal(reminderStatusLabel('permission_required', '07:00'), 'Needs permission');
  assert.equal(reminderStatusLabel('failed', '07:00'), 'Could not be set');
  assert.equal(reminderStatusLabel('cancelled', '07:00'), 'Off');
  assert.equal(reminderStatusLabel('not_requested', null), 'not set');
  // Nothing here says «delivered» or «will fire»: focus modes, device state and OS
  // policy all sit between acceptance and delivery, and the contract says so.
  for (const status of REMINDER_SCHEDULE_STATUSES) {
    assert.doesNotMatch(reminderStatusLabel(status, '07:00'), /deliver|will fire|guarantee/i);
  }
});

test('the plan knows nothing about Expo, a database or a clock', () => {
  // Every rule above is asserted in the Node runner, which is only possible while this
  // module imports none of the three.
  assert.doesNotMatch(plan, /expo-notifications|expo-sqlite|from 'expo/);
  assert.doesNotMatch(plan, /Date\.now\(\)|new Date\(/);
  // Whether a reminder fires at all is a question about a habit's schedule, its
  // lifecycle and whether a task is already closed — decided by the caller, where each
  // of those is known, so this module cannot disagree with any of them.
  assert.match(plan, /`fires` is the caller's answer/);
});

// -- The service, against a fake operating system ----------------------------

interface FakeOs {
  readonly gateway: ReminderNotificationGateway;
  readonly scheduled: Map<string, ReminderScheduleRequest>;
  readonly cancelled: string[];
}

function fakeOs(options: Readonly<{ permission?: ReminderPermission; held?: readonly string[]; refuse?: (identifier: string) => boolean }> = {}): FakeOs {
  const scheduled = new Map<string, ReminderScheduleRequest>();
  const cancelled: string[] = [];
  const held = new Set(options.held ?? []);
  return {
    cancelled,
    gateway: {
      async cancel(identifier) { cancelled.push(identifier); held.delete(identifier); },
      async held() { return [...held]; },
      async permission() { return options.permission ?? 'granted'; },
      async schedule(request) {
        if (options.refuse?.(request.identifier) === true) throw new Error('the OS refused it');
        scheduled.set(request.identifier, request);
        held.add(request.identifier);
        // The operating system is the authority on its own identifiers, so the fake
        // answers with one of its own rather than echoing what it was asked for.
        return `os-${request.identifier}`;
      },
    },
    scheduled,
  };
}

test('the service asks, acts in the plan order, and records what the system answered', async () => {
  const os = fakeOs();
  const written: ReminderProjectionWrite[] = [];
  const report = await reconcileReminderNotifications({
    gateway: os.gateway,
    intents: [intent({ dates: ['2026-08-01', '2026-08-02'] })],
    loadProjections: async () => success([]),
    saveProjections: async (writes) => { written.push(...writes); return success(writes.length); },
  });
  assert.equal(report.ok, true);
  assert.deepEqual([...os.scheduled.keys()], identifiers('r1', ['2026-08-01', '2026-08-02']));
  // `queued` was honest while the request was outstanding. It has been answered, so the
  // row says `scheduled` and carries **the system's own identifier**, not the requested one.
  assert.deepEqual(written, [{
    failureReason: null,
    reminderId: 'r1',
    scheduledFor: '07:00',
    status: 'scheduled',
    systemIdentifier: `os-${reminderNotificationIdentifier('r1', '2026-08-01')}`,
  }]);
});

test('one refusal is that reminder failing, not the run failing', async () => {
  // The contract says a scheduling failure never changes the habit; the same reasoning
  // says it must not stop the other nine reminders being set either.
  const first = reminderNotificationIdentifier('r1', '2026-08-01');
  const os = fakeOs({ refuse: (identifier) => identifier === first });
  const written: ReminderProjectionWrite[] = [];
  const report = await reconcileReminderNotifications({
    gateway: os.gateway,
    intents: [
      intent({ dates: ['2026-08-01'] }),
      intent({ dates: ['2026-08-02'], habitId: 'h2', reminderId: 'r2', title: 'Read' }),
    ],
    loadProjections: async () => success([]),
    saveProjections: async (writes) => { written.push(...writes); return success(writes.length); },
  });
  assert.equal(report.ok, true);
  if (report.ok) assert.deepEqual([report.value.scheduled, report.value.failed], [1, 1]);
  // The refused one says `failed` **and why**; the other is scheduled regardless.
  const failed = written.find(({ reminderId }) => reminderId === 'r1');
  assert.equal(failed?.status, 'failed');
  assert.equal(failed?.failureReason, 'the OS refused it');
  assert.equal(written.find(({ reminderId }) => reminderId === 'r2')?.status, 'scheduled');
});

test('a cancel the system cannot honour is already in the state it was asked for', async () => {
  const os = fakeOs({ held: identifiers('gone', ['2026-08-01']) });
  const failing: ReminderNotificationGateway = {
    ...os.gateway,
    cancel: async () => { throw new Error('no such notification'); },
  };
  const report = await reconcileReminderNotifications({
    gateway: failing,
    intents: [],
    loadProjections: async () => success([]),
    saveProjections: async () => success(0),
  });
  // Not an error: a notification that cannot be cancelled because it is not there is in
  // exactly the state the cancel was asking for.
  assert.equal(report.ok, true);
  if (report.ok) assert.equal(report.value.cancelled, 0);
});

test('the run reports the permission it found, and schedules nothing without it', async () => {
  const os = fakeOs({ held: identifiers('r1', ['2026-08-01']), permission: 'denied' });
  const written: ReminderProjectionWrite[] = [];
  const report = await reconcileReminderNotifications({
    gateway: os.gateway,
    intents: [intent()],
    loadProjections: async () => success([projection()]),
    saveProjections: async (writes) => { written.push(...writes); return success(writes.length); },
  });
  assert.equal(report.ok, true);
  if (report.ok) assert.deepEqual([report.value.permission, report.value.scheduled], ['denied', 0]);
  assert.equal(os.scheduled.size, 0);
  // The configuration is kept, and the row says what is missing.
  assert.equal(written[0]?.status, 'permission_required');
  assert.deepEqual(os.cancelled, identifiers('r1', ['2026-08-01']));
});

test('a read that fails stops the run rather than scheduling against nothing', async () => {
  const os = fakeOs();
  const report = await reconcileReminderNotifications({
    gateway: os.gateway,
    intents: [intent()],
    loadProjections: async () => failure(createPlannerPersistenceError('database_failure', 'no')),
    saveProjections: async () => success(0),
  });
  assert.equal(report.ok, false);
  // Nothing was touched: reconciling against a projection that could not be read would
  // reschedule everything the system is already holding.
  assert.equal(os.scheduled.size, 0);
  assert.deepEqual(os.cancelled, []);
});

test('only the gateway knows Expo, and the reminder row no longer promises silence', () => {
  const gateway = readFileSync('src/features/planner/infrastructure/notifications/expo-reminder-notification-gateway.ts', 'utf8');
  const service = readFileSync('src/features/planner/application/notifications/reconcile-reminder-notifications.ts', 'utf8');
  const composed = readFileSync('src/features/planner/application/notifications/reconcile-reminders.ts', 'utf8');
  const provider = readFileSync('src/features/planner/presentation/planner-provider.tsx', 'utf8');
  const create = readFileSync('src/features/planner/presentation/create-item-screen.tsx', 'utf8');
  const sheets = readFileSync('src/features/planner/presentation/create-item-sheets.tsx', 'utf8');

  // One file imports the package, and it is the adapter.
  assert.match(gateway, /from 'expo-notifications'/);
  // The **import**, not the word: each of these three explains in prose why it does not
  // import the package, and an assertion that matched prose would fail on the explanation.
  for (const source of [service, composed, plan]) assert.doesNotMatch(source, /from 'expo-notifications'/);
  // **Local only**: no push token, no project id, no server.
  assert.doesNotMatch(gateway, /getExpoPushToken|projectId|getDevicePushToken/);
  // A dated one-shot rather than a repeating trigger, because the plan already chose the
  // days from the habit's own schedule.
  assert.match(gateway, /SchedulableTriggerInputTypes\.DATE/);
  assert.doesNotMatch(gateway, /SchedulableTriggerInputTypes\.(DAILY|WEEKLY|CALENDAR)/);
  // Reconciled at launch and on foreground — and **not** on every refresh, because a tick
  // of a checkbox bumps that and re-walking a fortnight per tick spends the day's battery.
  assert.match(provider, /nextState === 'active'[\s\S]{0,140}reconcileReminders\(\)/);
  assert.match(provider, /\}, \[reconcileReminders, refreshOccurrences\]\)/);
  // Permission is asked for where the reminder is set, and only when one was actually set.
  assert.match(create, /reminderTriggerTime\(value, plannedTime\) !== null/);
  assert.match(create, /void requestReminderPermission\(\)\.then\(setReminderPermission\)/);
  // And the two places that promised no alert no longer do.
  assert.doesNotMatch(create, /no notification package is a dependency/);
  assert.doesNotMatch(sheets, /does not deliver notifications yet/);
  // What replaced it promises acceptance rather than delivery.
  assert.match(sheets, /accepted by the phone, which is not the same as delivered/);
});

// -- What it says, and that it is seen ---------------------------------------

test('the body says when the thing itself is, which the title cannot', () => {
  // A reminder ten minutes early is the ordinary case: the offset is resolved into a
  // trigger time before it is stored, so the item's own minute is the fact worth adding.
  assert.equal(reminderNotificationBody({ plannedLocalTime: '07:30', triggerLocalTime: '07:20' }), 'Starts at 07:30');
  // Where the two coincide there is nothing to add, and repeating the trigger would only
  // restate what the notification's own timestamp already shows.
  assert.equal(reminderNotificationBody({ plannedLocalTime: '07:00', triggerLocalTime: '07:00' }), 'Reminder');
  // An item with no minute of its own — an Anytime habit — has nothing to say either.
  assert.equal(reminderNotificationBody({ plannedLocalTime: null, triggerLocalTime: '07:00' }), 'Reminder');
  assert.equal(reminderNotificationBody({ triggerLocalTime: '07:00' }), 'Reminder');
  // And it is never the item's name: that is the title, and a body repeating it is noise.
  const request = reminderNotificationPlan({
    held: [],
    intents: [intent({ dates: ['2026-08-01'], plannedLocalTime: '07:30' })],
    permission: 'granted',
    projections: [],
  }).schedule[0];
  assert.deepEqual([request?.title, request?.body], ['Gym', 'Starts at 07:30']);
});

test('a reminder is seen while the application is open, and heard', () => {
  const gateway = readFileSync('src/features/planner/infrastructure/notifications/expo-reminder-notification-gateway.ts', 'utf8');
  const layout = readFileSync('app/_layout.tsx', 'utf8');

  // **iOS shows nothing by default when the app is in the foreground** — it hands the
  // notification over and expects the application to decide. Without this a reminder
  // arriving while a person is looking at the day never appears at all.
  assert.match(gateway, /Notifications\.setNotificationHandler/);
  assert.match(gateway, /shouldShowBanner: true/);
  assert.match(gateway, /shouldShowList: true/);
  assert.match(gateway, /shouldPlaySound: true/);
  // The badge is left alone: nothing in this application counts anything on an icon, and
  // a number that only ever grows is worse than none.
  assert.match(gateway, /shouldSetBadge: false/);
  // The system sound, said explicitly rather than left to a platform default.
  assert.match(gateway, /sound: 'default'/);
  // **At module scope**, because a handler installed inside a render is installed after
  // the first notification could already have been handed over.
  assert.match(layout, /^configureReminderNotificationPresentation\(\);$/m);
  assert.doesNotMatch(layout, /useEffect\([^)]*configureReminderNotificationPresentation/);
});
