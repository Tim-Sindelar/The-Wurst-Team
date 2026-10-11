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

/** The seat mark (a desk with four seats, one free), centred at x, y. */
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

/** The logo from design/brand/ (light theme), cropped to its artwork. */
function logoAt(x: number, y: number, height: number) {
  const width = (height * 448) / 124;
  return {
    width,
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
  const inner = WIDTH - 2 * PAD;
  let y = PAD;
  // Header: logo left, the seat as a "yours" chip right (like the seat map).
  const chipH = 20,
    chipText = seat.length > 5 ? seat.slice(0, 4) + '…' : seat,
    chipW = Math.max(chipH, 9 + chipText.length * 7),
    brand = logoAt(PAD - 1, y + 2, 16),
    chip =
      `<rect x="${WIDTH - PAD - chipW}" y="${y}" width="${chipW}" height="${chipH}" rx="5.5" fill="${ACCENT}"/>` +
      `<text x="${WIDTH - PAD - chipW / 2}" y="${y + 14.6}" font-size="12.5" font-weight="700" fill="${ON_ACCENT}" text-anchor="middle">${escape(chipText)}</text>`;
  y += chipH + 13;
  // The room, as the app's uppercase section label.
  const roomLines = wrap(room.toUpperCase(), 30, 2),
    roomSvg = roomLines
      .map(
        (l, i) =>
          `<text x="${PAD}" y="${y + i * 7.5}" font-size="5.6" font-weight="700" letter-spacing="0.5" fill="${MUTED}">${escape(l)}</text>`,
      )
      .join('');
  y += (roomLines.length - 1) * 7.5 + 6 + TILE;
  const qrSvg = qrCode(token, PAD + (inner - QR) / 2, y);
  y += QR + TILE + 14;
  const note =
    `<text x="${PAD}" y="${y}" font-size="8.5" font-weight="700" fill="${TEXT}">Reserve it to make it yours.</text>` +
    `<text x="${PAD}" y="${y + 10}" font-size="7" fill="${MUTED}">Scan here to check in.</text>`;
  const height = Math.ceil(y + 10 + PAD);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${height}">` +
    `<rect x="0.5" y="0.5" width="${WIDTH - 1}" height="${height - 1}" rx="14" fill="${BG}" stroke="${BORDER}"/>` +
    brand.svg +
    `<g font-family="${FONT}">${chip}${roomSvg}${note}</g>` +
    qrSvg +
    '</svg>';
  return { svg, height };
}
