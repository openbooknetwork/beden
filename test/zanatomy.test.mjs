// The leg correction moves only points below the femur head, by the shift interpolated between the marks of their side.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { legWarp } from '../src/zanatomy.mjs';

const legs = {
  right: [{ y: 0.9, d: [0, 0, 0] }, { y: 0.6, d: [0, -0.01, 0] }, { y: 0.3, d: [0, -0.05, 0] }, { y: 0.05, d: [0.002, -0.055, 0] }],
  left: [{ y: 0.9, d: [0, 0, 0] }, { y: 0.3, d: [0, -0.04, 0] }],
};
const warp = legWarp(legs), near = (a, b) => a.every((v, k) => Math.abs(v - b[k]) < 1e-12);

test('points at or above the femur head stay where they are', () => {
  for (const p of [[0.1, 0.9, 0.1], [-0.1, 1.3, 0], [0, 1.6, 0.05]]) assert.deepEqual(warp(p), p);
});

test('points below move by the shift interpolated on their own side', () => {
  assert.ok(near(warp([-0.1, 0.45, 0]), [-0.1, 0.45 - 0.03, 0]), 'right, halfway between 0.6 and 0.3');
  assert.ok(near(warp([0.1, 0.6, 0]), [0.1, 0.6 - 0.02, 0]), 'left, a third of the way down');
  assert.ok(near(warp([-0.1, 0.0, 0]), [-0.098, -0.055, 0]), 'below the last mark it keeps the last shift');
});
