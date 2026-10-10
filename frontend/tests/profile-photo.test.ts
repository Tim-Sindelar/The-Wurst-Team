import assert from 'node:assert/strict';
import test from 'node:test';
import { photoCropRect } from '../src/domain/profilePhoto.ts';

test('a circular portrait preview crops the center square of a wide photo', () => {
  assert.deepEqual(photoCropRect(1200, 800, { x: 0, y: 0, zoom: 1 }), {
    x: 200,
    y: 0,
    size: 800,
  });
});

test('panning reaches either edge without exposing a blank margin', () => {
  assert.deepEqual(photoCropRect(800, 1200, { x: 0, y: 1, zoom: 1 }), {
    x: 0,
    y: 0,
    size: 800,
  });
  assert.deepEqual(photoCropRect(800, 1200, { x: 0, y: -1, zoom: 1 }), {
    x: 0,
    y: 400,
    size: 800,
  });
});

test('zoom and pan describe the exact source square persisted in the avatar', () => {
  assert.deepEqual(photoCropRect(1200, 800, { x: -1, y: 1, zoom: 2 }), {
    x: 800,
    y: 0,
    size: 400,
  });
  assert.deepEqual(photoCropRect(1200, 800, { x: 9, y: -9, zoom: 0 }), {
    x: 0,
    y: 0,
    size: 800,
  });
});
