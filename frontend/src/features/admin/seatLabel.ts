import qrcode from 'qrcode-generator';
import logo from './study-spaces-logo.svg?raw';

/* The printed seat label, drawn like the app's light theme: the
   Study Spaces logo with the seat number as a "yours" seat chip, the room as
   a section label, the QR code on a white tile with the seat mark in its
   middle, and one line to reserve before sitting down. It is print artwork,
   so it repeats the light theme's colours (src/styles.css) and the logo files
   in design/brand/ rather than using tokens.

   Units: the QR code is 100 wide; the label is WIDTH wide. The admin picks
   the QR size in cm, and the label prints at WIDTH / 100 times that. */

export const WIDTH = 148;
const PAD = 12,
  GAP = 10,
  CAP = 0.72, // cap height of the label font, in em
  QR = 100,
  TILE = 12, // white quiet zone around the code
  BG = '#f5f5f5',
  BORDER = '#dcdcdc',
  TEXT = '#212121',
  MUTED = '#616161',
  ACCENT = '#215caf',
  ON_ACCENT = '#ffffff',
  QR_INK = '#121212',
  FREE = '#2e7d32',
  SEAT = '#808080',
  FONT = "'DIN Next LT W05', Barlow, Arial, Helvetica, sans-serif";

const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] || '&#39;',
  );

/** Breaks text into lines of at most `max` characters, at most `lines` of
    them; a word longer than a line is cut, and text that doesn't fit ends
    in an ellipsis. */
export function wrap(text: string, max: number, lines: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.trim().split(/\s+/)) {
    const next = line ? line + ' ' + word : word;
    if (next.length <= max) line = next;
    else {
      if (line) out.push(line);
      line = word.length > max ? word.slice(0, max - 1) + '…' : word;
    }
  }
  if (line) out.push(line);
  if (out.length > lines) {
    const last = out[lines - 1];
    out.length = lines;
    out[lines - 1] = (last.length < max ? last : last.slice(0, max - 1)) + '…';
  }
  return out;
}

/** The seat mark (a desk with four seats, one free), centred at x, y and
    `size` tall. */
const seatMark = (x: number, y: number, size: number) =>
  `<g transform="translate(${x} ${y}) scale(${size / 120}) translate(-128 -128)">` +
  `<rect x="72" y="111" width="112" height="34" rx="12" fill="${SEAT}"/>` +
  `<rect x="88" y="68" width="34" height="34" rx="9" fill="${FREE}"/>` +
  `<rect x="134" y="68" width="34" height="34" rx="9" fill="${SEAT}"/>` +
  `<rect x="88" y="154" width="34" height="34" rx="9" fill="${SEAT}"/>` +
  `<rect x="134" y="154" width="34" height="34" rx="9" fill="${SEAT}"/></g>`;

/** The QR code holds only the seat's token: the app's scan screen sends it
    as-is to the check-in call. It uses the highest error correction, so the
    seat mark in its middle doesn't stop it from scanning. */
function qrCode(token: string, x: number, y: number) {
  const qr = qrcode(0, 'H');
  qr.addData(token);
  qr.make();
  const count = qr.getModuleCount(),
    m = QR / count;
  // The middle, about a fifth of the code wide in whole modules, is left
  // blank for the seat mark.
  const hole = Math.ceil(count * 0.22) | 1,
    at = (count - hole) / 2,
    blank = (i: number) => i >= at && i < at + hole;
  let path = '';
  for (let r = 0; r < count; r++)
    for (let c = 0; c < count; c++)
      if (qr.isDark(r, c) && !(blank(r) && blank(c)))
        path += `M${c} ${r}h1v1h-1z`;
  return (
    `<rect x="${x - TILE}" y="${y - TILE}" width="${QR + 2 * TILE}" height="${QR + 2 * TILE}" rx="10" fill="white" stroke="${BORDER}" stroke-width="0.5"/>` +
    `<path transform="translate(${x} ${y}) scale(${m})" d="${path}" fill="${QR_INK}" shape-rendering="crispEdges"/>` +
    seatMark(x + QR / 2, y + QR / 2, hole * m * 0.8)
  );
}

