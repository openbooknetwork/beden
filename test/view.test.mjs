// A page looks the same whichever page came before it: painting page A then page B leaves every part as painting B on
// fresh meshes does, for every pair of pages, the section, glow, ghosting, hiding and showing included.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { view, paint } from '../src/client.js';

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
