/* Seat QR codes are links into the app: <app address>qr?qr_token=<token>.
   Opening one (with the phone's camera or the app's scanner) opens the
   seat's seat map with the seat selected. */

/** The app path a seat QR link opens. Keep in line with `paths.seatQr`. */
const QR_PATH = 'qr';

/** The seat QR link for `token`, under the app address `prefix`
    (e.g. https://02.hackathon.ethz.ch/). Null when `prefix` isn't an
    http(s) address. */
export function seatQrLink(prefix: string, token: string): string | null {
  let base: URL;
  try {
    base = new URL(prefix.trim());
  } catch {
    return null;
  }
  if (base.protocol !== 'https:' && base.protocol !== 'http:') return null;
  base.search = '';
  base.hash = '';
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  const link = new URL(QR_PATH, base);
  link.searchParams.set('qr_token', token);
  return link.href;
}

/** The seat token in a scanned code: the `qr_token` of a seat QR link, or
    the code itself (labels printed before the codes were links). */
export function qrTokenFrom(scanned: string): string {
  const code = scanned.trim();
  try {
    return new URL(code).searchParams.get('qr_token')?.trim() || code;
  } catch {
    return code;
  }
}
