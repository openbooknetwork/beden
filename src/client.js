// Beden's viewport: a three.js scene over one glTF whose nodes are the story's parts. A page names the layers to
// show, the parts to light or ghost, a camera, a section plane, a flow sequence and labels.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const SECTIONS = { sagittal: [1, 0, 0], coronal: [0, 0, 1], axial: [0, 1, 0] };

// The whole look of the scene for one page: every part's visibility, colour, glow, opacity and depth writing, the
// section plane, the labels, the camera and the flow. It reads nothing but its arguments, so a page looks the same
// whichever page the reader came from. model holds the parts, layers and groups, cameras the story's cameras,
// color(family) a family's colour in the current theme, bounds(ids) the box { center, size } of those loaded parts
// or null, fov the camera's field of view.
export function view(page, { model, cameras, color, bounds, fov }) {
  const expand = ids => (ids ?? []).flatMap(id => model.groups?.[id] ?? [id]);
  const [show, lit, ghost, hide] = ['show', 'highlight', 'ghost', 'hide'].map(k => new Set(expand(page.parts?.[k])));
  const layers = new Set(page.layers ?? Object.keys(model.layers ?? {}));
  const parts = {};
  for (const [id, p] of Object.entries(model.parts)) {
    const opacity = lit.has(id) ? 1 : ghost.has(id) ? 0.12 : lit.size ? 0.35 : 1;
    parts[id] = { visible: (layers.has(p.layer) || show.has(id)) && !hide.has(id), color: color(p.family), glow: lit.has(id) ? 0.35 : 0, opacity, depthWrite: opacity > 0.5 };
  }
  // a section plane cuts everything on one side of it: sagittal, coronal or axial, at a point in metres
  const s = page.section, sign = s?.flip ? -1 : 1;
  const clip = s ? { normal: (SECTIONS[s.plane] ?? [0, 0, 1]).map(v => v * sign), constant: -(s.at ?? 0) * sign } : null;
  // a camera is a direction to look from; the target is a part, a group or a point, and the distance comes from the
  // page, the camera, or the size of what it looks at
  const cam = cameras[page.camera] ?? cameras[Object.keys(cameras)[0]] ?? { direction: [0, 0, 1] };
  const look = page.look ?? cam.look ?? cam.target, box = typeof look === 'string' ? bounds(model.groups?.[look] ?? [look]) : null;
  const target = Array.isArray(look) ? look : box?.center ?? [0, 0, 0];
  const dist = page.distance ?? cam.distance ?? (box?.size ?? 2) / (2 * Math.tan(fov * Math.PI / 360)) * 1.15;
  const dir = cam.direction ?? [0, 0, 1], len = Math.hypot(...dir) || 1;
  return {
    parts, clip, labels: (page.labels ?? []).map(l => ({ part: l.part, text: l.text })),
    camera: { target, position: target.map((v, k) => v + dir[k] / len * dist) }, flow: expand(page.parts?.flow), flowSeconds: page.flow_seconds ?? 4,
  };
}

// The camera between two pages at e from 0 to 1: the target moves straight, the camera swings round it on an arc
// and its distance eases geometrically, so a turn from front to back passes round the body. Two nearly opposite
// directions turn through the side, by way of the horizontal direction square to the first. Returns [position, target].
export function swing(from, to, t0, t1, e) {
  const target = t0.map((v, k) => v + (t1[k] - v) * e), off = (p, t) => p.map((v, k) => v - t[k]);
  const a = off(from, t0), b = off(to, t1), da = Math.hypot(...a) || 1e-9, db = Math.hypot(...b) || 1e-9;
  const na = a.map(v => v / da), nb = b.map(v => v / db), dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
  const slerp = (p, q, s) => {
    const w = Math.acos(Math.max(-1, Math.min(1, dot(p, q))));
    if (w < 1e-4) return p.map((v, k) => v + (q[k] - v) * s);
    return p.map((v, k) => (Math.sin((1 - s) * w) * v + Math.sin(s * w) * q[k]) / Math.sin(w));
  };
  let n;
  if (dot(na, nb) > -0.8) n = slerp(na, nb, e);
  else {
    const side = [na[2], 0, -na[0]], l = Math.hypot(...side), s = l > 1e-6 ? side.map(v => v / l) : [1, 0, 0];
    n = e < 0.5 ? slerp(na, s, e * 2) : slerp(s, nb, e * 2 - 1);
  }
  const d = da ** (1 - e) * db ** e;
  return [target.map((v, k) => v + n[k] * d), target];
}

