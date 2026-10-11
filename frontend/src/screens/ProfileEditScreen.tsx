import {
  Alert,
  Avatar,
  Button,
  Card,
  FileButton,
  Text,
  TextInput,
} from '@mantine/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useBlocker, useNavigate } from 'react-router';
import {
  getMeQueryKey,
  updateMeMutation,
} from '../api/generated/@tanstack/react-query.gen';
import type { UserResponse } from '../api/generated';
import { DecisionSheet } from '../components/DecisionSheet';
import { ProfilePhotoCropper } from '../components/ProfilePhotoCropper';
import {
  ActionBar,
  Screen,
  ScreenHeader,
  ScreenMain,
} from '../components/Screen';
import { apiProblem } from '../domain/booking';
import {
  croppedProfilePhoto,
  defaultPhotoCrop,
  loadProfilePhoto,
  maxProfilePhotoBytes,
  type ProfilePhotoSource,
} from '../domain/profilePhoto';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { paths } from '../routes';

export function ProfileEditScreen() {
  const current = useCurrentUser();
  return (
    <Screen>
      <ScreenHeader
        title="Edit profile"
        backTo={paths.profile}
        backLabel="Back to profile"
      />
      {current.user ? (
        <ProfileEditor
          key={current.user.id}
          user={current.user}
          initials={current.initials}
        />
      ) : (
        <ScreenMain>
          {current.isPending ? (
            <Text role="status" c="dimmed">
              Loading your profile…
            </Text>
          ) : (
            <Alert variant="danger" title="Unable to load your profile">
              Reconnect or sign in, then try again.
              <Button
                variant="secondary"
                className="mt-3"
                onClick={() => void current.refetch()}
              >
                Try again
              </Button>
            </Alert>
          )}
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
  const navigate = useNavigate();
  const client = useQueryClient();
  const [name, setName] = useState(user.name);
  const [source, setSource] = useState<ProfilePhotoSource | null>(null);
  const [crop, setCrop] = useState(defaultPhotoCrop);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [photoError, setPhotoError] = useState('');
  const resetFile = useRef<() => void>(null);
  const generation = useRef(0);
  const allowExit = useRef(false);
  const saveLock = useRef(false);
  const update = useMutation(updateMeMutation({ redirect: 'error' }));
  const dirty =
    name.trim() !== user.name || !!source || (removePhoto && !!user.photo_url);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      !allowExit.current &&
      (dirty || saving || preparing) &&
      currentLocation.pathname !== nextLocation.pathname,
  );
  const busy = saving || preparing;
  const photoUrl = removePhoto ? null : user.photo_url;
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  useEffect(
    () => () => {
      if (source?.url.startsWith('blob:')) URL.revokeObjectURL(source.url);
    },
    [source],
  );

  const openPhoto = async (url: string) => {
    const request = ++generation.current;
    setPreparing(true);
    setError('');
    setPhotoError('');
    try {
      const loaded = await loadProfilePhoto(url);
      if (request !== generation.current) {
        if (url.startsWith('blob:')) URL.revokeObjectURL(url);
        return;
      }
      setSource(loaded);
      setCrop(defaultPhotoCrop);
      setRemovePhoto(false);
    } catch (problem) {
      if (url.startsWith('blob:')) URL.revokeObjectURL(url);
      if (request === generation.current)
        setPhotoError(
          problem instanceof Error
            ? problem.message
            : 'Could not open this photo.',
        );
    } finally {
      if (request === generation.current) setPreparing(false);
    }
  };

  const choosePhoto = (file: File | null) => {
    resetFile.current?.();
    if (!file || busy) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setPhotoError('Choose a JPEG, PNG or WebP photo.');
      return;
    }
    if (file.size > maxProfilePhotoBytes) {
      setPhotoError('Choose a photo smaller than 12 MB.');
      return;
    }
    void openPhoto(URL.createObjectURL(file));
  };

  const save = async () => {
    if (saveLock.current || !dirty || !name.trim() || busy || photoError)
      return;
    saveLock.current = true;
    setSaving(true);
    setError('');
    try {
      const photo = source
        ? await croppedProfilePhoto(source, crop)
        : undefined;
      await client.cancelQueries({ queryKey: getMeQueryKey() });
      const profile = await update.mutateAsync({
        body: { name: name.trim(), photo, remove_photo: removePhoto },
      });
      client.setQueryData(getMeQueryKey(), profile);
      allowExit.current = true;
      await client.invalidateQueries();
      await navigate(paths.profile, {
        replace: true,
        state: { profileSaved: true },
      });
    } catch (problem) {
      setError(
        problem instanceof Error
          ? problem.message
          : apiProblem(problem).message,
      );
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  };

  return (
    <>
      <ScreenMain>
        <Card
          component="form"
          id="profile-edit-form"
          aria-label="Edit name and photo"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <TextInput
            label="Display name"
            name="name"
            autoComplete="nickname"
            autoFocus
            required
            maxLength={80}
            value={name}
            disabled={busy}
            onChange={(event) => {
              setName(event.currentTarget.value);
              setError('');
            }}
          />
          <Text size="sm" className="font-semibold">
            Profile photo
          </Text>
          {source ? (
            <ProfilePhotoCropper
              key={source.url}
              source={source}
              crop={crop}
              disabled={busy}
              onChange={setCrop}
            />
          ) : (
            <button
              type="button"
              className="mx-auto rounded-full border-0 bg-transparent p-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              disabled={busy || !photoUrl}
              aria-label="Adjust profile photo"
              onClick={() => photoUrl && void openPhoto(photoUrl)}
            >
              <Avatar src={photoUrl} size="lg" aria-hidden="true">
                {initials}
              </Avatar>
            </button>
          )}
          {preparing && (
            <Text role="status" c="dimmed">
              Preparing photo…
            </Text>
          )}
          <FileButton
            accept="image/jpeg,image/png,image/webp"
            onChange={choosePhoto}
            resetRef={resetFile}
            disabled={busy}
          >
            {(props) => (
              <Button
                {...props}
                type="button"
                variant="secondary"
                disabled={busy}
              >
                {source || photoUrl ? 'Change photo' : 'Choose photo'}
              </Button>
            )}
          </FileButton>
          {photoUrl && !source && (
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => void openPhoto(photoUrl)}
            >
              Adjust photo
            </Button>
          )}
          {(source || photoUrl) && (
            <Button
              type="button"
              variant="quiet"
              disabled={busy}
              onClick={() => {
                generation.current++;
                setSource(null);
                setRemovePhoto(true);
                setError('');
                setPhotoError('');
                resetFile.current?.();
              }}
            >
              Remove photo
            </Button>
          )}
          <Text size="sm" c="dimmed">
            JPEG, PNG or WebP, up to 12 MB. Your photo and name change when you
            save.
          </Text>
          {(photoError || error) && (
            <Alert variant="danger" role="alert" title="Unable to save profile">
              {photoError || error}
            </Alert>
          )}
        </Card>
      </ScreenMain>
      <ActionBar>
        <Button
          type="submit"
          form="profile-edit-form"
          loading={saving}
          disabled={!dirty || !name.trim() || busy || !!photoError}
        >
          Save changes
        </Button>
        <Button
          variant="quiet"
          component={Link}
          to={paths.profile}
          disabled={busy}
        >
          Cancel
        </Button>
      </ActionBar>
      <DecisionSheet
        opened={blocker.state === 'blocked'}
        onClose={() => {
          if (blocker.state === 'blocked') blocker.reset();
        }}
        title={saving ? 'Saving your profile' : 'Discard your edits?'}
        safeLabel="Keep editing"
        actionLabel={saving ? 'Saving…' : 'Discard edits'}
        actionTone="danger"
        onConfirm={() => {
          if (blocker.state === 'blocked' && !saving) blocker.proceed();
        }}
      >
        {saving
          ? 'Wait for the save to finish before leaving.'
          : 'Your name and photo will stay as they were.'}
      </DecisionSheet>
    </>
  );
}
