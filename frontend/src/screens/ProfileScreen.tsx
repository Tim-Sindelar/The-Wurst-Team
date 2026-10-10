import {
  ActionIcon,
  Alert,
  Avatar,
  Button,
  Card,
  Switch,
  Text,
} from '@mantine/core';
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import type { UserResponse } from '../api/generated';
import { Icon } from '../components/Icon';
import { Screen, ScreenHeader, ScreenMain } from '../components/Screen';
import { SectionLabel } from '../components/SectionLabel';
import { StatusBanner } from '../components/StatusBanner';
import { ThemeSwitch } from '../components/ThemeSwitch';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useNotificationPreferences } from '../hooks/useNotificationPreferences';
import { paths } from '../routes';

export function ProfileScreen() {
  const { user, initials, isPending, refetch } = useCurrentUser();
  const location = useLocation();
  const navigate = useNavigate();
  const [saved, setSaved] = useState(location.state?.profileSaved === true);
  useEffect(() => {
    if (location.state?.profileSaved)
      void navigate(paths.profile, { replace: true, state: null });
  }, [location.state, navigate]);
  return (
    <Screen>
      <ScreenHeader
        title="Profile"
        backTo={paths.home}
        backLabel="Back to home"
      />
      <ScreenMain>
        <StatusBanner
          opened={saved}
          onClose={() => setSaved(false)}
          icon="check"
          title="Profile saved"
        />
        {user ? (
          <>
            <Card component="section" aria-label="Your account">
              <div className="flex items-start gap-3">
                <Avatar
                  src={user.photo_url}
                  size="lg"
                  className="shrink-0"
                  aria-hidden="true"
                >
                  {initials}
                </Avatar>
                <div className="grid min-w-0 flex-1 gap-1">
                  <Text className="text-title font-semibold break-words">
                    {user.name}
                  </Text>
                  <Text size="sm" c="dimmed" className="break-all">
                    {user.email ?? 'Local demo account'}
                  </Text>
                </div>
                <ActionIcon
                  component={Link}
                  to={paths.profileEdit}
                  aria-label="Edit name and profile photo"
                  className="shrink-0"
                >
                  <Icon name="edit" />
                </ActionIcon>
              </div>
            </Card>
            <SectionLabel>Appearance</SectionLabel>
            <Card component="section" aria-label="Appearance settings">
              <ThemeSwitch />
            </Card>
            <NotificationSettings key={user.id} user={user} />
          </>
        ) : isPending ? (
          <Text role="status" c="dimmed">
            Loading your profile…
          </Text>
        ) : (
          <Alert
            variant="danger"
            role="alert"
            title="Unable to load your profile"
          >
            Reconnect or sign in, then try again.
            <Button
              variant="secondary"
              className="mt-3"
              onClick={() => void refetch()}
            >
              Try again
            </Button>
          </Alert>
        )}
      </ScreenMain>
    </Screen>
  );
}

function NotificationSettings({ user }: { user: UserResponse }) {
  const { preferences, update, error } = useNotificationPreferences(user.id);
  return (
    <>
      <SectionLabel>Notifications</SectionLabel>
      <Card component="section" aria-label="Notification settings">
        <Switch
          label="Check-in reminder"
          checked={preferences.checkIn}
          onChange={(e) => update('checkIn', e.currentTarget.checked)}
        />
        <Switch
          label="Extension windows"
          checked={preferences.extension}
          onChange={(e) => update('extension', e.currentTarget.checked)}
        />
        <Switch
          label="Seat freed early"
          checked={preferences.seatFree}
          onChange={(e) => update('seatFree', e.currentTarget.checked)}
        />
        <Text size="sm" c="dimmed">
          Preferences save automatically on this device.
        </Text>
      </Card>
      {error && (
        <Alert variant="danger" role="alert" title="Unable to save preference">
          {error}
        </Alert>
      )}
    </>
  );
}