// Places labels as callouts, so they leave the parts they name in sight: each label goes to a column beside the
// anchors, left or right of their middle, the two columns kept within one label of each other, stacked in the order
// of their anchors' heights and pushed apart, and a line runs from its inner edge to its anchor. anchors are screen
// points { x, y, visible }, sizes { w, h } in pixels, avoid the screen rectangle { left, right } of the lit parts,
// which the columns stand clear of. Returns per anchor { x, y, from, to } (label box and line) or null.
export function callouts(anchors, sizes, { width, height, avoid = null, gap = 48, margin = 8, spacing = 4 }) {
  const shown = anchors.map((a, i) => ({ ...a, i })).filter(a => a.visible), out = anchors.map(() => null);
  if (!shown.length) return out;
  const mid = shown.reduce((s, a) => s + a.x, 0) / shown.length;
  const left = shown.filter(a => a.x < mid), right = shown.filter(a => a.x >= mid);
  while (Math.abs(left.length - right.length) > 1) {
    const [from, to, inner] = left.length > right.length ? [left, right, (a, b) => b.x - a.x] : [right, left, (a, b) => a.x - b.x];
    from.sort(inner); to.push(from.shift());
  }
  for (const [col, isLeft] of [[left, true], [right, false]]) {
    if (!col.length) continue;
    col.sort((a, b) => a.y - b.y);
    const h = col.map(a => sizes[a.i].h), top = col.map((a, k) => a.y - h[k] / 2);
    for (let k = 1; k < col.length; k++) top[k] = Math.max(top[k], top[k - 1] + h[k - 1] + spacing);
    const over = top.at(-1) + h.at(-1) - (height - margin);
    if (over > 0) { top[top.length - 1] -= over; for (let k = top.length - 2; k >= 0; k--) top[k] = Math.min(top[k], top[k + 1] - h[k] - spacing); }
    if (top[0] < margin) { const push = margin - top[0]; for (let k = 0; k < top.length; k++) top[k] += push; }
    const edge = isLeft ? Math.min(...col.map(a => a.x), avoid?.left ?? Infinity) - gap : Math.max(...col.map(a => a.x), avoid?.right ?? -Infinity) + gap;
    col.forEach((a, k) => {
      const w = sizes[a.i].w, x = isLeft ? Math.max(margin, edge - w) : Math.min(width - margin - w, edge), y = top[k];
      out[a.i] = { x, y, from: [isLeft ? x + w : x, y + h[k] / 2], to: [a.x, a.y] };
    });
  }
  return out;
}

// Writes a view onto the meshes, every field of every part, so nothing of the page before remains. A mesh the view
// does not name is hidden.
export function paint(v, meshes) {
  const plane = v.clip ? new THREE.Plane(new THREE.Vector3(...v.clip.normal), v.clip.constant) : null;
  for (const [id, o] of meshes) {
    const p = v.parts[id], m = o.material;
    o.visible = !!p?.visible;
    if (!p) continue;
    m.color.set(p.color); m.emissive.set(p.color).multiplyScalar(p.glow);
    m.opacity = p.opacity; m.depthWrite = p.depthWrite;
    if ((m.clippingPlanes?.length ?? 0) !== (plane ? 1 : 0)) m.needsUpdate = true; // a plane added or removed changes the shader
    m.clippingPlanes = plane ? [plane] : [];
  }
}

