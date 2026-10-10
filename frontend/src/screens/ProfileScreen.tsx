import {
  Alert,
  Avatar,
  Button,
  Card,
  FileButton,
  Switch,
  Text,
  TextInput,
} from '@mantine/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import {
  getMeQueryKey,
  updateMeMutation,
} from '../api/generated/@tanstack/react-query.gen';
import type { UserResponse } from '../api/generated/types.gen';
import {
  ActionBar,
  Screen,
  ScreenHeader,
  ScreenMain,
} from '../components/Screen';
import { SectionLabel } from '../components/SectionLabel';
import { StatusBanner } from '../components/StatusBanner';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { paths } from '../routes';

export function ProfileScreen() {
  const { user, initials, isPending } = useCurrentUser();

  return (
    <Screen>
      <ScreenHeader
        title="Profile"
        backTo={paths.home}
        backLabel="Back to home"
      />

      {user ? (
        <ProfileEditor key={user.id} user={user} initials={initials} />
      ) : (
        <ScreenMain>
          <Card component="section" aria-label="Your account">
            {isPending ? (
              <Text role="status" c="dimmed">
                Loading your profile…
              </Text>
            ) : (
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
            )}
          </Card>
        </ScreenMain>
      )}
    </Screen>
  );
}

function ProfileEditor({
  user,
  initials,
}: {
  user: UserResponse;
  initials?: string;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(user.name);
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const resetFile = useRef<() => void>(null);
  const update = useMutation({
    ...updateMeMutation({ redirect: 'error' }),
    onMutate: () => queryClient.cancelQueries({ queryKey: getMeQueryKey() }),
    onSuccess: (profile) => {
      queryClient.setQueryData(getMeQueryKey(), profile);
      setName(profile.name);
      setPhoto(null);
      setPreview(null);
      setRemovePhoto(false);
      resetFile.current?.();
      setSaved(true);
    },
  });

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  const photoUrl = preview ?? (removePhoto ? null : user.photo_url);
  const dirty =
    name.trim() !== user.name ||
    photo !== null ||
    (removePhoto && !!user.photo_url);
  const saveError = update.isError
    ? typeof update.error?.detail === 'string'
      ? update.error.detail
      : 'Could not save your profile. Reload to reconnect, then try again.'
    : null;

  function clearStatus() {
    setError(null);
    setSaved(false);
    update.reset();
  }

  function choosePhoto(file: File | null) {
    resetFile.current?.();
    if (!file) return;
    clearStatus();
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Choose a JPEG, PNG or WebP photo.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError('Photo must be 2 MiB or smaller.');
      return;
    }
    setPhoto(file);
    setPreview(URL.createObjectURL(file));
    setRemovePhoto(false);
  }

  return (
    <>
      <ScreenMain>
        <Card
          component="form"
          id="profile-form"
          aria-label="Your account"
          onSubmit={(event) => {
            event.preventDefault();
            if (!dirty || !name.trim() || error || update.isPending) return;
            setSaved(false);
            update.mutate({
              body: {
                name: name.trim(),
                photo: photo ?? undefined,
                remove_photo: removePhoto,
              },
            });
          }}
        >
          <div className="flex items-center gap-4">
            <Avatar
              src={photoUrl}
              size="lg"
              className="shrink-0"
              aria-hidden="true"
            >
              {initials}
            </Avatar>
            <div className="grid min-w-0 flex-1 gap-2">
              <Text className="text-heading break-words">{user.name}</Text>
              <Text size="sm" c="dimmed" className="break-all">
                {user.email ?? 'Local demo account'}
              </Text>
            </div>
          </div>
          <TextInput
            label="Display name"
            name="name"
            autoComplete="nickname"
            required
            maxLength={80}
            value={name}
            disabled={update.isPending}
            onChange={(event) => {
              setName(event.currentTarget.value);
              clearStatus();
            }}
          />
          <div className="grid gap-2">
            <FileButton
              accept="image/jpeg,image/png,image/webp"
              onChange={choosePhoto}
              resetRef={resetFile}
              disabled={update.isPending}
            >
              {(props) => (
                <Button
                  {...props}
                  type="button"
                  variant="secondary"
                  disabled={update.isPending}
                >
                  Choose photo
                </Button>
              )}
            </FileButton>
            {photoUrl && (
              <Button
                type="button"
                variant="quiet"
                disabled={update.isPending}
                onClick={() => {
                  clearStatus();
                  setPhoto(null);
                  setPreview(null);
                  setRemovePhoto(true);
                  resetFile.current?.();
                }}
              >
                Remove photo
              </Button>
            )}
            <Text size="sm" c="dimmed">
              JPEG, PNG or WebP. Maximum 2 MiB and 16 megapixels. Changes apply
              when you save.
            </Text>
          </div>
          {(error || saveError) && (
            <Alert variant="danger" role="alert" title="Unable to save profile">
              {error ?? saveError}
            </Alert>
          )}
        </Card>

        <SectionLabel>Notifications</SectionLabel>
        <Card component="section" aria-label="Notification settings">
          <Switch label="Check-in reminder" defaultChecked />
          <Switch label="Extension windows" defaultChecked />
          <Switch label="Seat freed early" defaultChecked />
        </Card>
      </ScreenMain>
      <ActionBar>
        <Button
          type="submit"
          form="profile-form"
          loading={update.isPending}
          disabled={!dirty || !name.trim() || !!error}
        >
          Save changes
        </Button>
      </ActionBar>
      <StatusBanner
        opened={saved}
        onClose={() => setSaved(false)}
        icon="check"
        title="Profile saved"
      />
    </>
  );
}
