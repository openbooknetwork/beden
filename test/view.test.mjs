// A page looks the same whichever page came before it: painting page A then page B leaves every part as painting B on
// fresh meshes does, for every pair of pages, the section, glow, ghosting, hiding and showing included.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { view, paint, swing, callouts } from '../src/client.js';

const model = {
  layers: { skin: 1, bones: 1, vessels: 1, nodes: 1 },
  parts: {
    skin: { layer: 'skin', family: 'skin' }, femur: { layer: 'bones', family: 'bone' }, aorta: { layer: 'vessels', family: 'red' },
    vein: { layer: 'vessels', family: 'blue' }, 'groin-nodes': { layer: 'nodes', family: 'node' }, 'neck-nodes': { layer: 'nodes', family: 'node' },
  },
  groups: { nodes: ['groin-nodes', 'neck-nodes'], vessels: ['aorta', 'vein'] },
};
const cameras = { front: { direction: [0, 0, 1] }, above: { direction: [0, 1, 0.2] } };
const colors = { skin: '#f2d9c4', bone: '#e8e2d2', red: '#b5352a', blue: '#2f6fb0', node: '#4f8a3c' };
const ctx = { model, cameras, color: f => colors[f], bounds: ids => ids.includes('aorta') ? { center: [0, 1.2, 0.1], size: 0.4 } : null, fov: 35 };

const PAGES = {
  plain: {},
  layered: { camera: 'front', layers: ['skin', 'vessels'], parts: { highlight: ['aorta'], ghost: ['skin'] } },
  cut: { camera: 'above', look: [0, 0.8, 0.1], distance: 0.7, section: { plane: 'axial', at: 0.795, flip: true }, layers: ['vessels', 'nodes'], parts: { highlight: ['nodes'] } },
  sagittal: { section: { plane: 'sagittal', at: 0 }, parts: { hide: ['vessels'], show: ['groin-nodes'] }, layers: ['bones'] },
  flow: { look: 'aorta', parts: { flow: ['aorta', 'vein'], highlight: ['vessels'] }, labels: [{ part: 'aorta', text: 'aorta' }] },
};

const meshes = () => new Map(Object.keys(model.parts).map(id => [id, { visible: true, material: new THREE.MeshStandardMaterial({ transparent: true }) }]));
const snapshot = ms => Object.fromEntries([...ms].map(([id, o]) => [id, {
  visible: o.visible, color: o.material.color.getHexString(), emissive: o.material.emissive.getHexString(), opacity: o.material.opacity,
  depthWrite: o.material.depthWrite, clip: (o.material.clippingPlanes ?? []).map(p => [...p.normal.toArray(), p.constant]),
}]));

test('every page paints the same after any other page as on its own', () => {
  for (const [b, pageB] of Object.entries(PAGES)) {
    const fresh = meshes(); paint(view(pageB, ctx), fresh);
    for (const [a, pageA] of Object.entries(PAGES)) {
      const ms = meshes(); paint(view(pageA, ctx), ms); paint(view(pageB, ctx), ms);
      assert.deepEqual(snapshot(ms), snapshot(fresh), `${b} after ${a}`);
    }
  }
});

test('the view of a page does not depend on the views worked out before it', () => {
  const alone = Object.fromEntries(Object.entries(PAGES).map(([k, p]) => [k, view(p, ctx)]));
  for (const [k, p] of Object.entries(PAGES).reverse()) assert.deepEqual(view(p, ctx), alone[k], k);
});

test('a section cuts only its own page', () => {
  const ms = meshes();
  paint(view(PAGES.cut, ctx), ms);
  assert.ok([...ms.values()].every(o => o.material.clippingPlanes.length === 1));
  paint(view(PAGES.plain, ctx), ms);
  assert.ok([...ms.values()].every(o => o.material.clippingPlanes.length === 0));
});

test('groups stand for their parts in highlight, hide and flow', () => {
  const v = view(PAGES.flow, ctx);
  assert.deepEqual(v.flow, ['aorta', 'vein']);
  assert.equal(v.parts.vein.opacity, 1);
  assert.equal(v.parts.femur.opacity, 0.35);
  assert.equal(view(PAGES.sagittal, ctx).parts.aorta.visible, false);
  assert.equal(view(PAGES.sagittal, ctx).parts['groin-nodes'].visible, true);
});

