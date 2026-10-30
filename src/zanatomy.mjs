// Brings meshes of Z-Anatomy (CC BY-SA 4.0, built on BodyParts3D) into BodyParts3D's frame as element files that a
// model.yaml part names with `elements`. Z-Anatomy's FBX exports stand in centimetres with y up and sit some 6 cm
// higher and 9 cm further back, so the transform is fitted by matching Z-Anatomy's skeleton to BodyParts3D's.
import fs from 'node:fs';
import path from 'node:path';
import { readIndex, parseObj } from './model.mjs';

// the axial skeleton, which both sources share almost unchanged: Z-Anatomy mesh -> BodyParts3D concept
const BONES = {
  'Atlas_(C1)': 'FMA12519', 'Axis_(C2)': 'FMA12520', Vertebra_C3: 'FMA12521', Vertebra_C4: 'FMA12522', Vertebra_C5: 'FMA12523',
  Vertebra_C6: 'FMA12524', Vertebra_C7: 'FMA12525', Vertebra_T1: 'FMA9165', Vertebra_T2: 'FMA9187', Vertebra_T3: 'FMA9209',
  Vertebra_T4: 'FMA9248', Vertebra_T5: 'FMA9922', Vertebra_T6: 'FMA9945', Vertebra_T7: 'FMA9968', Vertebra_T8: 'FMA9991',
  Vertebra_T9: 'FMA10014', Vertebra_T10: 'FMA10037', Vertebra_T11: 'FMA10059', Vertebra_T12: 'FMA10081', Vertebra_L1: 'FMA13072',
  Vertebra_L2: 'FMA13073', Vertebra_L3: 'FMA13074', Vertebra_L4: 'FMA13075', Vertebra_L5: 'FMA13076', Sacrum: 'FMA16202',
  Manubrium_of_sternum: 'FMA7486', Body_of_sternum: 'FMA7487', Frontal_bone: 'FMA52734', Occipital_bone: 'FMA52735',
  Mandible: 'FMA52748', Hip_boner: 'FMA16586', Hip_bonel: 'FMA16587', Clavicler: 'FMA13322', Claviclel: 'FMA13323',
  First_ribr: 'FMA7857', First_ribl: 'FMA7987',
};

// Every mesh of an FBX: world positions in metres, y up as Z-Anatomy exports them, and triangle indices.
export async function readFbx(file) {
  globalThis.self ??= globalThis; // FBXLoader looks for a browser global
  const three = await import('three'), { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
  const buf = fs.readFileSync(file), root = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  root.updateMatrixWorld(true);
  const out = new Map(), v = new three.Vector3();
  root.traverse(o => {
    if (!o.isMesh) return;
    const p = o.geometry.attributes.position, pos = new Float64Array(p.count * 3);
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); pos[3 * i] = v.x / 100; pos[3 * i + 1] = v.y / 100; pos[3 * i + 2] = v.z / 100; }
    out.set(o.name, { pos, idx: o.geometry.index ? Array.from(o.geometry.index.array) : Array.from({ length: p.count }, (_, i) => i) });
  });
  return out;
}

// A concept's vertices in beden's glTF frame: metres, y up, facing +z.
function conceptPoints(index, objDirs, concept) {
  const all = [];
  for (const el of index.elements.get(concept) ?? []) {
    const f = objDirs.map(d => path.join(d, `${el}.obj`)).find(p => fs.existsSync(p));
    if (!f) continue;
    const { pos } = parseObj(fs.readFileSync(f, 'utf8'));
    for (let i = 0; i < pos.length; i += 3) all.push(pos[i] / 1000, pos[i + 2] / 1000, -pos[i + 1] / 1000);
  }
  return all;
}

const apply = ({ s, R, t }, p) => [0, 1, 2].map(r => s * (R[3 * r] * p[0] + R[3 * r + 1] * p[1] + R[3 * r + 2] * p[2]) + t[r]);
const mul = (A, B) => [0, 1, 2].flatMap(r => [0, 1, 2].map(q => A[3 * r] * B[q] + A[3 * r + 1] * B[3 + q] + A[3 * r + 2] * B[6 + q]));
const det = m => m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
const T3 = m => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];

