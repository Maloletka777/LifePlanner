import { OverviewScreen } from '@/src/features/planner/presentation/overview-screen';

/**
 * The second tab is **Overview** now, not Planner.
 *
 * The route keeps its path so every `/planner/*` deep link — and the create and
 * edit routes beneath it — still resolves; the handoff calls the `/activities/*`
 * rename suggested rather than required, and doing it here would break links the
 * app already uses. `planner-screen.tsx` stays on disk, withdrawn by routing
 * exactly as Habit detail was (PD-DETAIL-002), so restoring it is a routing
 * decision rather than a rebuild.
 */
export default OverviewScreen;
