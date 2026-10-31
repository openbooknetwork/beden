// trim takes the triangles with a corner in a box off a closed surface and closes the hole, so the surface stays closed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trim } from '../src/model.mjs';

// a closed cube of side 2 around the origin, each face a 4 x 4 grid of quads, triangles wound outwards
function cube(n = 4) {
  const key = new Map(), pos = [], idx = [];
  const at = p => { const k = p.join(); if (!key.has(k)) { key.set(k, pos.length / 3); pos.push(...p); } return key.get(k); };
  for (const [a, b, c] of [[0, 1, 2], [1, 2, 0], [2, 0, 1]]) for (const s of [-1, 1]) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const v = (u, w) => { const p = []; p[a] = s; p[b] = -1 + 2 * u / n; p[c] = -1 + 2 * w / n; return at(p); };
    const q = [v(i, j), v(i + 1, j), v(i + 1, j + 1), v(i, j + 1)];
    idx.push(...(s > 0 ? [q[0], q[1], q[2], q[0], q[2], q[3]] : [q[0], q[2], q[1], q[0], q[3], q[2]]));
  }
  return { pos, idx };
}
const openEdges = idx => {
  const n = new Map();
  for (let t = 0; t < idx.length; t += 3) for (let j = 0; j < 3; j++) {
    const a = idx[t + j], b = idx[t + (j + 1) % 3], k = a < b ? `${a},${b}` : `${b},${a}`;
    n.set(k, (n.get(k) ?? 0) + 1);
  }
  return [...n.values()].filter(c => c !== 2).length;
};

test('a trimmed closed surface stays closed', () => {
  const { pos, idx } = cube();
  assert.equal(openEdges(idx), 0);
  const out = trim(pos, idx, [[-0.4, -0.4, 0.9], [0.4, 0.4, 1.1]]);
  assert.equal(openEdges(out.idx), 0);
});

test('a hole in a flat face closes flat', () => {
  const { pos, idx } = cube(), out = trim(pos, idx, [[-0.4, -0.4, 0.9], [0.4, 0.4, 1.1]]);
  assert.ok(out.idx.length > 0);
  for (let i = 0; i < out.pos.length; i += 3) {
    const [x, y, z] = out.pos.slice(i, i + 3);
    if (z > 0 && Math.abs(x) < 0.99 && Math.abs(y) < 0.99) assert.ok(Math.abs(z - 1) < 1e-9, `vertex ${[x, y, z]} left the top face`);
  }
});

test('a box that holds no vertex leaves the surface as it was', () => {
  const { pos, idx } = cube(), out = trim(pos, idx, [[5, 5, 5], [6, 6, 6]]);
  assert.equal(out.idx.length, idx.length);
  assert.equal(out.pos.length, pos.length);
});
