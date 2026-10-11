import qrcode from 'qrcode-generator';
import logo from './study-spaces-logo.svg?raw';

/* The printed seat label: the Study Spaces logo, the room and seat, the QR
   code with the seat mark in its middle, and a line telling people the seat
   is booked through the app. It is print artwork, so it uses the colours of
   the logo files in design/brand/ (light theme) rather than the app's tokens.

   Units: the QR code is 100 wide; the label is WIDTH wide. The admin picks
   the QR size in cm, and the label prints at WIDTH / 100 times that. */

export const WIDTH = 140;
const PAD = 10,
  QR = 100,
  INK = '#212121',
  MUTED = '#5c5c5c',
  LINE = '#c4c4c4',
  FREE = '#2e7d32',
  SEAT = '#808080',
  FONT = "Barlow, 'DIN Next LT W05', Arial, Helvetica, sans-serif";

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

const text = (
  lines: string[],
  y: number,
  size: number,
  weight: number,
  fill: string,
) =>
  lines
    .map(
      (l, i) =>
        `<text x="${WIDTH / 2}" y="${y + i * size * 1.25}" font-size="${size}" font-weight="${weight}" fill="${fill}">${escape(l)}</text>`,
    )
    .join('');

/** The seat mark (a desk with four seats, one free), centred at x, y. */
const seatMark = (x: number, y: number, size: number) => {
  const s = size / 120;
  return (
    `<g transform="translate(${x} ${y}) scale(${s}) translate(-128 -128)">` +
    `<rect x="72" y="111" width="112" height="34" rx="12" fill="${SEAT}"/>` +
    `<rect x="88" y="68" width="34" height="34" rx="9" fill="${FREE}"/>` +
    `<rect x="134" y="68" width="34" height="34" rx="9" fill="${SEAT}"/>` +
    `<rect x="88" y="154" width="34" height="34" rx="9" fill="${SEAT}"/>` +
    `<rect x="134" y="154" width="34" height="34" rx="9" fill="${SEAT}"/></g>`
  );
};

/** The QR code holds only the seat's token: the app's scan screen sends it
    as-is to the check-in call. It uses the highest error correction, so the
    seat mark covering its middle doesn't stop it from scanning. */
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
    `<path transform="translate(${x} ${y}) scale(${m})" d="${path}" fill="${INK}" shape-rendering="crispEdges"/>` +
    seatMark(x + QR / 2, y + QR / 2, hole * m * 0.8)
  );
}

/** The logo from design/brand/, cropped to its artwork, `width` wide. */
function logoAt(x: number, y: number, width: number) {
  const height = (width * 124) / 448;
  return {
    height,
    svg: logo
      .replace(/<title>.*?<\/title>/, '')
      .replace(
        /<svg[^>]*>/,
        `<svg x="${x}" y="${y}" width="${width}" height="${height}" viewBox="10 10 448 124">`,
      ),
  };
}

/** The whole label as an SVG document, and its height in label units. */
export function seatLabelSvg(room: string, seat: string, token: string) {
  let y = PAD + 4;
  const brand = logoAt((WIDTH - 76) / 2, y, 76);
  y += brand.height + 9;
  const roomLines = wrap(room, 30, 2),
    roomSvg = text(roomLines, y, 7, 500, MUTED);
  y += (roomLines.length - 1) * 7 * 1.25 + 15;
  const seatSvg = text(['Seat ' + seat], y, 15, 700, INK);
  y += 9;
  const qrSvg = qrCode(token, (WIDTH - QR) / 2, y);
  y += QR + 15;
  const head = text(['Part of Study Spaces'], y, 7.5, 700, INK);
  y += 9.5;
  const body = wrap(
    'Reserve this seat in the app to make sure it’s yours, then scan this code to check in.',
    38,
    3,
  );
  const bodySvg = text(body, y, 6.5, 400, MUTED);
  y += (body.length - 1) * 6.5 * 1.25 + PAD;
  const height = Math.ceil(y);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${height}">` +
    `<clipPath id="card"><rect width="${WIDTH}" height="${height}" rx="8"/></clipPath>` +
    `<g clip-path="url(#card)"><rect width="${WIDTH}" height="${height}" fill="white"/>` +
    `<rect width="${WIDTH}" height="3.5" fill="${FREE}"/></g>` +
    `<rect x="0.25" y="0.25" width="${WIDTH - 0.5}" height="${height - 0.5}" rx="7.75" fill="none" stroke="${LINE}" stroke-width="0.5"/>` +
    brand.svg +
    `<g font-family="${FONT}" text-anchor="middle">${roomSvg}${seatSvg}${head}${bodySvg}</g>` +
    qrSvg +
    '</svg>';
  return { svg, height };
}
