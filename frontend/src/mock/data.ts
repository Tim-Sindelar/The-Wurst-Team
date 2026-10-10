import type { SeatState } from '../domain/seat';
import type { StudySpace } from '../domain/space';

/* Sample data for the mock screens, copied from design/screens.
   Replaced by API data once the backend is wired in. */

/** The API has no building yet, so the other mock screens keep it here. */
export type MockSpace = StudySpace & { building: string };

export const studySpaces: MockSpace[] = [
  {
    id: 'hg-e-41',
    name: 'HG E 41',
    building: 'Main building',
    freeSeats: 12,
    availability: 'high',
    availabilityText: '12 free',
    favourite: true,
  },
  {
    id: 'cab-e-11',
    name: 'CAB E 11',
    building: 'CAB',
    freeSeats: 3,
    availability: 'mid',
    availabilityText: '3 free · almost full',
    favourite: true,
  },
  {
    id: 'main-library',
    name: 'Main Library Reading Room',
    building: 'Main building',
    freeSeats: 0,
    availability: 'none',
    availabilityText: '0 free · full',
    favourite: false,
  },
];

/** The mock always shows this room, whichever card is tapped. */
export const mockSpace = studySpaces[0];

export type Seat = {
  number: number;
  state: Exclude<SeatState, 'yours'>;
  /** Centre of the seat on the 640 × 760 room canvas. */
  x: number;
  y: number;
  feature: string;
};

const quiet = 'Quiet area · Power outlet';
const windowSeat = 'Window seat';

/* Eight four-seat tables and a three-seat window counter. Invented layout. */
export const roomSeats: Seat[] = [
  { number: 1, state: 'free', x: 132, y: 92, feature: quiet },
  { number: 2, state: 'occupied', x: 188, y: 92, feature: quiet },
  { number: 3, state: 'reserved', x: 132, y: 188, feature: quiet },
  { number: 4, state: 'free', x: 188, y: 188, feature: quiet },
  { number: 5, state: 'break', x: 408, y: 92, feature: quiet },
  { number: 6, state: 'free', x: 464, y: 92, feature: quiet },
  { number: 7, state: 'occupied', x: 408, y: 188, feature: quiet },
  { number: 8, state: 'bookable', x: 464, y: 188, feature: quiet },
  { number: 9, state: 'free', x: 132, y: 252, feature: quiet },
  { number: 10, state: 'reserved', x: 188, y: 252, feature: quiet },
  { number: 11, state: 'break', x: 132, y: 348, feature: quiet },
  { number: 12, state: 'free', x: 188, y: 348, feature: quiet },
  { number: 13, state: 'occupied', x: 408, y: 252, feature: quiet },
  { number: 14, state: 'free', x: 464, y: 252, feature: quiet },
  { number: 15, state: 'reserved', x: 408, y: 348, feature: quiet },
  { number: 16, state: 'free', x: 464, y: 348, feature: quiet },
  { number: 17, state: 'free', x: 132, y: 412, feature: quiet },
  { number: 18, state: 'free', x: 188, y: 412, feature: quiet },
  { number: 19, state: 'reserved', x: 132, y: 508, feature: quiet },
  { number: 20, state: 'occupied', x: 188, y: 508, feature: quiet },
  { number: 21, state: 'free', x: 408, y: 412, feature: quiet },
  { number: 22, state: 'bookable', x: 464, y: 412, feature: quiet },
  { number: 23, state: 'free', x: 408, y: 508, feature: quiet },
  { number: 24, state: 'reserved', x: 464, y: 508, feature: quiet },
  { number: 25, state: 'break', x: 132, y: 572, feature: quiet },
  { number: 26, state: 'free', x: 188, y: 572, feature: quiet },
  { number: 27, state: 'occupied', x: 132, y: 668, feature: quiet },
  { number: 28, state: 'free', x: 188, y: 668, feature: quiet },
  { number: 29, state: 'reserved', x: 408, y: 572, feature: quiet },
  { number: 30, state: 'free', x: 464, y: 572, feature: quiet },
  { number: 31, state: 'free', x: 408, y: 668, feature: quiet },
  { number: 32, state: 'occupied', x: 464, y: 668, feature: quiet },
  { number: 33, state: 'free', x: 548, y: 224, feature: windowSeat },
  { number: 34, state: 'reserved', x: 548, y: 284, feature: windowSeat },
  { number: 35, state: 'free', x: 548, y: 344, feature: windowSeat },
];

export type Table = {
  label?: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export const roomTables: Table[] = [
  { label: 'A', x: 96, y: 122, width: 128, height: 36 },
  { label: 'B', x: 372, y: 122, width: 128, height: 36 },
  { label: 'C', x: 96, y: 282, width: 128, height: 36 },
  { label: 'D', x: 372, y: 282, width: 128, height: 36 },
  { label: 'E', x: 96, y: 442, width: 128, height: 36 },
  { label: 'F', x: 372, y: 442, width: 128, height: 36 },
  { label: 'G', x: 96, y: 602, width: 128, height: 36 },
  { label: 'H', x: 372, y: 602, width: 128, height: 36 },
  { x: 580, y: 198, width: 18, height: 192 },
];

/** Room outline on the 640 × 760 canvas: stepped footprint, windows, door. */
export const roomGeometry = {
  width: 640,
  height: 760,
  fill: 'M28 28H612V450H510V732H28Z',
  walls: 'M260 732H28V28H612V450H510V732H330',
  windows: 'M82 28H236M342 28H486M612 208V392',
  door: 'M260 732V662M260 662A70 70 0 0 1 330 732',
};

export const mockUser = {
  name: 'Anna Meier',
  initials: 'AM',
  email: 'anna.meier@student.ethz.ch',
};

/** Placeholder rules: hold time, break length, session length (seconds). */
export const mockRules = {
  holdSeconds: 600,
  breakSeconds: 900,
  sessionSeconds: 7200,
};
