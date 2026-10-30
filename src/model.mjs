// Builds a story's model.glb from BodyParts3D: one glTF node per part, named by the part id, so that the viewer
// can light, ghost or hide any part. Parts name a BodyParts3D concept (FMA id) or a set operation on other parts.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplify, quantize, meshopt } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';

// Reads the tab separated BodyParts3D lists once: concept id -> element file ids, over both trees.
export function readIndex(dir) {
  const rows = f => fs.readFileSync(path.join(dir, f), 'utf8').split('\n').slice(1).filter(Boolean).map(l => l.split('\t'));
  const elements = new Map(), names = new Map();
  for (const f of ['partof_element_parts.txt', 'isa_element_parts.txt']) {
    if (!fs.existsSync(path.join(dir, f))) continue;
    for (const [id, name, el] of rows(f)) {
      if (!elements.has(id)) elements.set(id, new Set());
      elements.get(id).add(el);
      names.set(id, name);
    }
  }
  return { elements, names };
}

// BodyParts3D OBJ: v lines and f lines, triangles, millimetres. Returns positions and indices.
export function parseObj(text) {
  const pos = [], idx = [];
  for (const line of text.split('\n')) {
    if (line[0] === 'v' && line[1] === ' ') {
      const [, x, y, z] = line.trim().split(/\s+/);
      pos.push(+x, +y, +z);
    } else if (line[0] === 'f') {
      const v = line.trim().split(/\s+/).slice(1).map(t => parseInt(t, 10) - 1);
      for (let i = 1; i + 1 < v.length; i++) idx.push(v[0], v[i], v[i + 1]);
    }
  }
  return { pos, idx };
}

// Turns each separate piece of a welded mesh, a marker sphere such as Z-Anatomy's 2.5 mm lymph nodes, into a bean
// around the same centre: semi-axes length / 2 times shape, in millimetres, turned by angles taken from the centre so
// that the same node keeps the same turn on every build.
export function grow(pos, idx, { length, shape = [1, 0.65, 0.45] }) {
  const n = pos.length / 3, par = Array.from({ length: n }, (_, i) => i), find = x => par[x] === x ? x : (par[x] = find(par[x]));
  for (let t = 0; t < idx.length; t += 3) { const a = find(idx[t]); par[find(idx[t + 1])] = a; par[find(idx[t + 2])] = a; }
  const pieces = new Map();
  for (let i = 0; i < n; i++) { const r = find(i); if (!pieces.has(r)) pieces.set(r, []); pieces.get(r).push(i); }
  const half = shape.map(s => s * length * 500), frac = x => x - Math.floor(x);
  for (const vs of pieces.values()) {
    const c = [0, 1, 2].map(k => vs.reduce((s, i) => s + pos[3 * i + k], 0) / vs.length);
    const [a, b, g] = [12.9898, 78.233, 37.719].map(w => 2 * Math.PI * frac(Math.sin(c[0] * w + c[1] * 4.1414 + c[2] * 1.618) * 43758.5453));
    const [ca, sa, cb, sb, cg, sg] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b), Math.cos(g), Math.sin(g)];
    const R = [cb * cg, sa * sb * cg - ca * sg, ca * sb * cg + sa * sg, cb * sg, sa * sb * sg + ca * cg, ca * sb * sg - sa * cg, -sb, sa * cb, ca * cb];
    for (const i of vs) {
      const d = [0, 1, 2].map(k => pos[3 * i + k] - c[k]), l = Math.hypot(...d) || 1, u = d.map((v, k) => v / l * half[k]);
      for (let k = 0; k < 3; k++) pos[3 * i + k] = c[k] + R[3 * k] * u[0] + R[3 * k + 1] * u[1] + R[3 * k + 2] * u[2];
    }
  }
}

// Welds coincident vertices and computes smooth normals, so a part shades as one surface. `beans` grows its pieces.
function mesh(pieces, beans = null) {
  const key = new Map(), pos = [], idx = [];
  for (const p of pieces) {
    const remap = new Int32Array(p.pos.length / 3);
    for (let i = 0; i < remap.length; i++) {
      const k = `${p.pos[3 * i].toFixed(2)},${p.pos[3 * i + 1].toFixed(2)},${p.pos[3 * i + 2].toFixed(2)}`;
      let j = key.get(k);
      if (j === undefined) { j = pos.length / 3; key.set(k, j); pos.push(p.pos[3 * i], p.pos[3 * i + 1], p.pos[3 * i + 2]); }
      remap[i] = j;
    }
    for (const i of p.idx) idx.push(remap[i]);
  }
  if (beans) grow(pos, idx, beans);
  const n = new Float32Array(pos.length);
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t] * 3, idx[t + 1] * 3, idx[t + 2] * 3];
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const i of [a, b, c]) { n[i] += nx; n[i + 1] += ny; n[i + 2] += nz; }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
  }
  return { pos: new Float32Array(pos), nor: n, idx: pos.length / 3 > 65535 ? new Uint32Array(idx) : new Uint16Array(idx) };
}