// The engine's client: kitap's shell mounts it with a host carrying the bundle, the stage's elements, the current page
// and language, and the shell's helpers. A page's beden fields name the model it shows; the file loads once.
function beden(host) {
  const el = host.el.map, bundle = host.B[host.engine], ENGINE = host.engine;
  const dark = () => host.css('color-scheme') === 'dark';
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 50);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, stencil: true }); // the stencil draws the cut faces
  renderer.localClippingEnabled = true;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  el.appendChild(renderer.domElement);
  // the callouts: label boxes over an svg of their leader lines and anchor dots
  const layer = document.createElement('div'); layer.className = 'beden-callouts';
  layer.innerHTML = '<svg aria-hidden="true"></svg>'; el.appendChild(layer);
  const svg = layer.firstChild, SVG = 'http://www.w3.org/2000/svg';
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.zoomToCursor = true; // the wheel zooms on the part under the pointer, not on the orbit centre
  scene.add(new THREE.HemisphereLight(0xffffff, 0x667788, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(1, 2, 3); scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.5); fill.position.set(-2, -1, -2); scene.add(fill);

  const parts = new Map(), families = bundle.families ?? {}, cameras = bundle.cameras ?? {};
  const color = f => (dark() ? families[f]?.color_dark : families[f]?.color) ?? families[f]?.color ?? '#999999';
  // current is the page's spec, shown its view; pointed holds the parts a text link points at, glowing over the view
  let current = null, shown = null, flowT = 0, notes = [], focus = [], tween = null, pointed = new Set(), touched = new Set();

  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  let model = null, loadedId = null, root = null;
  function load(id) {
    if (id === loadedId) return;
    loadedId = id; model = bundle.models[id]; if (root) { root.removeFromParent(); root = null; } parts.clear();
    if (!model) return;
    loader.load(model.file, gltf => {
      if (loadedId !== id) return;
      gltf.scene.traverse(o => {
        if (!o.isMesh) return;
        const spec = model.parts[o.name] ?? {};
        o.material = new THREE.MeshStandardMaterial({ color: color(spec.family), roughness: 0.65, metalness: 0.02, transparent: true, side: THREE.DoubleSide });
        const box = new THREE.Box3().setFromObject(o);
        o.userData = { id: o.name, box, anchor: surfacePoint(o, box.getCenter(new THREE.Vector3())) };
        parts.set(o.name, o);
      });
      root = gltf.scene; scene.add(root);
      if (current) render({ camera: 'jump' });
    });
  }

  // The vertex of a part nearest to its centre, so a label sits on the part and not in the gap of a paired one.
  function surfacePoint(mesh, centre) {
    const pos = mesh.geometry.attributes.position, step = Math.max(1, Math.floor(pos.count / 4000)), v = new THREE.Vector3(), best = centre.clone();
    let d = Infinity;
    for (let i = 0; i < pos.count; i += step) { v.fromBufferAttribute(pos, i); const k = v.distanceToSquared(centre); if (k < d) { d = k; best.copy(v); } }
    return mesh.localToWorld(best);
  }

  const expand = ids => (ids ?? []).flatMap(id => model?.groups?.[id] ?? [id]);
  const point = (id, on) => { for (const p of expand([id])) on ? pointed.add(p) : pointed.delete(p); };
  // a label's point on the model: a part's own anchor, or for a group the anchor of its member nearest the group's middle
  const anchorOf = id => {
    if (parts.has(id)) return parts.get(id).userData.anchor;
    const members = expand([id]).filter(p => parts.has(p)), box = bounds(members); if (!box) return null;
    const c = new THREE.Vector3(...box.center);
    return members.map(p => parts.get(p).userData.anchor).sort((a, b) => a.distanceTo(c) - b.distanceTo(c))[0];
  };
  // on a cut page, a label's point on the part's cut face: of its vertices within 3 mm of the plane, the one nearest the
  // part's usual anchor, laid onto the plane. The dot then sits on what shows, and on one side of a paired part.
  const cutAnchorOf = (id, plane) => {
    const near = [], v = new THREE.Vector3();
    for (const p of expand([id])) {
      const o = parts.get(p), P = o?.geometry.attributes.position; if (!P || !o.userData.box.intersectsPlane(plane)) continue;
      for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i); o.localToWorld(v); if (Math.abs(plane.distanceToPoint(v)) < 0.003) near.push(v.clone()); }
    }
    if (!near.length) return null;
    const usual = anchorOf(id), c = usual ? plane.projectPoint(usual, new THREE.Vector3()) : near[0];
    return plane.projectPoint(near.reduce((best, q) => q.distanceTo(c) < best.distanceTo(c) ? q : best), new THREE.Vector3());
  };
  // Lays the callouts out for the camera of this frame: each anchor projected onto the screen, the labels placed
  // beside them by callouts(), the lines drawn from label to anchor.
  const v3 = new THREE.Vector3();
  function placeNotes() {
    if (!notes.length) return;
    const width = el.clientWidth, height = el.clientHeight;
    if (!width) return; // the stage is hidden, as on a phone's text tab
    for (const n of notes) if (!n.size.w) n.size = { w: n.div.offsetWidth, h: n.div.offsetHeight }; // measured once shown
    const anchors = notes.map(n => {
      v3.copy(n.anchor).project(camera);
      return { x: (v3.x + 1) / 2 * width, y: (1 - v3.y) / 2 * height, visible: v3.z > -1 && v3.z < 1 && Math.abs(v3.x) <= 1.05 && Math.abs(v3.y) <= 1.05 };
    });
    // the screen rectangle of the lit and labelled parts, from the corners of their boxes, which labels stand clear of
    let left = Infinity, right = -Infinity;
    for (const box of focus) for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      v3.set(x, y, z).project(camera); if (v3.z < -1 || v3.z > 1) continue;
      const sx = (v3.x + 1) / 2 * width; left = Math.min(left, sx); right = Math.max(right, sx);
    }
    const avoid = left < right ? { left, right } : null;
    callouts(anchors, notes.map(n => n.size), { width, height, avoid }).forEach((c, i) => {
      const n = notes[i], on = !!c;
      n.div.hidden = !on; n.line.style.display = n.dot.style.display = on ? '' : 'none';
      if (!on) return;
      n.div.style.transform = `translate(${c.x}px, ${c.y}px)`;
      n.line.setAttribute('x1', c.from[0]); n.line.setAttribute('y1', c.from[1]); n.line.setAttribute('x2', c.to[0]); n.line.setAttribute('y2', c.to[1]);
      n.dot.setAttribute('cx', c.to[0]); n.dot.setAttribute('cy', c.to[1]);
    });
  }
  const bounds = ids => {
    const b = new THREE.Box3(); for (const id of ids) if (parts.has(id)) b.union(parts.get(id).userData.box);
    return b.isEmpty() ? null : { center: b.getCenter(new THREE.Vector3()).toArray(), size: b.getSize(new THREE.Vector3()).length() };
  };

  // ---------- the cut faces ----------
  // A section leaves each cut part hollow, so a closed part gets a lid where the plane passes through it. Its back
  // faces add one to the stencil buffer and its front faces take one off, which leaves a count on the pixels inside
  // the part, and a flat plane in the part's colour is drawn on those pixels only. Larger parts go first, so the lid
  // of an inner part lies over the lid of the part around it. Only the lit parts get lids, or every part on a page that
  // lights none; dimmed and ghosted context stays see-through, since a faded lid reads as a dark hole.
  const lids = new THREE.Group(); scene.add(lids);
  let lidParts = [];
  // a part is closed when almost every edge of its surface joins two triangles; an open tube would streak its lid
  const closed = o => {
    if (o.userData.closed !== undefined) return o.userData.closed;
    const g = o.geometry, P = g.attributes.position, I = g.index, key = new Map(), at = [], edges = new Map();
    for (let i = 0; i < P.count; i++) { const k = `${P.getX(i).toFixed(5)},${P.getY(i).toFixed(5)},${P.getZ(i).toFixed(5)}`; if (!key.has(k)) key.set(k, key.size); at.push(key.get(k)); }
    const n = I ? I.count : P.count, v = i => at[I ? I.getX(i) : i];
    for (let t = 0; t + 2 < n; t += 3) for (let e = 0; e < 3; e++) { const a = v(t + e), b = v(t + (e + 1) % 3), k = a < b ? a * 4294967296 + b : b * 4294967296 + a; edges.set(k, (edges.get(k) ?? 0) + 1); }
    let open = 0; for (const c of edges.values()) if (c === 1) open++;
    return (o.userData.closed = open <= edges.size * 0.01);
  };
  function cutFaces() {
    for (const o of lids.children) { o.geometry.dispose(); o.material.dispose(); }
    lids.clear();
    for (const o of lidParts) for (const s of o.userData.stencil ?? []) { o.remove(s); s.material.dispose(); }
    lidParts = [];
    if (!shown?.clip) return;
    const plane = new THREE.Plane(new THREE.Vector3(...shown.clip.normal), shown.clip.constant);
    const lit = Object.values(shown.parts).some(p => p.glow > 0), lidded = p => p && (lit ? p.glow > 0 : p.opacity >= 1);
    const cut = [...parts.values()].filter(o => o.visible && lidded(shown.parts[o.name]) && o.userData.box.intersectsPlane(plane) && closed(o))
      .sort((a, b) => b.userData.box.getSize(v3).length() - a.userData.box.getSize(v3).length());
    const at = plane.coplanarPoint(new THREE.Vector3());
    cut.forEach((o, k) => {
      const p = shown.parts[o.name], order = 1 + 2 * k;
      const counter = (side, op) => new THREE.Mesh(o.geometry, new THREE.MeshBasicMaterial({ side, colorWrite: false, depthWrite: false, depthTest: false, clippingPlanes: [plane],
        stencilWrite: true, stencilFunc: THREE.AlwaysStencilFunc, stencilFail: op, stencilZFail: op, stencilZPass: op }));
      o.userData.stencil = [counter(THREE.BackSide, THREE.IncrementWrapStencilOp), counter(THREE.FrontSide, THREE.DecrementWrapStencilOp)];
      for (const s of o.userData.stencil) { s.renderOrder = order; o.add(s); }
      lidParts.push(o);
      // the lid: a flat plane in the part's colour, drawn where the count is not zero, which it then resets
      const lid = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshBasicMaterial({ color: p.color, side: THREE.DoubleSide,
        stencilWrite: true, stencilRef: 0, stencilFunc: THREE.NotEqualStencilFunc, stencilFail: THREE.ReplaceStencilOp, stencilZFail: THREE.ReplaceStencilOp, stencilZPass: THREE.ReplaceStencilOp }));
      lid.position.copy(at); lid.lookAt(at.clone().add(plane.normal)); lid.renderOrder = order + 1;
      lid.onAfterRender = r => r.clearStencil();
      lids.add(lid);
    });
  }

  // Shows the current page: its view painted onto every part, its labels, and the camera jumped or tweened to it, or
  // left where the reader turned it.
  function render({ camera: move = 'tween' } = {}) {
    if (!current || !model || !parts.size) return;
    shown = view(current, { model, cameras, color, bounds, fov: camera.fov });
    paint(shown, parts); touched = new Set(); cutFaces();
    const cutPlane = shown.clip && new THREE.Plane(new THREE.Vector3(...shown.clip.normal), shown.clip.constant);
    for (const n of notes) { n.div.remove(); n.line.remove(); n.dot.remove(); }
    notes = shown.labels.map(l => {
      const anchor = (cutPlane && cutAnchorOf(l.part, cutPlane)) || anchorOf(l.part); if (!anchor) return null;
      const div = document.createElement('div'); div.className = 'beden-label'; div.textContent = host.L(l.text); layer.appendChild(div);
      // pointing at a label lights its part, as pointing at the part's link in the text does
      div.addEventListener('pointerenter', () => point(l.part, true)); div.addEventListener('pointerleave', () => point(l.part, false));
      const line = svg.appendChild(document.createElementNS(SVG, 'line')), dot = svg.appendChild(document.createElementNS(SVG, 'circle'));
      dot.setAttribute('r', '3');
      return { anchor, div, line, dot, ids: expand([l.part]), size: { w: div.offsetWidth, h: div.offsetHeight } };
    }).filter(Boolean);
    // the boxes labels keep clear of: every lit part and every labelled part that shows
    const lit = Object.entries(shown.parts).filter(([, p]) => p.visible && p.glow > 0).map(([id]) => id);
    focus = [...new Set([...lit, ...expand(shown.labels.map(l => l.part))])].filter(id => parts.has(id) && shown.parts[id]?.visible).map(id => parts.get(id).userData.box);
    const target = new THREE.Vector3(...shown.camera.target), position = new THREE.Vector3(...shown.camera.position);
    if (move === 'jump') { camera.position.copy(position); controls.target.copy(target); tween = null; }
    else if (move === 'tween') tween = { from: camera.position.toArray(), to: position.toArray(), t0: controls.target.toArray(), t1: target.toArray(), t: 0 };
  }

  // The glow over the view, worked out again each frame: the flow runs a pulse of light along its parts in order, so
  // blood reads as moving through them, and a pointed part shines white. A part the glow left goes back to its view.
  function animate(dt) {
    if (tween) {
      tween.t = Math.min(1, tween.t + dt / 1.2);
      const [p, t] = swing(tween.from, tween.to, tween.t0, tween.t1, 1 - Math.pow(1 - tween.t, 3));
      camera.position.set(...p); controls.target.set(...t);
      if (tween.t >= 1) tween = null;
    }
    if (!shown) return;
    const glow = new Map();
    if (shown.flow.length) {
      flowT = (flowT + dt / shown.flowSeconds) % 1;
      shown.flow.forEach((id, i) => { const d = Math.abs(((i / shown.flow.length) - flowT + 1.5) % 1 - 0.5) * shown.flow.length; glow.set(id, { k: 0.15 + 0.7 * Math.max(0, 1 - d) }); });
    }
    for (const id of pointed) glow.set(id, { white: 0.6 });
    for (const id of touched) if (!glow.has(id)) {
      const o = parts.get(id), p = shown.parts[id]; if (!o || !p) continue;
      o.material.emissive.set(p.color).multiplyScalar(p.glow); o.material.opacity = p.opacity; o.material.depthWrite = p.depthWrite;
    }
    for (const [id, g] of glow) {
      const o = parts.get(id), p = shown.parts[id]; if (!o || !p) continue;
      if (g.white) o.material.emissive.set(0xffffff).multiplyScalar(g.white); else o.material.emissive.set(p.color).multiplyScalar(g.k);
      o.material.opacity = 1; o.material.depthWrite = true;
    }
    touched = new Set(glow.keys());
    // a callout lights with its part, whether the label, the text or the shell pointed at it
    for (const n of notes) { const on = n.ids.some(id => pointed.has(id)); n.div.classList.toggle('on', on); n.line.classList.toggle('on', on); n.dot.classList.toggle('on', on); }
  }

  function resize() {
    const w = el.clientWidth, h = el.clientHeight;
    renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(el);
  resize();
  const clock = new THREE.Timer();
  renderer.setAnimationLoop(() => { clock.update(); animate(clock.getDelta()); controls.update(); renderer.render(scene, camera); placeNotes(); });

  // Hover names the part under the pointer, from the bundle's names in the page language.
  const ray = new THREE.Raycaster(), tip = document.createElement('div'); tip.className = 'beden-tip'; el.appendChild(tip);
  renderer.domElement.addEventListener('pointermove', e => {
    const r = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera({ x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 }, camera);
    const hit = ray.intersectObjects([...parts.values()].filter(o => o.visible && o.material.opacity > 0.3), false)[0];
    tip.style.display = hit ? 'block' : 'none';
    if (hit) { tip.textContent = host.L(model?.names?.[hit.object.userData.id]) || hit.object.userData.id; tip.style.left = `${e.clientX - r.left + 12}px`; tip.style.top = `${e.clientY - r.top + 12}px`; }
  });

  const specOf = page => page.id == null ? (bundle.overview ?? { look: Object.keys(bundle.models[bundle.default]?.parts ?? {})[0] }) : page[ENGINE];
  const tools = stageTools(host, () => render());
  return {
    // a new page starts from its own view: the pointed parts and the flow's phase belong to the page before
    show(page, first) { current = specOf(page); pointed = new Set(); flowT = 0; load(current.model ?? bundle.default); render({ camera: first ? 'jump' : 'tween' }); tools.card(page); },
    point,
    highlight(kind, id) { pointed = new Set(expand([id])); },
    resize,
    theme() { render({ camera: 'stay' }); },
    lang() { render({ camera: 'stay' }); tools.label(); tools.card(host.here()); },
  };
}

