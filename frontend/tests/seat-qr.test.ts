import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { qrTokenFrom, seatQrLink } from '../src/domain/seatQr.ts';

test('seat QR links put the token under the app address', () => {
  assert.equal(
    seatQrLink('https://02.hackathon.ethz.ch/', 'abc_-1'),
    'https://02.hackathon.ethz.ch/qr?qr_token=abc_-1',
  );
  assert.equal(
    seatQrLink(' https://02.hackathon.ethz.ch/pr/7 ', 'abc'),
    'https://02.hackathon.ethz.ch/pr/7/qr?qr_token=abc',
  );
  assert.equal(
    seatQrLink('http://localhost:5173/?x=1#y', 'a b'),
    'http://localhost:5173/qr?qr_token=a+b',
  );
  assert.equal(seatQrLink('not a link', 'abc'), null);
  assert.equal(seatQrLink('ftp://example.com/', 'abc'), null);
});

test('the scanner reads the token from links and plain codes', () => {
  const link = seatQrLink('https://02.hackathon.ethz.ch/pr/7/', 'tok-en_1');
  assert.equal(qrTokenFrom(link!), 'tok-en_1');
  assert.equal(qrTokenFrom('  plain-token \n'), 'plain-token');
  assert.equal(
    qrTokenFrom('https://example.com/other'),
    'https://example.com/other',
  );
});
