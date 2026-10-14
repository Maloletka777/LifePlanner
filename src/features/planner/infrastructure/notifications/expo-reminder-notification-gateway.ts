import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import type { ReminderNotificationGateway } from '../../application/notifications/reconcile-reminder-notifications';
import {
  reminderResponseIntent,
  REMINDER_ACTION_DONE,
  REMINDER_CATEGORY,
  type ReminderPermission,
  type ReminderResponseIntent,
  type ReminderScheduleRequest,
} from '../../application/notifications/reminder-notification-plan';

/**
 * Whether this platform can deliver a local notification at all.
 *
 * The web target is a bench for looking at the interface — there is no iOS simulator on the
 * machine this is developed from — and `expo-notifications` has no web implementation: its
 * methods throw rather than return, which stops the screen being usable. Reminders are an
 * iOS contract (PD-NOTIFY-002) and nothing about it changes.
 */
const REMINDERS_ARE_DELIVERABLE = Platform.OS !== 'web';

/**
 * The one file in this application that knows `expo-notifications` exists.
 *
 * Everything above it — the plan, the reconciliation, the statuses — is written against
 * `ReminderNotificationGateway` and is therefore asserted in the Node test runner against
 * a fake. That is the whole reason for the port: a rule about *when* a notification should
 * exist has no business being unverifiable because the OS is unavailable.
 *
 * **Local notifications only.** No push token is requested, no project id is read and no
 * server is contacted — `docs/Notifications.md` excludes remote push from the MVP, and a
 * gateway that quietly asked for a push token would be the beginning of it.
 */

/**
 * A reminder is a dated one-shot, and its trigger is an absolute `Date`.
 *
 * `DATE` rather than `DAILY` or `CALENDAR`: the plan already decided **which days**, from
 * the habit's own schedule, so the OS is told a moment rather than a rule. A recurring
 * trigger would put a second schedule inside the operating system, and two schedules for
 * one habit is exactly the disagreement this application spends its time preventing.
 */