// Eigenvalues and eigenvectors (columns) of a symmetric 3x3 matrix, by Jacobi rotations.
function eigen(M) {
  const a = M.slice(), v = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (let sweep = 0; sweep < 50; sweep++) for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
    if (Math.abs(a[3 * p + q]) < 1e-18) continue;
    const th = (a[3 * q + q] - a[3 * p + p]) / (2 * a[3 * p + q]), t = (th < 0 ? -1 : 1) / (Math.abs(th) + Math.hypot(th, 1)), c = 1 / Math.hypot(t, 1), s = t * c;
    for (let k = 0; k < 3; k++) { const x = a[3 * k + p], y = a[3 * k + q]; a[3 * k + p] = c * x - s * y; a[3 * k + q] = s * x + c * y; }
    for (let k = 0; k < 3; k++) { const x = a[3 * p + k], y = a[3 * q + k]; a[3 * p + k] = c * x - s * y; a[3 * q + k] = s * x + c * y; }
    for (let k = 0; k < 3; k++) { const x = v[3 * k + p], y = v[3 * k + q]; v[3 * k + p] = c * x - s * y; v[3 * k + q] = s * x + c * y; }
  }
  return { vals: [a[0], a[4], a[8]], vecs: v };
}

// Umeyama's least-squares similarity s R x + t from src onto dst, both flat xyz arrays of matched points.
function similarity(src, dst) {
  const n = src.length / 3, ms = [0, 0, 0], md = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { ms[k] += src[3 * i + k] / n; md[k] += dst[3 * i + k] / n; }
  const C = [0, 0, 0, 0, 0, 0, 0, 0, 0]; let vs = 0;
  for (let i = 0; i < n; i++) {
    const a = [0, 1, 2].map(k => src[3 * i + k] - ms[k]), b = [0, 1, 2].map(k => dst[3 * i + k] - md[k]);
    for (let r = 0; r < 3; r++) for (let q = 0; q < 3; q++) C[3 * r + q] += b[r] * a[q] / n;
    vs += (a[0] ** 2 + a[1] ** 2 + a[2] ** 2) / n;
  }
  // C = U S V^T: V and S^2 from C^T C, then U = C V / S
  const { vals, vecs } = eigen(mul(T3(C), C)), order = [0, 1, 2].sort((x, y) => vals[y] - vals[x]);
  const V = [0, 1, 2].flatMap(r => order.map(o => vecs[3 * r + o])), S = order.map(o => Math.sqrt(Math.max(vals[o], 0)));
  const CV = mul(C, V), U = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let j = 0; j < 3; j++) { const l = Math.hypot(CV[j], CV[3 + j], CV[6 + j]) || 1; for (let r = 0; r < 3; r++) U[3 * r + j] = CV[3 * r + j] / l; }
  const D = [1, 1, det(U) * det(V) < 0 ? -1 : 1], R = mul(mul(U, [D[0], 0, 0, 0, D[1], 0, 0, 0, D[2]]), T3(V));
  const s = (S[0] * D[0] + S[1] * D[1] + S[2] * D[2]) / vs, Rm = apply({ s, R, t: [0, 0, 0] }, ms);
  return { s, R, t: md.map((m, k) => m - Rm[k]) };
}
const compose = (A, B) => ({ s: A.s * B.s, R: mul(A.R, B.R), t: apply(A, B.t) });

