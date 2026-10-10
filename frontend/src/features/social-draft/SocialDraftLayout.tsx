import { Anchor, Button, NativeSelect, Text } from '@mantine/core';
import { useReducer, type ReactNode } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { Icon } from '../../components/Icon';
import {
  ActionBar,
  Screen,
  ScreenHeader,
  ScreenMain,
} from '../../components/Screen';
import {
  SocialDraftContext,
  draftPaths,
  draftReducer,
  initialDraftState,
} from './draft';
import { useSocialDraft } from './useSocialDraft';

export function SocialDraftLayout() {
  const [state, dispatch] = useReducer(
    draftReducer,
    undefined,
    initialDraftState,
  );
  return (
    <SocialDraftContext value={{ state, dispatch }}>
      <DraftPreviewControls />
      <Outlet key={state.revision} />
    </SocialDraftContext>
  );
}

function DraftPreviewControls() {
  const { state, dispatch } = useSocialDraft();
  const { pathname, search } = useLocation();
  const conflict = new URLSearchParams(search).get('error') === '1';
  const partyView =
    pathname === draftPaths.party || pathname === draftPaths.reservation;
  return (
    <aside
      className="mx-auto grid w-full max-w-phone gap-2 border-x border-b border-border bg-surface-2 px-4 py-2"
      aria-label="Design preview controls"
    >
      <div className="flex items-center justify-between gap-2">
        <Text size="sm" c="dimmed">
          UI draft · sample data
        </Text>
        <Button variant="quiet" onClick={() => dispatch({ type: 'reset' })}>
          Reset preview
        </Button>
      </div>
      {partyView && (
        <NativeSelect
          label="Preview party as"
          value={state.viewer}
          data={state.party.members.map((m) => ({
            value: m.person.id,
            label: m.person.id === 'you' ? 'You · organizer' : m.person.name,
          }))}
          rightSection={<Icon name="back" size="sm" className="-rotate-90" />}
          onChange={(e) =>
            dispatch({ type: 'viewer', id: e.currentTarget.value })
          }
        />
      )}
      <nav className="flex flex-wrap gap-4" aria-label="Draft screens">
        <Anchor component={Link} to={draftPaths.friends} size="sm">
          Friends
        </Anchor>
        <Anchor component={Link} to={draftPaths.parties} size="sm">
          Parties
        </Anchor>
        {pathname === draftPaths.add && (
          <Anchor
            component={Link}
            to={`${draftPaths.add}?invite=sam`}
            size="sm"
          >
            Sam’s sample invite
          </Anchor>
        )}
        {pathname === draftPaths.seats && (
          <Anchor
            component={Link}
            to={`${draftPaths.seats}${conflict ? '' : '?error=1'}`}
            size="sm"
          >
            {conflict ? 'Normal booking' : 'Booking conflict'}
          </Anchor>
        )}
      </nav>
    </aside>
  );
}

export function DraftFrame({
  title,
  backTo,
  children,
  actions,
}: {
  title: string;
  backTo: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <Screen>
      <ScreenHeader title={title} backTo={backTo} backLabel="Back" />
      <ScreenMain>{children}</ScreenMain>
      {actions && <ActionBar>{actions}</ActionBar>}
    </Screen>
  );
}
