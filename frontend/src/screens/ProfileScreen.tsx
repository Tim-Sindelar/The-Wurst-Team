import { Avatar, Card, Switch, Text } from '@mantine/core';
import { Screen, ScreenHeader, ScreenMain } from '../components/Screen';
import { SectionLabel } from '../components/SectionLabel';
import { mockUser } from '../mock/data';
import { paths } from '../routes';

export function ProfileScreen() {
  return (
    <Screen>
      <ScreenHeader
        title="Profile"
        backTo={paths.home}
        backLabel="Back to home"
      />

      <ScreenMain>
        <Card component="section" aria-label="Your account">
          <div className="flex items-center gap-4">
            <Avatar size="lg" aria-hidden="true">
              {mockUser.initials}
            </Avatar>
            <div className="grid min-w-0 flex-1 gap-2">
              <Text className="text-heading">{mockUser.name}</Text>
              <Text size="sm" c="dimmed">
                {mockUser.email}
              </Text>
            </div>
          </div>
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
