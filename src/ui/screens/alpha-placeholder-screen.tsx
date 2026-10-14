import { AppHeader, EmptyState, Screen, StatusLabel } from '@/src/ui/components';

export function AlphaPlaceholderScreen({
  title,
  message,
  more = false,
}: {
  readonly title: string;
  readonly message: string;
  readonly more?: boolean;
}) {
  return (
    <Screen>
      <AppHeader title={title} trailing={more ? <StatusLabel label="Development alpha" tone="info" /> : undefined} />
      <EmptyState
        message={more ? `${message} Your LifePlanner data stays on this device and works offline.` : message}
        title={`${title} is not implemented yet`}
      />
    </Screen>
  );
}
