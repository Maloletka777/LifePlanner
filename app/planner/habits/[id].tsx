import { Redirect, useLocalSearchParams } from 'expo-router';

/**
 * Habit detail is withdrawn — everything it carried is on Edit now.
 *
 * The route stays so an existing deep link still resolves, and it sends the reader
 * to the screen that holds the same information and can also change it.
 */
export default function HabitDetailRoute() {
  const { id, date } = useLocalSearchParams<{ id?: string | string[]; date?: string | string[] }>();
  const habitId = Array.isArray(id) ? id[0] : id;
  const asOf = Array.isArray(date) ? date[0] : date;
  if (habitId === undefined) return <Redirect href="/planner" />;
  return <Redirect href={{ pathname: '/planner/edit/[id]', params: { id: habitId, ...(asOf === undefined ? {} : { date: asOf }) } }} />;
}
