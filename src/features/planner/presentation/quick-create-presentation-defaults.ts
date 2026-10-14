import type { PlannerLocalDate } from '../domain';

import {
  createDefaultScheduleDraft,
  createDefaultTrackingDraft,
  type ActiveRangeDraft,
  type ScheduleDraft,
  type TrackingDraft,
} from './ui-adapters';

export interface QuickCreatePresentationDefaults {
  readonly activeRange: ActiveRangeDraft;
  readonly schedule: ScheduleDraft;
  readonly tracking: TrackingDraft;
}

export function createQuickCreatePresentationDefaults(
  selectedDate: PlannerLocalDate,
): QuickCreatePresentationDefaults {
  return Object.freeze({
    activeRange: Object.freeze({
      activeFrom: selectedDate,
      activeTo: '',
    }),
    schedule: createDefaultScheduleDraft(selectedDate),
    tracking: createDefaultTrackingDraft(),
  });
}