// Fits the transform from Z-Anatomy's frame to beden's by iterated closest points over the bones both hold, each
// Z-Anatomy point matched within its own bone. Returns it with the median distance per bone after the fit.
export function fitSkeleton(za, { index, objDirs, log = () => {} }) {
  const bones = Object.entries(BONES).filter(([n]) => za.has(n)).map(([name, c]) => {
    const { pos } = za.get(name), step = Math.max(1, Math.floor(pos.length / 3 / 300)), src = [];
    for (let i = 0; i < pos.length / 3; i += step) src.push([pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]]);
    return { name, src, dst: conceptPoints(index, objDirs, c) };
  });
  const nearest = (dst, p) => { let best = Infinity, at = 0; for (let j = 0; j < dst.length; j += 3) { const d = (dst[j] - p[0]) ** 2 + (dst[j + 1] - p[1]) ** 2 + (dst[j + 2] - p[2]) ** 2; if (d < best) { best = d; at = j; } } return [Math.sqrt(best), at]; };
  let T = { s: 1, R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, -0.06, 0.09] };
  for (let it = 0; it < 40; it++) {
    const pairs = bones.flatMap(b => b.src.map(q => { const p = apply(T, q), [d, j] = nearest(b.dst, p); return { d, p, m: [b.dst[j], b.dst[j + 1], b.dst[j + 2]] }; }));
    // the farthest tenth are left out, where Z-Anatomy reshaped a bone
    const cut = pairs.map(x => x.d).sort((a, b) => a - b)[Math.floor(pairs.length * 0.9)], kept = pairs.filter(x => x.d <= cut);
    T = compose(similarity(kept.flatMap(x => x.p), kept.flatMap(x => x.m)), T);
    if (it % 10 === 9) log(`fit pass ${it + 1}: 90% of points within ${(cut * 1000).toFixed(1)} mm`);
  }
  const report = bones.map(b => { const ds = b.src.map(q => nearest(b.dst, apply(T, q))[0]).sort((a, c) => a - c); return { bone: b.name, median: ds[ds.length >> 1] }; });
  return { T, report };
}

// An element id from a Z-Anatomy mesh name: Anterior_axillary_nodesr -> za-anterior-axillary-nodesr
export const elementId = name => 'za-' + name.toLowerCase().replace(/[()]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Writes each mesh as <out>/<element id>.obj in BodyParts3D's frame: millimetres, z up, facing -y.
export function writeElements(meshes, T, out) {
  fs.mkdirSync(out, { recursive: true });
  const written = [];
  for (const [name, { pos, idx }] of meshes) {
    // Z-Anatomy's label leader lines are meshes of a few dozen vertices whose names end in j
    if (idx.length < 3 || (/j$/.test(name) && pos.length / 3 < 100)) continue;
    const lines = [`# ${name} from Z-Anatomy, CC BY-SA 4.0, moved into BodyParts3D's frame by beden z-anatomy`];
    for (let i = 0; i < pos.length; i += 3) {
      const [x, y, z] = apply(T, [pos[i], pos[i + 1], pos[i + 2]]);
      lines.push(`v ${(x * 1000).toFixed(3)} ${(-z * 1000).toFixed(3)} ${(y * 1000).toFixed(3)}`);
    }
    for (let i = 0; i + 2 < idx.length; i += 3) lines.push(`f ${idx[i] + 1} ${idx[i + 1] + 1} ${idx[i + 2] + 1}`);
    const id = elementId(name);
    fs.writeFileSync(path.join(out, `${id}.obj`), lines.join('\n') + '\n');
    written.push({ id, name, vertices: pos.length / 3 });
  }
  return written;
}

// beden z-anatomy: the meshes of one Z-Anatomy FBX as element files, placed by the fit of its skeleton FBX.
export async function importZAnatomy({ fbx, skeleton, objDirs, listsDir, out, log = console.log }) {
  const index = readIndex(listsDir), { T, report } = fitSkeleton(await readFbx(skeleton), { index, objDirs, log });
  for (const r of report) log(`${r.bone.padEnd(22)} ${(r.median * 1000).toFixed(1)} mm`);
  const written = writeElements(await readFbx(fbx), T, out);
  fs.writeFileSync(path.join(out, 'transform.json'), JSON.stringify({ from: path.basename(fbx), skeleton: path.basename(skeleton), ...T }, null, 1) + '\n');
  log(`wrote ${written.length} element files into ${out}`);
  return { T, report, written };
}