// ---------- the stage's tools: a reset button in the view group, and the card a page opens beside the text ----------
function stageTools(host, reset) {
  const { el, T, L, B, engine, esc } = host, bundle = B[engine];
  el.legendButton.hidden = true; el.legend.hidden = true;
  const view = el.view; view.innerHTML = reset ? '<button type="button" data-view="reset"></button>' : ''; view.hidden = !reset;
  const btn = view.querySelector('button');
  const label = () => { if (!btn) return; btn.textContent = T().view_reset; view.setAttribute('aria-label', T().view_reset); };
  btn?.addEventListener('click', e => { e.stopPropagation(); reset(); });
  // the card a page opens sits above the sources in the text column, where the map's battle card sits
  const card = page => {
    const id = page?.[engine]?.open, c = id && bundle.cards?.[id]; el.story.querySelector('.bc')?.remove(); if (!c) return;
    const im = c.images?.[0] && B.images[c.images[0]], div = document.createElement('div'); div.className = 'bc';
    div.innerHTML = `<header><div><h4>${esc(L(c.name))}</h4>${L(c.subtitle) ? `<small>${esc(L(c.subtitle))}</small>` : ''}</div></header>`
      + (im ? `<figure class="pic"><div class="slide"><img src="${esc(im.src)}" alt="${esc(L(im.caption))}" data-img="${esc(c.images[0])}"></div><figcaption>${esc(L(im.caption))}</figcaption></figure>` : '')
      + `<div class="sides"><div class="side">${L(c.text) ? `<p>${esc(L(c.text))}</p>` : ''}<dl>${c.facts.map(f => `<dt>${esc(L(f.label))}</dt><dd>${esc(L(f.value))}</dd>`).join('')}</dl>${c.pseudocode?.length ? `<pre class="code">${c.pseudocode.map(l => esc(L(l))).join('\n')}</pre>` : ''}</div></div>`
      + (c.source ? `<footer><a href="${esc(c.source)}" target="_blank" rel="noopener">${esc(T().source)}</a></footer>` : '');
    el.story.querySelector('h3')?.before(div) ?? el.story.append(div);
  };
  label();
  return { label, card };
}

// in the browser the shell mounts the client; under node the tests import view and paint
if (typeof window !== 'undefined') { window.KITAP_ENGINE = beden; dispatchEvent(new Event('kitap-engine')); }
