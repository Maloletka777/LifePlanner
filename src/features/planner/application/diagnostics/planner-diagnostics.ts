export function reportPlannerFailure(
  operation: string,
  failureClass: string,
  safeRecordIds: readonly string[] = [],
): void {
  if (!__DEV__) return;
  console.info('[LP_DIAGNOSTIC]', Object.freeze({
    operation,
    failureClass,
    recordIds: Object.freeze([...safeRecordIds]),
  }));
}

type PlannerPerfMetadata = Readonly<{
  count?: number;
  rangeDays?: number;
}>;

const plannerPerfCounts = new Map<string, number>();
const plannerPerfSpans = new Map<string, number>();
let plannerRenderWindow: { today: number; planner: number } | null = null;

export async function measurePlannerOperation<T>(
  operation: string,
  task: () => Promise<T>,
  metadata: PlannerPerfMetadata = {},
): Promise<T> {
  const start = plannerNow();
  try {
    return await task();
  } finally {
    reportPlannerPerformance(operation, plannerNow() - start, metadata);
  }
}

export function measurePlannerSynchronousOperation<T>(
  operation: string,
  task: () => T,
  metadata: PlannerPerfMetadata = {},
): T {
  const start = plannerNow();
  try {
    return task();
  } finally {
    reportPlannerPerformance(operation, plannerNow() - start, metadata);
  }
}

export function beginPlannerPerformanceSpan(operation: string): void {
  if (!plannerDiagnosticsEnabled()) return;
  plannerPerfSpans.set(operation, plannerNow());
}

export function endPlannerPerformanceSpan(
  operation: string,
  metadata: PlannerPerfMetadata = {},
): void {
  if (!plannerDiagnosticsEnabled()) return;
  const startedAt = plannerPerfSpans.get(operation);
  if (startedAt === undefined) return;
  plannerPerfSpans.delete(operation);
  reportPlannerPerformance(operation, plannerNow() - startedAt, metadata);
}

export function beginPlannerRenderWindow(): void {
  if (!plannerDiagnosticsEnabled()) return;
  plannerRenderWindow = { today: 0, planner: 0 };
}

export function countPlannerRender(screen: 'Today' | 'Planner'): void {
  if (plannerRenderWindow === null) return;
  if (screen === 'Today') plannerRenderWindow.today += 1;
  else plannerRenderWindow.planner += 1;
}

export function endPlannerRenderWindow(): void {
  if (plannerRenderWindow === null) return;
  reportPlannerPerformance('date_rail_drag_renders', 0, {
    count: plannerRenderWindow.today + plannerRenderWindow.planner,
  });
  if (plannerDiagnosticsEnabled()) {
    console.info('[LP_PERF]', Object.freeze({
      operation: 'date_rail_drag_render_breakdown',
      todayRenderCount: plannerRenderWindow.today,
      plannerRenderCount: plannerRenderWindow.planner,
    }));
  }
  plannerRenderWindow = null;
}

export function reportPlannerPerformance(
  operation: string,
  durationMs: number,
  metadata: PlannerPerfMetadata = {},
): void {
  if (!plannerDiagnosticsEnabled()) return;
  const count = (plannerPerfCounts.get(operation) ?? 0) + 1;
  plannerPerfCounts.set(operation, count);
  console.info('[LP_PERF]', Object.freeze({
    operation,
    count,
    durationMs: Math.round(durationMs * 10) / 10,
    ...metadata,
  }));
}

function plannerDiagnosticsEnabled(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__;
}

function plannerNow(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}
