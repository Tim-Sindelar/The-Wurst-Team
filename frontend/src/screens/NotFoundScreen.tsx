import { Alert, Button, Text } from '@mantine/core';
import { Link } from 'react-router';
import { Icon } from '../components/Icon';
import {
  ActionBar,
  Screen,
  ScreenHeader,
  ScreenMain,
} from '../components/Screen';
import { paths } from '../routes';

/** A link to a page that doesn't exist, or a screen that failed to render. */
export function NotFoundScreen({ failed = false }: { failed?: boolean }) {
  return (
    <Screen>
      <ScreenHeader
        title={failed ? 'Something went wrong' : 'Page not found'}
        backTo={paths.home}
        backLabel="Back to home"
      />
      <ScreenMain>
        <Alert
          variant={failed ? 'danger' : 'info'}
          role={failed ? 'alert' : undefined}
          icon={<Icon name="alert" />}
          title={failed ? "This screen couldn't be shown" : 'Nothing here'}
        >
          <Text size="sm">
            {failed
              ? 'Go back home and try again.'
              : "This link doesn't lead to a screen in the app."}
          </Text>
        </Alert>
      </ScreenMain>
      <ActionBar>
        <Button component={Link} to={paths.home} fullWidth>
          Go to Home
        </Button>
      </ActionBar>
    </Screen>
  );
}

/** The router's error screen: shown instead of React Router's developer page. */
export function RouteErrorScreen() {
  return <NotFoundScreen failed />;
}
