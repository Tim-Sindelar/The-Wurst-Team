import { Alert, Anchor, Button, NativeSelect, Text } from '@mantine/core';
import { useEffect, useReducer, type ReactNode } from 'react';
import { Link, Navigate, Outlet, useLocation, useNavigate } from 'react-router';
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
  loadDraftState,
  partyPath,
  saveDraftState,
} from './draft';
import { useSocialDraft } from './useSocialDraft';

export function SocialDraftLayout() {
  const [state, dispatch] = useReducer(draftReducer, undefined, () =>
    loadDraftState(import.meta.env.BASE_URL),
  );
  useEffect(() => saveDraftState(state, import.meta.env.BASE_URL), [state]);
  return (
    <SocialDraftContext value={{ state, dispatch }}>
      <DraftContent key={state.revision} />
      <DraftPreviewControls />
    </SocialDraftContext>
  );
}

function DraftContent() {
  const { state, partyExists } = useSocialDraft();
  if (!partyExists)
    return (
      <DraftFrame title="Party not found" backTo={draftPaths.parties}>
        <Alert title="This party isn’t saved in this preview">
          Open your parties or create a new one.
        </Alert>
        <Button variant="secondary" component={Link} to={draftPaths.parties}>
          Your parties
        </Button>
      </DraftFrame>
    );
  return <Outlet key={state.party.id} />;
}

/** Keep old preview bookmarks working while every saved party has its own URL. */
export function LegacyPartyRedirect() {
  const { state } = useSocialDraft();
  const { pathname, search } = useLocation();
  const section = pathname.slice(draftPaths.party.length);
  return (
    <Navigate replace to={`${partyPath(state.party.id)}${section}${search}`} />
  );
}

function DraftPreviewControls() {
  const { state, dispatch } = useSocialDraft();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const conflict = new URLSearchParams(search).get('error') === '1';
  const partyView =
    pathname === partyPath(state.party.id) ||
    pathname === partyPath(state.party.id, 'reservation');
  return (
    <details
      className="mx-auto w-full max-w-phone border-x border-b border-border bg-surface-2"
      aria-label="Design preview controls"
    >
      <summary className="min-h-11 cursor-pointer px-4 py-3 text-small text-text-muted">
        Preview tools · sample data
      </summary>
      <div className="grid gap-3 px-4 pb-4">
        <div className="flex items-center justify-between gap-2">
          <Text size="sm" c="dimmed">
            UI draft · sample data
          </Text>
          <Button
            variant="quiet"
            onClick={() => {
              dispatch({ type: 'reset' });
              navigate(draftPaths.friends);
            }}
          >
            Reset preview
          </Button>
        </div>
        {partyView && (
          <NativeSelect
            label="Preview party as"
            value={state.viewer}
            data={state.party.members.map((m) => ({
              value: m.person.id,
              label: `${m.person.id === 'you' ? 'You' : m.person.name}${m.person.id === state.party.organizerId ? ' · organizer' : ''}`,
            }))}
            rightSection={<Icon name="back" size="sm" className="-rotate-90" />}
            onChange={(e) =>
              dispatch({ type: 'viewer', id: e.currentTarget.value })
            }
          />
        )}
        <div className="flex flex-wrap gap-4">
          {pathname === partyPath(state.party.id, 'seats') && (
            <Anchor
              component={Link}
              to={`${partyPath(state.party.id, 'seats')}${conflict ? '' : '?error=1'}`}
              size="sm"
              className="flex min-h-11 items-center"
            >
              {conflict ? 'Normal booking' : 'Booking conflict'}
            </Anchor>
          )}
        </div>
      </div>
    </details>
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