/* The logo, put together like AppName in the app: the seat mark as tall as
   the capitals, sitting on the baseline, 0.3em before the wordmark. The
   wordmark is the outlined "Study" (bold) and "Spaces" (regular) from
   design/brand/; its capitals are 70.8 units tall. */
const WORDMARK_CAP = 70.8;
const wordmark = [...logo.matchAll(/<path data-word[^>]*\/>/g)]
  .map((m) => m[0].replace(/fill="[^"]*"/, `fill="${TEXT}"`))
  .join('');

/** The logo with its capitals `cap` tall, the top of the capitals at x, y.
    Returns its width too. */
function logoAt(x: number, y: number, cap: number) {
  const em = cap / CAP,
    markW = (cap * 112) / 120,
    gap = 0.3 * em,
    s = cap / WORDMARK_CAP,
    // The wordmark's first letter starts 3.6 units in from its origin.
    textX = x + markW + gap - 3.6 * s;
  return {
    width: markW + gap + 585 * s,
    svg:
      seatMark(x + markW / 2, y + cap / 2, cap) +
      `<g transform="translate(${textX} ${y + cap}) scale(${s})">${wordmark}</g>`,
  };
}

/** A line of text with the top of its capitals at y. */
const line = (
  x: number,
  y: number,
  size: number,
  weight: number,
  fill: string,
  content: string,
  extra = '',
) =>
  `<text x="${x}" y="${y + CAP * size}" font-size="${size}" font-weight="${weight}" fill="${fill}"${extra}>${escape(content)}</text>`;

/** The whole label as an SVG document, and its height in label units.
    Every gap between blocks is GAP, measured from the tops and bottoms of
    the capitals, and the card has PAD on every side. */
export function seatLabelSvg(room: string, seat: string, token: string) {
  let y = PAD;
  // Header: logo left, the seat as a "yours" chip right (like the seat map),
  // the logo's and the chip's capitals the same height and centred together.
  const chipH = 20,
    cap = 9,
    chipSize = cap / CAP,
    chipText = seat.length > 5 ? seat.slice(0, 4) + '…' : seat,
    chipW = Math.max(chipH, 9 + chipText.length * 7),
    capTop = y + (chipH - cap) / 2,
    brand = logoAt(PAD, capTop, cap),
    chip =
      `<rect x="${WIDTH - PAD - chipW}" y="${y}" width="${chipW}" height="${chipH}" rx="5.5" fill="${ACCENT}"/>` +
      line(
        WIDTH - PAD - chipW / 2,
        capTop,
        chipSize,
        700,
        ON_ACCENT,
        chipText,
        ' text-anchor="middle"',
      );
  y += chipH + GAP;
  // The room, as the app's uppercase section label.
  const roomSize = 5.6,
    roomLines = wrap(room.toUpperCase(), 30, 2),
    roomSvg = roomLines
      .map((l, i) =>
        line(
          PAD,
          y + i * 7.5,
          roomSize,
          700,
          MUTED,
          l,
          ' letter-spacing="0.5"',
        ),
      )
      .join('');
  y += (roomLines.length - 1) * 7.5 + CAP * roomSize + GAP;
  const qrSvg = qrCode(token, PAD + TILE, y + TILE);
  y += QR + 2 * TILE + GAP;
  const head = 8.5,
    sub = 7,
    note =
      line(PAD, y, head, 700, TEXT, 'Reserve it to make it yours.') +
      line(PAD, y + CAP * head + 4, sub, 400, MUTED, 'Scan here to check in.');
  y += CAP * head + 4 + CAP * sub + PAD;
  const height = Math.ceil(y);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${height}">` +
    `<rect x="0.5" y="0.5" width="${WIDTH - 1}" height="${height - 1}" rx="14" fill="${BG}" stroke="${BORDER}"/>` +
    brand.svg +
    `<g font-family="${FONT}">${chip}${roomSvg}${note}</g>` +
    qrSvg +
    '</svg>';
  return { svg, height };
}
