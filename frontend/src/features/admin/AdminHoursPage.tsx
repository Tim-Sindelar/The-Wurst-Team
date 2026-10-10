import { useState } from 'react';
import { useOutletContext } from 'react-router';
import { Button, Switch, Text } from '@mantine/core';
import * as api from '../../api/generated';
import { Icon } from '../../components/Icon';
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
      className="grid gap-6"
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
      <Text c="dimmed">
        Weekly opening hours in {space.timezone}. Students can only reserve
        while the space is open. Add intervals for split hours; set the end to
        00:00 for midnight.
      </Text>
      <div className="admin-hours">
        {days.map((day, weekday) => {
          const intervals = hours.filter((h) => h.weekday === weekday);
          const lastEnd = Math.max(0, ...intervals.map((h) => h.end_minute));
          return (
            <div key={day} className="admin-hours-day">
              <strong className="flex min-h-11 items-center">{day}</strong>
              <Switch
                label="Open"
                aria-label={day + ' open'}
                checked={!!intervals.length}
                disabled={space.is_archived}
                onChange={(e) =>
                  setHours(
                    e.currentTarget.checked
                      ? [
                          ...hours,
                          { weekday, start_minute: 480, end_minute: 1080 },
                        ]
                      : hours.filter((h) => h.weekday !== weekday),
                  )
                }
              />
              <div className="grid gap-2">
                {!intervals.length ? (
                  <Text c="dimmed" className="flex min-h-11 items-center">
                    Closed all day
                  </Text>
                ) : (
                  <>
                    {hours.map((h, index) =>
                      h.weekday !== weekday ? null : (
                        <div
                          key={index}
                          className="flex flex-wrap items-center gap-2"
                        >
                          <input
                            className="admin-input admin-time"
                            type="time"
                            aria-label={day + ' opens'}
                            value={time(h.start_minute)}
                            required
                            disabled={space.is_archived}
                            onChange={(e) =>
                              setHours(
                                hours.map((v, i) =>
                                  i === index
                                    ? {
                                        ...v,
                                        start_minute: minutes(e.target.value),
                                      }
                                    : v,
                                ),
                              )
                            }
                          />
                          <span className="text-text-muted">to</span>
                          <input
                            className="admin-input admin-time"
                            type="time"
                            aria-label={day + ' closes'}
                            value={time(h.end_minute)}
                            required
                            disabled={space.is_archived}
                            onChange={(e) =>
                              setHours(
                                hours.map((v, i) =>
                                  i === index
                                    ? {
                                        ...v,
                                        end_minute: minutes(
                                          e.target.value,
                                          true,
                                        ),
                                      }
                                    : v,
                                ),
                              )
                            }
                          />
                          <Button
                            type="button"
                            variant="quiet"
                            className="admin-risky"
                            disabled={space.is_archived}
                            onClick={() =>
                              setHours(hours.filter((_, i) => i !== index))
                            }
                          >
                            Remove
                          </Button>
                        </div>
                      ),
                    )}
                    <Button
                      type="button"
                      variant="quiet"
                      className="justify-self-start"
                      leftSection={<Icon name="plus" size="sm" />}
                      disabled={space.is_archived || lastEnd >= 1380}
                      onClick={() =>
                        setHours([
                          ...hours,
                          {
                            weekday,
                            start_minute: lastEnd + 30,
                            end_minute: Math.min(1440, lastEnd + 120),
                          },
                        ])
                      }
                    >
                      Add interval
                    </Button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="admin-form-actions">
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