function triggerFor(request: ReminderScheduleRequest): Notifications.DateTriggerInput | null {
  // Parsed here rather than borrowed from a model above: this is the boundary where a
  // stored local date and time become the operating system's own `Date`, and an adapter
  // that reached up into presentation for it would invert the layering to save four lines.
  const time = /^(\d{2}):(\d{2})$/.exec(request.localTime);
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(request.localDate);
  if (time === null || date === null) return null;
  const [year, month, day] = [Number(date[1]), Number(date[2]), Number(date[3])];
  const minute = Number(time[1]) * 60 + Number(time[2]);
  if (Number(time[1]) > 23 || Number(time[2]) > 59 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Built in the device's own zone, because a reminder's local time is local: the
  // constructor's arguments are local, which is the one thing that makes 07:00 mean 07:00
  // wherever the phone is.
  const when = new Date(year, month - 1, day, Math.floor(minute / 60), minute % 60, 0, 0);
  return { date: when, type: Notifications.SchedulableTriggerInputTypes.DATE };
}

function permissionOf(status: Notifications.NotificationPermissionsStatus): ReminderPermission {
  if (status.granted) return 'granted';
  // **Undetermined is not denial.** Asked and refused is a decision to respect; never
  // asked is a question not yet put, and the two must not read the same — one of them is
  // `permission_required` and the other is `not_requested`.
  return status.canAskAgain && status.status === Notifications.PermissionStatus.UNDETERMINED
    ? 'undetermined'
    : 'denied';
}

export function createExpoReminderNotificationGateway(): ReminderNotificationGateway {
  // A gateway that holds nothing and refuses nothing, for a platform that delivers nothing.
  // Reconciliation then finds an empty held set and writes its rows exactly as it would if
  // the operating system had forgotten everything — a state its own rules already cover.
  if (!REMINDERS_ARE_DELIVERABLE) {
    return Object.freeze({
      cancel: async () => undefined,
      held: async () => Object.freeze([]),
      permission: async () => 'denied' as const,
      schedule: async () => { throw new Error('Reminders are not delivered on this platform.'); },
    });
  }
  return Object.freeze({
    async cancel(identifier: string): Promise<void> {
      await Notifications.cancelScheduledNotificationAsync(identifier);
    },
    async held(): Promise<readonly string[]> {
      const scheduled = await Notifications.getAllScheduledNotificationsAsync();
      return Object.freeze(scheduled.map((request) => request.identifier));
    },
    async permission(): Promise<ReminderPermission> {
      return permissionOf(await Notifications.getPermissionsAsync());
    },
    async schedule(request: ReminderScheduleRequest): Promise<string> {
      const trigger = triggerFor(request);
      // A moment that cannot be built is a refusal rather than a silent skip: the
      // reconciliation records `failed` against that reminder and the rest of the run
      // carries on.
      if (trigger === null) throw new Error(`A reminder for ${request.localDate} ${request.localTime} is not a moment.`);
      return Notifications.scheduleNotificationAsync({
        content: {
          body: request.body,
          // Which item, and which day it was about — so a tap opens that item on that day
          // rather than on today, and a «Done» closes the right occurrence.
          categoryIdentifier: REMINDER_CATEGORY,
          data: { habitId: request.habitId, localDate: request.localDate, reminderId: request.reminderId },
          // The system sound, said explicitly: a reminder nobody hears is a reminder
          // nobody set, and the default is silent on some platform defaults.
          sound: 'default',
          title: request.title,
        },
        identifier: request.identifier,
        trigger,
      });
    },
  });
}

/**
 * The buttons a reminder carries, declared once.
 *
 * One action and not three: «Done» writes an observation, which this application already
 * has a command for. **«Snooze» is deliberately absent** — moving an occurrence to another
 * minute needs a per-date occurrence time that no canonical command sets, the same gap
 * that blocked the drawn `↻` and bulk `Reschedule` (PD-TODAY-098). A button that looked
 * like it worked would be worse than one that is not there.
 */
export async function configureReminderNotificationActions(): Promise<void> {
  // **Nothing to configure where nothing can be delivered.** The web target exists only as a
  // bench for looking at the interface, and `expo-notifications` has no implementation there
  // — calling it throws rather than returning, which stops the screen being usable at all.
  // Reminders are an iOS contract (PD-NOTIFY-002) and this changes nothing about it.
  if (!REMINDERS_ARE_DELIVERABLE) return;
  await Notifications.setNotificationCategoryAsync(REMINDER_CATEGORY, [
    {
      buttonTitle: 'Done',
      identifier: REMINDER_ACTION_DONE,
      // It closes the item and nothing else: no text to type, and no reason to bring the
      // application to the front for a thing the person has just said is finished.
      options: { opensAppToForeground: false },
    },
  ]);
}

/**
 * What the person did with a reminder, whenever they did it.
 *
 * Two sources and both are needed. The listener catches a response while the application
 * is running; `getLastNotificationResponseAsync` catches the one that **launched** it,
 * which the listener never sees and which is the ordinary case for a notification acted on
 * from a locked phone.
 */
export function addReminderResponseListener(handle: (intent: ReminderResponseIntent) => void): () => void {
  if (!REMINDERS_ARE_DELIVERABLE) return () => undefined;
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    handle(reminderResponseIntent({
      actionIdentifier: response.actionIdentifier,
      data: response.notification.request.content.data,
    }));
  });
  return () => subscription.remove();
}

export async function lastReminderResponse(): Promise<ReminderResponseIntent> {
  if (!REMINDERS_ARE_DELIVERABLE) return null;
  const response = await Notifications.getLastNotificationResponseAsync();
  if (response === null) return null;
  return reminderResponseIntent({
    actionIdentifier: response.actionIdentifier,
    data: response.notification.request.content.data,
  });
}

/**
 * Makes a reminder visible while the application is open.
 *
 * **iOS shows nothing by default when the app is in the foreground** — it hands the
 * notification to the app and expects it to decide. Without this a reminder that arrives
 * while a person is looking at the day simply never appears, which is the one moment they
 * are most likely to be looking at the thing it is about.
 *
 * Called at module scope from the root layout rather than from a component: a handler
 * installed inside a render runs after the first notification could already have arrived.
 * The badge is left alone — nothing in this application counts anything on an icon, and a
 * number that only ever grows is worse than none.
 */
export function configureReminderNotificationPresentation(): void {
  if (!REMINDERS_ARE_DELIVERABLE) return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

/**
 * Asks, once, at the point a reminder is actually being set.
 *
 * Contextual by the contract's own instruction, which is also the only way the question
 * makes sense: a permission dialog at launch asks about something the person has not done
 * yet. Denial is returned rather than thrown — the caller keeps the configuration either
 * way, and the reminder simply reads `permission_required`.
 */
export async function requestReminderPermission(): Promise<ReminderPermission> {
  if (!REMINDERS_ARE_DELIVERABLE) return 'denied';
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return 'granted';
  if (!current.canAskAgain) return 'denied';
  return permissionOf(await Notifications.requestPermissionsAsync());
}