test('the camera swings round the target between pages, never through it', () => {
  const near = (p, q) => p.every((v, k) => Math.abs(v - q[k]) < 1e-9);
  const cases = [
    { name: 'back to front', from: [0, 1.2, -0.5], t0: [0, 1.2, 0.1], to: [0, 1.25, 1.0], t1: [0, 1.3, 0.1] },
    { name: 'exactly opposite', from: [0, 1, -1], t0: [0, 1, 0], to: [0, 1, 1], t1: [0, 1, 0] },
    { name: 'front to oblique', from: [0, 1, 1], t0: [0, 1, 0], to: [0.7, 1.35, 1], t1: [0, 1, 0] },
    { name: 'below to front', from: [0, 0.5, 0.15], t0: [0, 1.5, 0], to: [0, 1.5, 1], t1: [0, 1.5, 0] },
  ];
  for (const c of cases) {
    const [p0, g0] = swing(c.from, c.to, c.t0, c.t1, 0), [p1, g1] = swing(c.from, c.to, c.t0, c.t1, 1);
    assert.ok(near(p0, c.from) && near(g0, c.t0) && near(p1, c.to) && near(g1, c.t1), `${c.name}: ends on both pages' cameras`);
    const floor = Math.min(Math.hypot(...c.from.map((v, k) => v - c.t0[k])), Math.hypot(...c.to.map((v, k) => v - c.t1[k])));
    for (let i = 1; i < 100; i++) {
      const [p, g] = swing(c.from, c.to, c.t0, c.t1, i / 100), d = Math.hypot(...p.map((v, k) => v - g[k]));
      assert.ok(d >= floor * 0.999, `${c.name}: at ${i}% the camera is ${d.toFixed(3)} m from the target, under ${floor.toFixed(3)}`);
    }
  }
});

test('callouts keep labels off the lit parts, apart from each other and inside the view', () => {
  // a seeded walk, so every run checks the same clusters
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let run = 0; run < 200; run++) {
    const n = 1 + Math.floor(rnd() * 12);
    const anchors = Array.from({ length: n }, () => ({ x: 300 + rnd() * 200, y: 100 + rnd() * 400, visible: true }));
    const sizes = anchors.map(() => ({ w: 60 + rnd() * 90, h: 22 }));
    // the lit parts reach past their anchors by up to 60 px on each side
    const xs = anchors.map(a => a.x), avoid = { left: Math.min(...xs) - rnd() * 60, right: Math.max(...xs) + rnd() * 60 };
    const view = { width: 800, height: 600, avoid };
    const out = callouts(anchors, sizes, view), boxes = out.map((c, i) => ({ ...c, w: sizes[i].w, h: sizes[i].h }));
    for (const [i, b] of boxes.entries()) assert.ok(b.x + b.w <= avoid.left || b.x >= avoid.right, `run ${run}: label ${i} lies over the lit parts`);
    const left = out.filter(c => c.from[0] > c.x).length, right = n - left;
    assert.ok(Math.abs(left - right) <= 1, `run ${run}: columns of ${left} and ${right}`);
    for (const [i, b] of boxes.entries()) {
      assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= view.width && b.y + b.h <= view.height, `run ${run}: label ${i} inside the view`);
      assert.deepEqual(b.to, [anchors[i].x, anchors[i].y], `run ${run}: line ${i} ends on its anchor`);
      for (const a of anchors) assert.ok(!(a.x > b.x && a.x < b.x + b.w && a.y > b.y && a.y < b.y + b.h), `run ${run}: label ${i} covers an anchor`);
      for (const [j, o] of boxes.entries()) if (j > i) assert.ok(b.x + b.w <= o.x || o.x + o.w <= b.x || b.y + b.h <= o.y || o.y + o.h <= b.y, `run ${run}: labels ${i} and ${j} overlap`);
    }
  }
});

test('a label whose anchor is off screen or behind the camera is left out', () => {
  const out = callouts([{ x: 400, y: 300, visible: true }, { x: 0, y: 0, visible: false }], [{ w: 80, h: 20 }, { w: 80, h: 20 }], { width: 800, height: 600 });
  assert.ok(out[0]); assert.equal(out[1], null);
});
