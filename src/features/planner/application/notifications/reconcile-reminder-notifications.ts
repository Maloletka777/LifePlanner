import { failure, success, type Result } from '../../domain';
import type { PlannerPersistenceError } from '../../repositories';

import {
  reminderNotificationPlan,
  type ReminderIntent,
  type ReminderPermission,
  type ReminderProjection,
  type ReminderProjectionWrite,
  type ReminderScheduleRequest,
} from './reminder-notification-plan';

/**
 * Making the operating system hold what the person asked for.
 *
 * The decision of *what* should be held is `reminder-notification-plan.ts`, which is pure
 * and asserted. This is the half that has effects, and it is deliberately thin: it asks,
 * it acts in the order the plan requires, and it records what happened. Every dependency
 * arrives as a function, so the whole service runs in the Node test runner against a fake
 * OS — the real one is `expo-notifications` and it is not imported here.
 */

/** What the application needs of an operating system that posts notifications. */
export interface ReminderNotificationGateway {
  /** What the person has already allowed, without asking them anything. */
  permission(): Promise<ReminderPermission>;
  /** Every identifier the OS is currently holding for this application. */
  held(): Promise<readonly string[]>;
  /**
   * Asks for one notification, and answers with the identifier the OS issued.
   *
   * The identifier we requested is what should come back; the OS is the authority on its
   * own identifiers, so whatever it returns is what gets stored.
   */
  schedule(request: ReminderScheduleRequest): Promise<string>;
  cancel(identifier: string): Promise<void>;
}

export interface ReminderReconciliationReport {
  readonly permission: ReminderPermission;
  readonly scheduled: number;
  readonly cancelled: number;
  readonly failed: number;
  readonly written: number;
}

/**
 * Reconciles intent against what the OS holds, once.
 *
 * The contract calls for this at launch, on regaining focus, and after a permission
 * change — three moments, one walk. Nothing here is scheduled twice, because the plan
 * asks only for what is missing.
 *
 * **A failure never changes the habit and never stops the run.** The contract is explicit
 * about the first, and the second follows from it: one reminder the OS refuses is that
 * reminder's `failed` row, not an excuse to leave the other nine unscheduled. That is why
 * each request is caught individually rather than the batch being wrapped.
 *
 * **Cancelling comes after scheduling**, which the plan already separates into two lists
 * so this cannot get the order wrong — a cancel that ran first and a schedule that then
 * failed would leave the person with no reminder at all.
 */
export async function reconcileReminderNotifications(input: Readonly<{
  intents: readonly ReminderIntent[];
  loadProjections: () => Promise<Result<readonly ReminderProjection[], PlannerPersistenceError>>;
  saveProjections: (writes: readonly ReminderProjectionWrite[]) => Promise<Result<number, PlannerPersistenceError>>;
  gateway: ReminderNotificationGateway;
}>): Promise<Result<ReminderReconciliationReport, PlannerPersistenceError>> {
  const projections = await input.loadProjections();
  if (!projections.ok) return failure(projections.error);

  const permission = await input.gateway.permission();
  const held = await input.gateway.held();
  const plan = reminderNotificationPlan({
    held,
    intents: input.intents,
    permission,
    projections: projections.value,
  });

  // What the OS actually accepted, and what it refused, per reminder.
  const issued = new Map<string, string>();
  const refused = new Map<string, string>();
  for (const request of plan.schedule) {
    try {
      const identifier = await input.gateway.schedule(request);
      if (!issued.has(request.reminderId)) issued.set(request.reminderId, identifier);
    } catch (cause: unknown) {
      refused.set(request.reminderId, cause instanceof Error ? cause.message : String(cause));
    }
  }

  // Only now, and each on its own: an identifier the OS has already forgotten answers a
  // cancel with an error on some platforms, and that is not a reason to stop.
  let cancelled = 0;
  for (const identifier of plan.cancel) {
    try {
      await input.gateway.cancel(identifier);
      cancelled += 1;
    } catch {
      // Nothing to record: a notification that cannot be cancelled because it is not
      // there is in exactly the state the cancel was asking for.
    }
  }

  const writes = plan.projections.map<ReminderProjectionWrite>((write) => {
    const reason = refused.get(write.reminderId);
    if (reason !== undefined) {
      return Object.freeze({ ...write, failureReason: reason, status: 'failed' as const });
    }
    // `queued` was the honest answer while the request was outstanding. It has been
    // answered now, so the row says what the OS actually did — and carries the OS's own
    // identifier rather than the one we asked for.
    if (write.status !== 'queued') return Object.freeze({ ...write, failureReason: null });
    return Object.freeze({
      ...write,
      failureReason: null,
      status: 'scheduled' as const,
      systemIdentifier: issued.get(write.reminderId) ?? write.systemIdentifier,
    });
  });

  const saved = await input.saveProjections(writes);
  if (!saved.ok) return failure(saved.error);

  return success(Object.freeze({
    cancelled,
    failed: refused.size,
    permission,
    scheduled: plan.schedule.length - refused.size,
    written: saved.value,
  }));
}