// Resolves each part of model.yaml to its element files. A part is { concept: FMA7088 }, { concepts: [...] } or
// { from: cardiovascular, minus: [arteries, heart] }, the last for sets BodyParts3D has no concept for. `plus` adds
// parts defined above it, for a tree whose table leaves out segments the named parts hold. `elements` names element
// files outside BodyParts3D's tables, such as those `beden z-anatomy` writes, a * matching any run of characters.
export function resolveParts(parts, index, files = []) {
  const out = {};
  for (const [id, p] of Object.entries(parts)) {
    let set;
    if (p.from) {
      set = new Set(out[p.from] ?? []);
      for (const m of p.minus ?? []) for (const e of out[m] ?? []) set.delete(e);
    } else {
      set = new Set();
      for (const c of p.concepts ?? (p.concept ? [p.concept] : [])) {
        const els = index.elements.get(c);
        if (!els) throw new Error(`${id}: BodyParts3D has no concept ${c}. Look it up in partof_parts_list_e.txt`);
        for (const e of els) set.add(e);
      }
      for (const pattern of p.elements ?? []) {
        const re = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`), hits = files.filter(f => re.test(f));
        if (!hits.length) throw new Error(`${id}: no element file in the --obj folders matches ${pattern}`);
        for (const e of hits) set.add(e);
      }
    }
    for (const e of p.exclude ?? []) set.delete(e); // element files the source lists under the wrong concept
    for (const other of p.plus ?? []) for (const e of out[other] ?? []) set.add(e); // parts defined above join this one
    out[id] = set;
  }
  return out;
}

// Writes a binary glTF with one node and mesh per part, positions in metres, y up as glTF wants it.
export function writeGlb(partsMeshes, file) {
  const bin = [], views = [], accessors = [], meshes = [], nodes = [];
  let offset = 0;
  const push = (arr, target) => {
    const bytes = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength), pad = (4 - bytes.length % 4) % 4;
    bin.push(bytes, Buffer.alloc(pad));
    views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target });
    offset += bytes.length + pad;
    return views.length - 1;
  };
  for (const [id, m] of Object.entries(partsMeshes)) {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < m.pos.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], m.pos[i + k]); max[k] = Math.max(max[k], m.pos[i + k]); }
    const p = push(m.pos, 34962), n = push(m.nor, 34962), x = push(m.idx, 34963);
    accessors.push({ bufferView: p, componentType: 5126, count: m.pos.length / 3, type: 'VEC3', min, max });
    accessors.push({ bufferView: n, componentType: 5126, count: m.nor.length / 3, type: 'VEC3' });
    accessors.push({ bufferView: x, componentType: m.idx instanceof Uint32Array ? 5125 : 5123, count: m.idx.length, type: 'SCALAR' });
    const a = accessors.length - 3;
    meshes.push({ name: id, primitives: [{ attributes: { POSITION: a, NORMAL: a + 1 }, indices: a + 2 }] });
    nodes.push({ name: id, mesh: meshes.length - 1 });
  }
  const json = { asset: { version: '2.0', generator: 'beden' }, scene: 0, scenes: [{ nodes: nodes.map((_, i) => i) }], nodes, meshes, accessors, bufferViews: views, buffers: [{ byteLength: offset }] };
  let jsonBuf = Buffer.from(JSON.stringify(json)); const jpad = (4 - jsonBuf.length % 4) % 4; jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(jpad, 0x20)]);
  const binBuf = Buffer.concat(bin);
  const header = Buffer.alloc(12); header.write('glTF', 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binBuf.length, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(jsonBuf.length, 0); jh.write('JSON', 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(binBuf.length, 0); bh.writeUInt32LE(0x004E4942, 4);
  const out = Buffer.concat([header, jh, jsonBuf, bh, binBuf]);
  fs.writeFileSync(file, out);
  return { bytes: out.length, sha256: createHash('sha256').update(out).digest('hex') };
}

// BodyParts3D is z up with the body facing -y; glTF is y up facing +z. Millimetres become metres.
function toGltf(m) {
  for (let i = 0; i < m.pos.length; i += 3) {
    const [x, y, z] = [m.pos[i], m.pos[i + 1], m.pos[i + 2]];
    m.pos[i] = x / 1000; m.pos[i + 1] = z / 1000; m.pos[i + 2] = -y / 1000;
    const [nx, ny, nz] = [m.nor[i], m.nor[i + 1], m.nor[i + 2]];
    m.nor[i] = nx; m.nor[i + 1] = nz; m.nor[i + 2] = -ny;
  }
  return m;
}

// A drawn structure no source holds, such as the thoracic duct: a tube along a centripetal Catmull-Rom curve through
// points [x, y, z, radius] in metres of the glTF frame, closed at both ends. Returns a piece in BodyParts3D's frame.
export function tube(points, { sides = 12, steps = 8 } = {}) {
  const P = points.map(p => p.slice(0, 3)), sub = (a, b) => a.map((v, k) => v - b[k]), len = a => Math.hypot(...a);
  const norm = a => { const l = len(a) || 1; return a.map(v => v / l); }, cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const ext = [P[0].map((v, k) => 2 * v - P[1][k]), ...P, P.at(-1).map((v, k) => 2 * v - P.at(-2)[k])];
  const C = [], R = [];
  for (let s = 0; s + 1 < P.length; s++) {
    const [p0, p1, p2, p3] = ext.slice(s, s + 4), t1 = len(sub(p1, p0)) ** 0.5, t2 = t1 + len(sub(p2, p1)) ** 0.5, t3 = t2 + len(sub(p3, p2)) ** 0.5;
    const lerp = (a, b, ta, tb, t) => a.map((v, k) => ((tb - t) * v + (t - ta) * b[k]) / (tb - ta));
    for (let i = 0; i < steps + (s + 2 === P.length ? 1 : 0); i++) {
      const t = t1 + (t2 - t1) * i / steps, A1 = lerp(p0, p1, 0, t1, t), A2 = lerp(p1, p2, t1, t2, t), A3 = lerp(p2, p3, t2, t3, t);
      C.push(lerp(lerp(A1, A2, 0, t2, t), lerp(A2, A3, t1, t3, t), t1, t2, t));
      R.push(points[s][3] + (points[s + 1][3] - points[s][3]) * i / steps);
    }
  }
  // rings around the curve, their frames carried along it so the tube does not twist
  const pos = [], idx = [], T = C.map((_, i) => norm(sub(C[Math.min(i + 1, C.length - 1)], C[Math.max(i - 1, 0)])));
  let N = norm(cross(T[0], Math.abs(T[0][1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
  C.forEach((c, i) => {
    N = norm(sub(N, T[i].map(v => v * (N[0] * T[i][0] + N[1] * T[i][1] + N[2] * T[i][2]))));
    const B = cross(T[i], N);
    for (let j = 0; j < sides; j++) { const a = 2 * Math.PI * j / sides; pos.push(c.map((v, k) => v + R[i] * (Math.cos(a) * N[k] + Math.sin(a) * B[k]))); }
  });
  for (let i = 0; i + 1 < C.length; i++) for (let j = 0; j < sides; j++) {
    const a = i * sides + j, b = i * sides + (j + 1) % sides;
    idx.push(a, b, a + sides, b, b + sides, a + sides);
  }
  pos.push(C[0], C.at(-1));
  const first = pos.length - 2, last = pos.length - 1, end = (C.length - 1) * sides;
  for (let j = 0; j < sides; j++) idx.push(first, (j + 1) % sides, j, last, end + j, end + (j + 1) % sides);
  // glTF metres (x, y, z) are BodyParts3D millimetres (x, -z, y)
  return { pos: pos.flatMap(([x, y, z]) => [x * 1000, -z * 1000, y * 1000]), idx };
}

// Builds model.glb beside model.yaml. objDirs hold the FJ*.obj element files, listsDir the BodyParts3D tables.
export function buildModel(modelDir, { objDirs, listsDir, yaml }) {
  const spec = yaml.load(fs.readFileSync(path.join(modelDir, 'model.yaml'), 'utf8'));
  const files = objDirs.flatMap(d => fs.readdirSync(d).filter(f => f.endsWith('.obj')).map(f => f.slice(0, -4)));
  const index = readIndex(listsDir), sets = resolveParts(spec.parts, index, files), meshes = {}, report = [];
  const cache = new Map();
  // an element file may sit in either BodyParts3D archive, so every folder given is searched
  const find = el => objDirs.map(d => path.join(d, `${el}.obj`)).find(f => fs.existsSync(f));
  const read = el => { if (!cache.has(el)) cache.set(el, parseObj(fs.readFileSync(find(el), 'utf8'))); return cache.get(el); };
  for (const [id, els] of Object.entries(sets)) {
    if (spec.parts[id].export === false) continue; // a set that only derives other parts
    const pieces = spec.parts[id].tube ? [tube(spec.parts[id].tube)] : [...els].filter(find).map(read);
    // a part whose element files the archive lacks is left out, and the report says so
    if (!pieces.length) { report.push({ id, elements: 0, triangles: 0, missing: els.size }); continue; }
    meshes[id] = toGltf(mesh(pieces, spec.parts[id].grow));
    report.push({ id, elements: pieces.length, triangles: meshes[id].idx.length / 3, missing: Math.max(els.size - pieces.length, 0) });
  }
  const file = path.join(modelDir, spec.file ?? 'model.glb'), raw = writeGlb(meshes, file);
  return { file, raw: raw.bytes, report, compress: () => compress(file, spec.simplify ?? 0.25) };
}

// Welds, simplifies to the ratio within 0.1% error, quantizes and meshopt-compresses the file in place: a whole
// body of 70 MB comes out at 6 MB and the viewer decodes it with meshopt_decoder.
export async function compress(file, ratio) {
  await MeshoptSimplifier.ready; await MeshoptEncoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  const doc = await io.read(file);
  await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.001 }), quantize(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const out = Buffer.from(await io.writeBinary(doc));
  fs.writeFileSync(file, out);
  return { bytes: out.length, sha256: createHash('sha256').update(out).digest('hex') };
}
