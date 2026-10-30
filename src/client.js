// Beden's viewport: a three.js scene over one glTF whose nodes are the story's parts. A page names the layers to
// show, the parts to light or ghost, a camera, a section plane, a flow sequence and labels.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
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
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.localClippingEnabled = true;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  el.appendChild(renderer.domElement);
  const labels = new CSS2DRenderer();
  Object.assign(labels.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
  el.appendChild(labels.domElement);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.zoomToCursor = true; // the wheel zooms on the part under the pointer, not on the orbit centre
  scene.add(new THREE.HemisphereLight(0xffffff, 0x667788, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(1, 2, 3); scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.5); fill.position.set(-2, -1, -2); scene.add(fill);

  const parts = new Map(), families = bundle.families ?? {}, cameras = bundle.cameras ?? {};
  const color = f => (dark() ? families[f]?.color_dark : families[f]?.color) ?? families[f]?.color ?? '#999999';
  // current is the page's spec, shown its view; pointed holds the parts a text link points at, glowing over the view
  let current = null, shown = null, flowT = 0, labelObjs = [], tween = null, pointed = new Set(), touched = new Set();

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
  const bounds = ids => {
    const b = new THREE.Box3(); for (const id of ids) if (parts.has(id)) b.union(parts.get(id).userData.box);
    return b.isEmpty() ? null : { center: b.getCenter(new THREE.Vector3()).toArray(), size: b.getSize(new THREE.Vector3()).length() };
  };

  // Shows the current page: its view painted onto every part, its labels, and the camera jumped or tweened to it, or
  // left where the reader turned it.
  function render({ camera: move = 'tween' } = {}) {
    if (!current || !model || !parts.size) return;
    shown = view(current, { model, cameras, color, bounds, fov: camera.fov });
    paint(shown, parts); touched = new Set();
    for (const l of labelObjs) l.removeFromParent();
    labelObjs = shown.labels.map(l => {
      const p = parts.get(l.part); if (!p) return null;
      const div = document.createElement('div'); div.className = 'beden-label'; div.textContent = host.L(l.text);
      const o = new CSS2DObject(div); o.position.copy(p.userData.anchor); scene.add(o); return o;
    }).filter(Boolean);
    const target = new THREE.Vector3(...shown.camera.target), position = new THREE.Vector3(...shown.camera.position);
    if (move === 'jump') { camera.position.copy(position); controls.target.copy(target); tween = null; }
    else if (move === 'tween') tween = { from: camera.position.clone(), to: position, t0: controls.target.clone(), t1: target, t: 0 };
  }

  // The glow over the view, worked out again each frame: the flow runs a pulse of light along its parts in order, so
  // blood reads as moving through them, and a pointed part shines white. A part the glow left goes back to its view.
  function animate(dt) {
    if (tween) { tween.t = Math.min(1, tween.t + dt / 1.2); const e = 1 - Math.pow(1 - tween.t, 3); camera.position.lerpVectors(tween.from, tween.to, e); controls.target.lerpVectors(tween.t0, tween.t1, e); if (tween.t >= 1) tween = null; }
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
  }

  function resize() {
    const w = el.clientWidth, h = el.clientHeight;
    renderer.setSize(w, h); labels.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(el);
  resize();
  const clock = new THREE.Timer();
  renderer.setAnimationLoop(() => { clock.update(); animate(clock.getDelta()); controls.update(); renderer.render(scene, camera); labels.render(scene, camera); });

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
    point(id, on) { for (const p of expand([id])) on ? pointed.add(p) : pointed.delete(p); },
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
