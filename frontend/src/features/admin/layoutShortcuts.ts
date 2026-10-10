import type { Tool } from './models';

/** Editor tools: tool, label, shortcut key. */
export const tools: [Tool, string, string][] = [
  ['select', 'Select', 'V'],
  ['table', 'Rectangle', 'T'],
  ['round', 'Round', 'O'],
  ['l', 'L shape', 'L'],
  ['curved', 'Curved', 'U'],
  ['seat', 'Seat', 'S'],
  ['window', 'Window', 'W'],
  ['door', 'Door', 'D'],
  ['row', 'Seat rows', 'A'],
  ['outlet', 'Power outlet', 'P'],
  ['monitor', 'Monitor', 'E'],
  ['quiet', 'Quiet area', 'Q'],
];

const tool = (name: Tool): { keys: string[]; action: string } => {
  const [, label, key] = tools.find(([t]) => t === name)!;
  return { keys: [key], action: label };
};

/** What the keyboard help lists, in groups. */
export const shortcutGroups: {
  title: string;
  items: { keys: string[]; action: string }[];
}[] = [
  {
    title: 'Tools',
    items: [
      tool('select'),
      { keys: ['T'], action: 'Table' },
      tool('round'),
      tool('l'),
      tool('curved'),
      tool('seat'),
      tool('row'),
      tool('window'),
      tool('door'),
      { keys: ['B'], action: 'Seat features' },
      tool('outlet'),
      tool('monitor'),
      tool('quiet'),
      { keys: ['Esc'], action: 'Cancel and go back to Select' },
    ],
  },
  {
    title: 'Selected item',
    items: [
      { keys: ['R'], action: 'Rotate table or row 90°' },
      { keys: ['Space'], action: 'Rotate 90° while dragging' },
      { keys: ['Shift'], action: 'Rotate in 15° steps (rotate handle)' },
      { keys: ['←', '→'], action: 'Rotate 15° (rotate handle focused)' },
      { keys: ['Delete'], action: 'Remove item' },
    ],
  },
  {
    title: 'View',
    items: [
      { keys: ['Space', 'drag'], action: 'Pan (or middle mouse button)' },
      { keys: ['Wheel'], action: 'Zoom' },
      { keys: ['F'], action: 'Fit the room' },
    ],
  },
  {
    title: 'Layout',
    items: [
      { keys: ['Ctrl', 'Z'], action: 'Undo' },
      { keys: ['Ctrl', 'Shift', 'Z'], action: 'Redo (or Ctrl Y)' },
      { keys: ['Ctrl', 'S'], action: 'Save layout' },
      { keys: ['?'], action: 'Show these shortcuts' },
    ],
  },
];
