import { useState } from 'react';
import { useOutletContext } from 'react-router';
import { Button, Card, Text, Title } from '@mantine/core';
import * as api from '../../api/generated';
import { AdminFeedback } from './AdminFeedback';
import { adminHeaders, useAdminAction } from './useAdminAction';
const days = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];
const time = (n: number) =>
  n === 1440
    ? '00:00'
    : String(Math.floor(n / 60)).padStart(2, '0') +
      ':' +
      String(n % 60).padStart(2, '0');
const minutes = (v: string, end = false) => {
  const [h, m] = v.split(':').map(Number);
  return end && h === 0 && m === 0 ? 1440 : h * 60 + m;
};
export function AdminHoursPage() {
  const space = useOutletContext<api.AdminSpaceOverview>();
  return <HoursForm key={JSON.stringify(space.opening_hours)} space={space} />;
}
function HoursForm({ space }: { space: api.AdminSpaceOverview }) {
  const action = useAdminAction();
  const [hours, setHours] = useState(space.opening_hours);
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void action.run(
          (force) =>
            api.adminReplaceOpeningHours({
              headers: adminHeaders,
              path: { space_id: space.id },
              query: { force },
              body: { opening_hours: hours },
              throwOnError: true,
            }),
          'Opening hours saved.',
        );
      }}
    >
      <Title order={2}>Weekly opening hours</Title>
      <Text c="dimmed">
        Times in {space.timezone}. End time 00:00 means midnight at the end of
        the day.
      </Text>
      {days.map((day, weekday) => (
        <Card key={day} className="grid gap-3 p-4">
          <div className="flex items-center justify-between gap-3">
            <strong>{day}</strong>
            <Button
              type="button"
              variant="quiet"
              onClick={() =>
                setHours([
                  ...hours,
                  { weekday, start_minute: 480, end_minute: 1080 },
                ])
              }
            >
              Add interval
            </Button>
          </div>
          {!hours.some((h) => h.weekday === weekday) && (
            <Text size="sm" c="dimmed">
              Closed
            </Text>
          )}
          {hours.map((h, index) =>
            h.weekday !== weekday ? null : (
              <div key={index} className="flex flex-wrap items-end gap-3">
                <label className="grid gap-1 text-small">
                  From
                  <input
                    className="admin-input"
                    type="time"
                    aria-label={day + ' from'}
                    value={time(h.start_minute)}
                    required
                    onChange={(e) =>
                      setHours(
                        hours.map((v, i) =>
                          i === index
                            ? { ...v, start_minute: minutes(e.target.value) }
                            : v,
                        ),
                      )
                    }
                  />
                </label>
                <label className="grid gap-1 text-small">
                  Until
                  <input
                    className="admin-input"
                    type="time"
                    aria-label={day + ' until'}
                    value={time(h.end_minute)}
                    required
                    onChange={(e) =>
                      setHours(
                        hours.map((v, i) =>
                          i === index
                            ? {
                                ...v,
                                end_minute: minutes(e.target.value, true),
                              }
                            : v,
                        ),
                      )
                    }
                  />
                </label>
                <Button
                  type="button"
                  variant="quiet"
                  onClick={() => setHours(hours.filter((_, i) => i !== index))}
                >
                  Remove
                </Button>
              </div>
            ),
          )}
        </Card>
      ))}
      <div className="flex gap-3">
        <Button
          type="button"
          variant="secondary"
          onClick={() => setHours(space.opening_hours)}
        >
          Discard changes
        </Button>
        <Button type="submit" disabled={action.busy || space.is_archived}>
          Save opening hours
        </Button>
      </div>
      <AdminFeedback action={action} />
    </form>
  );
}
