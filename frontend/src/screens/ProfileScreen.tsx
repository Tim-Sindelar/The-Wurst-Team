import { Alert, Avatar, Button, Card, Switch, Text } from '@mantine/core';
import { Screen, ScreenHeader, ScreenMain } from '../components/Screen';
import { SectionLabel } from '../components/SectionLabel';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { paths } from '../routes';

export function ProfileScreen() {
  const { user, initials, isPending, isError } = useCurrentUser();

  return (
    <Screen>
      <ScreenHeader
        title="Profile"
        backTo={paths.home}
        backLabel="Back to home"
      />

      <ScreenMain>
        <Card component="section" aria-label="Your account">
          {isPending ? (
            <Text role="status" c="dimmed">
              Loading your profile…
            </Text>
          ) : isError ? (
            <Alert variant="danger" title="Unable to load your profile">
              Reload to reconnect or sign in.
              <Button
                variant="secondary"
                className="mt-3"
                onClick={() => window.location.reload()}
              >
                Reload
              </Button>
            </Alert>
          ) : user ? (
            <div className="flex items-center gap-4">
              <Avatar size="lg" className="shrink-0" aria-hidden="true">
                {initials}
              </Avatar>
              <div className="grid min-w-0 flex-1 gap-2">
                <Text className="text-heading break-words">{user.name}</Text>
                <Text size="sm" c="dimmed" className="break-all">
                  {user.email ?? 'Local demo account'}
                </Text>
              </div>
            </div>
          ) : null}
        </Card>

        <SectionLabel>Notifications</SectionLabel>
        <Card component="section" aria-label="Notification settings">
          <Switch label="Check-in reminder" defaultChecked />
          <Switch label="Extension windows" defaultChecked />
          <Switch label="Seat freed early" defaultChecked />
        </Card>
      </ScreenMain>
    </Screen>
  );
}
