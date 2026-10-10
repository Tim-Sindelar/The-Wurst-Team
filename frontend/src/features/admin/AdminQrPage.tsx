import { useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  NativeSelect,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as q from '../../api/generated/@tanstack/react-query.gen';
import qrcode from 'qrcode-generator';
import { adminHeaders, errorMessage } from './useAdminAction';
interface Label {
  seatId: string;
  label: string;
  room: string;
  url: string;
  svg: string;
}
function makeLabel(
  seatId: string,
  label: string,
  room: string,
  token: string,
  address: string,
): Label {
  const base = new URL(address);
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw Error('Use a clean HTTP(S) app address.');
  const url = new URL(
    base.pathname.replace(/\/$/, '') + '/check-in',
    base.origin,
  );
  url.searchParams.set('qr_token', token);
  const qr = qrcode(0, 'M');
  qr.addData(url.href);
  qr.make();
  const count = qr.getModuleCount(),
    size = count + 8;
  let path = '';
  for (let y = 0; y < count; y++)
    for (let x = 0; x < count; x++)
      if (qr.isDark(y, x)) path += 'M' + (x + 4) + ' ' + (y + 4) + 'h1v1h-1z';
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' +
    size +
    ' ' +
    size +
    '"><rect width="100%" height="100%" fill="white"/><path d="' +
    path +
    '" fill="black"/></svg>';
  return { seatId, label, room, url: url.href, svg };
}
function download(label: Label) {
  const blob = new Blob([label.svg], { type: 'image/svg+xml' }),
    url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download =
    label.room.replace(/[^a-z0-9.-]+/gi, '-') + '-seat-' + label.label + '.svg';
  a.click();
  URL.revokeObjectURL(url);
}
export function AdminQrPage() {
  const { spaceId: locked } = useParams();
  const [params] = useSearchParams();
  const cache = useQueryClient();
  const spaces = useQuery(q.adminListSpacesOptions({ headers: adminHeaders }));
  const [chosen, setChosen] = useState(''),
    [address, setAddress] = useState(
      location.origin + import.meta.env.BASE_URL.replace(/\/$/, ''),
    ),
    [size, setSize] = useState(4),
    [labels, setLabels] = useState<Label[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState<string[] | null>(null);
  const id =
    locked || chosen || spaces.data?.spaces.find((s) => !s.is_archived)?.id;
  const room = useQuery({
    ...q.adminGetSpaceOverviewOptions({
      headers: adminHeaders,
      path: { space_id: id || '' },
    }),
    enabled: !!id,
  });
  const seats = useMemo(
    () => room.data?.space.seats.filter((s) => s.is_active) || [],
    [room.data],
  );
  const required = params.get('seat');
  const target =
    selected !== null
      ? seats.filter((s) => selected.includes(s.id))
      : required
        ? seats.filter((s) => s.id === required)
        : seats;
  async function generate() {
    setBusy(true);
    setError('');
    try {
      if (!room.data) throw Error('Choose a study place.');
      const data = await Promise.all(
        target.map((s) =>
          cache.fetchQuery({
            ...q.adminGetSeatOptions({
              headers: adminHeaders,
              path: { space_id: id!, seat_id: s.id },
            }),
            staleTime: 0,
          }),
        ),
      );
      setLabels(
        data.map((r) =>
          makeLabel(
            r.seat.id,
            r.seat.label,
            room.data.space.name,
            r.seat.qr_token,
            address,
          ),
        ),
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="admin-qr-page grid gap-4">
      <Title order={locked ? 2 : 1}>QR codes</Title>
      <div className="admin-qr-controls grid gap-3">
        {locked ? (
          <Text fw={600}>
            {room.data?.space.name || 'Loading study place…'}
          </Text>
        ) : (
          <NativeSelect
            label="Study place"
            value={id}
            data={
              spaces.data?.spaces
                .filter((s) => !s.is_archived)
                .map((s) => ({ value: s.id, label: s.name })) || []
            }
            onChange={(e) => {
              setChosen(e.currentTarget.value);
              setLabels([]);
              setSelected(null);
            }}
          />
        )}
        <TextInput
          label="Student app address"
          value={address}
          onChange={(e) => {
            setAddress(e.currentTarget.value);
            setLabels([]);
          }}
        />
        <div className="flex gap-2">
          {[3, 4].map((cm) => (
            <Button
              key={cm}
              variant={cm === size ? 'secondary' : 'quiet'}
              aria-pressed={cm === size}
              onClick={() => setSize(cm)}
            >
              {cm} × {cm} cm
            </Button>
          ))}
        </div>
        <Text size="sm" c="dimmed">
          The QR image includes its white margin. Print at 100% / actual size.
          Room and seat captions sit outside the QR area.
        </Text>
        <details>
          <summary className="cursor-pointer">
            Choose seats ({target.length})
          </summary>
          <div className="grid gap-2 py-3">
            {seats.map((s) => (
              <Checkbox
                key={s.id}
                label={'Seat ' + s.label}
                checked={target.some((t) => t.id === s.id)}
                onChange={(e) => {
                  const ids = target.map((t) => t.id);
                  setSelected(
                    e.currentTarget.checked
                      ? [...ids, s.id]
                      : ids.filter((x) => x !== s.id),
                  );
                  setLabels([]);
                }}
              />
            ))}
            <Button
              variant="quiet"
              onClick={() => {
                setSelected([]);
                setLabels([]);
              }}
            >
              All seats
            </Button>
          </div>
        </details>
        <div className="flex gap-3">
          <Button
            disabled={busy || !target.length || room.data?.space.is_archived}
            onClick={() => void generate()}
          >
            {busy ? 'Generating…' : 'Generate labels'}
          </Button>
          <Button
            variant="secondary"
            disabled={!labels.length}
            onClick={() => window.print()}
          >
            Print / Save PDF
          </Button>
        </div>
        <Text size="sm" c="dimmed">
          Labels identify seats. Students still need a matching reservation and
          must confirm check-in.
        </Text>
      </div>
      {(error || room.isError || spaces.isError) && (
        <Alert variant="danger">
          {error || errorMessage(room.error || spaces.error)}
        </Alert>
      )}
      <div
        className="admin-qr-labels"
        style={{ '--admin-qr-size': size + 'cm' } as React.CSSProperties}
      >
        {labels.map((l) => (
          <Card key={l.seatId} className="admin-qr-label">
            <strong>{l.room}</strong>
            <Text className="text-title">Seat {l.label}</Text>
            <img
              className="admin-qr-image"
              src={
                'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(l.svg)
              }
              alt={'QR for ' + l.room + ', seat ' + l.label}
            />
            <Button
              className="admin-qr-controls"
              variant="quiet"
              onClick={() => download(l)}
            >
              Download SVG
            </Button>
          </Card>
        ))}
      </div>
      {!labels.length && (
        <Text className="admin-qr-controls" c="dimmed">
          Generate labels to see the print layout.
        </Text>
      )}
    </div>
  );
}
