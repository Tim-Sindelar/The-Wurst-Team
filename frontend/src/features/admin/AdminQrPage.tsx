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
import { adminHeaders, errorMessage } from './useAdminAction';
import { seatLabelSvg, WIDTH } from './seatLabel';
import { seatQrLink } from '../../domain/seatQr';
interface Label {
  seatId: string;
  label: string;
  room: string;
  svg: string;
}
function makeLabel(
  seatId: string,
  label: string,
  room: string,
  link: string,
): Label {
  return { seatId, label, room, svg: seatLabelSvg(room, label, link).svg };
}
/* The app address the seat links start with. By default the address this
   admin runs under (so a PR preview links to itself); an admin can change it,
   for example to print production labels, and it is remembered here. */
const defaultPrefix = new URL(import.meta.env.BASE_URL, window.location.origin)
  .href;
const PREFIX_KEY = 'admin-qr-link-prefix';
function savedPrefix() {
  try {
    return localStorage.getItem(PREFIX_KEY) || defaultPrefix;
  } catch {
    return defaultPrefix;
  }
}
function savePrefix(prefix: string) {
  try {
    if (prefix === defaultPrefix) localStorage.removeItem(PREFIX_KEY);
    else localStorage.setItem(PREFIX_KEY, prefix);
  } catch {
    // Not remembered on this device; the field still works.
  }
}
/** The label's width in cm when its QR code is `size` cm. */
const labelWidth = (size: number) => (size * WIDTH) / 100;
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
    [size, setSize] = useState(4),
    [labels, setLabels] = useState<Label[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState<string[] | null>(null),
    [prefix, setPrefix] = useState(savedPrefix);
  const example = seatQrLink(prefix, 'TOKEN')?.replace('TOKEN', '…');
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
      if (!example) throw Error('Enter a valid link address.');
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
            seatQrLink(prefix, r.seat.qr_token)!,
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
    <div className="admin-qr-page admin-page">
      <header className="admin-page-header admin-qr-controls">
        <div>
          <Title order={locked ? 2 : 1}>QR codes</Title>
          <Text c="dimmed">
            Generate printable seat labels for a study space.
          </Text>
        </div>
        <Button
          variant="secondary"
          disabled={!labels.length}
          onClick={() => window.print()}
        >
          Print / Save PDF
        </Button>
      </header>
      <div className="admin-qr-workspace">
        <Card className="admin-qr-controls admin-user-card">
          {locked ? (
            <div>
              <span className="text-label font-bold tracking-label text-text-muted uppercase">
                Study space
              </span>
              <Text fw={600}>
                {room.data?.space.name || 'Loading study place…'}
              </Text>
            </div>
          ) : (
            <NativeSelect
              label="Study place"
              disabled={busy}
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
          <div className="grid gap-2">
            <span className="text-small font-semibold">QR code size</span>
            <div className="admin-qr-sizes flex flex-wrap gap-2">
              {[3, 4].map((cm) => (
                <Button
                  key={cm}
                  variant="secondary"
                  aria-pressed={cm === size}
                  onClick={() => setSize(cm)}
                >
                  {cm} × {cm} cm
                </Button>
              ))}
            </div>
          </div>
          <TextInput
            label="Link address"
            disabled={busy}
            value={prefix}
            error={example ? undefined : 'Enter an http or https address.'}
            description={example && 'Links look like ' + example}
            onChange={(e) => {
              setPrefix(e.currentTarget.value);
              setLabels([]);
            }}
            onBlur={() => {
              const value = prefix.trim() || defaultPrefix;
              setPrefix(value);
              if (seatQrLink(value, '')) savePrefix(value);
            }}
            rightSectionWidth={prefix === defaultPrefix ? undefined : 72}
            rightSection={
              prefix !== defaultPrefix && (
                <Button
                  variant="quiet"
                  disabled={busy}
                  onClick={() => {
                    setPrefix(defaultPrefix);
                    savePrefix(defaultPrefix);
                    setLabels([]);
                  }}
                >
                  Reset
                </Button>
              )
            }
          />
          <Text size="sm" c="dimmed">
            Each label is {labelWidth(size)} cm wide, with the logo, the seat
            and a note to reserve it. Print at 100% / actual size.
          </Text>
          <details>
            <summary className="cursor-pointer">
              Choose seats ({target.length})
            </summary>
            <div className="grid gap-2 py-3">
              {seats.map((s) => (
                <Checkbox
                  key={s.id}
                  disabled={busy}
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
              <div className="flex gap-2">
                <Button
                  variant="quiet"
                  disabled={busy}
                  onClick={() => {
                    setSelected(seats.map((s) => s.id));
                    setLabels([]);
                  }}
                >
                  All seats
                </Button>
                <Button
                  variant="quiet"
                  disabled={busy}
                  onClick={() => {
                    setSelected([]);
                    setLabels([]);
                  }}
                >
                  Clear selection
                </Button>
              </div>
            </div>
          </details>
          <Button
            disabled={
              busy || !target.length || !example || room.data?.space.is_archived
            }
            onClick={() => void generate()}
          >
            {busy ? 'Generating…' : 'Generate labels'}
          </Button>
          <Text size="sm" c="dimmed">
            Scanning a label opens its seat in the app, ready to reserve. The
            app's scanner checks in with the same code.
          </Text>
          {(error || room.isError || spaces.isError) && (
            <Alert variant="danger">
              {error || errorMessage(room.error || spaces.error)}
              <Button
                variant="quiet"
                onClick={() => {
                  void room.refetch();
                  void spaces.refetch();
                }}
              >
                Retry loading seats
              </Button>
            </Alert>
          )}
        </Card>
        <Card className="admin-qr-preview">
          <div className="admin-qr-controls flex flex-wrap items-center justify-between gap-3">
            <Title order={2}>Print preview</Title>
            <Text size="sm" c="dimmed">
              {labels.length} labels · {labelWidth(size)} cm wide
            </Text>
          </div>
          <div
            className="admin-qr-labels"
            style={
              {
                '--admin-qr-label-width': labelWidth(size) + 'cm',
              } as React.CSSProperties
            }
          >
            {labels.map((l) => (
              <Card key={l.seatId} className="admin-qr-label">
                <img
                  className="admin-qr-image"
                  src={
                    'data:image/svg+xml;charset=utf-8,' +
                    encodeURIComponent(l.svg)
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
            <Text className="admin-qr-controls py-8" c="dimmed">
              {!seats.length
                ? 'Add seats in Layout before generating their labels.'
                : 'Generate labels to see the print layout.'}
            </Text>
          )}
        </Card>
      </div>
    </div>
  );
}
