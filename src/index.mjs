// Beden's Node half, the engine module kitap loads: its fields of story.yaml and page.yaml under the beden key, the
// models and structures under shared/, the checks over a story, the bundle the viewport receives and the model files
// it keeps in the store. The hooks follow kitap's README.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { schema } from '@openbooknetwork/kitap';

const { z, Id, Translatable, Hex, check } = schema;
const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const Family = z.object({ color: Hex, color_dark: Hex.optional() }).strict();
const Camera = z.object({ direction: z.tuple([z.number(), z.number(), z.number()]), look: z.string().optional(), distance: z.number().positive().optional() }).strict();
export const StoryBody = z.object({
  model: Id, // the model of shared/models/ every page shows unless it names another
  cameras: z.record(Id, Camera).default({}),
  families: z.record(Id, Family).default({}),
  overview: z.object({}).passthrough().optional(), // the page spec the overview opens with
}).strict();
const Parts = z.object({ show: z.array(Id).default([]), highlight: z.array(Id).default([]), ghost: z.array(Id).default([]), hide: z.array(Id).default([]), flow: z.array(Id).default([]) }).strict();
export const PageBody = z.object({
  model: Id.optional(),
  camera: Id.optional(),
  look: z.union([Id, z.tuple([z.number(), z.number(), z.number()])]).optional(),
  distance: z.number().positive().optional(),
  layers: z.array(Id).optional(),
  parts: Parts.default({}),
  section: z.object({ plane: z.enum(['sagittal', 'coronal', 'axial']), at: z.number().default(0), flip: z.boolean().default(false) }).strict().optional(),
  labels: z.array(z.object({ part: Id, text: Translatable }).strict()).default([]),
  flow_seconds: z.number().positive().optional(),
  open: Id.optional(),      // the structure whose card opens beside the text
  structure: Id.optional(), // the same, as the first stories wrote it
}).strict();
// model.yaml: parts by their BodyParts3D concept, groups of parts, and the built file
const Part = z.object({ concept: z.string().optional(), concepts: z.array(z.string()).optional(), elements: z.array(z.string()).optional(),
  tube: z.array(z.tuple([z.number(), z.number(), z.number(), z.number().positive()])).min(2).optional(),
  grow: z.object({ length: z.number().positive(), shape: z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]).optional() }).strict().optional(), from: Id.optional(), minus: z.array(Id).optional(), plus: z.array(Id).optional(), exclude: z.array(z.string()).optional(),
  layer: Id.optional(), family: Id.optional(), export: z.boolean().optional() }).strict();
export const Model = z.object({ file: z.string().default('model.glb'), sha256: z.string().regex(/^[0-9a-f]{64}$/).optional(), credit: z.string().optional(), source: z.string().url().optional(),
  simplify: z.number().optional(), parts: z.record(Id, Part), groups: z.record(Id, z.array(Id)).default({}), default_language: z.string().default('en') }).strict();
// structure.yaml: a card beside the text
export const Structure = z.object({ name: Translatable, latin: z.string().optional(), role: Translatable.optional(), source: z.string().url().optional(), images: z.array(Id).default([]),
  facts: z.array(z.object({ label: Translatable, value: Translatable }).strict()).default([]), default_language: z.string().default('en') }).strict();

const isModel = d => fs.existsSync(path.join(d, 'model.yaml'));
const isStructure = d => fs.existsSync(path.join(d, 'structure.yaml'));
const ID = /^[a-z0-9][a-z0-9-]*$/;

// --- reading a story: its models and structures, read when a page first names one ---
function readStory(story, ctx) {
  const { fail, rel, langs } = ctx, S = story.beden;
  const shared = path.join(ctx.root, ctx.where, 'shared'), common = path.join(ctx.content, 'shared');
  const E = { story: S, models: {}, structures: {}, folders: [] };
  const lib = (kind, isItem) => dir => ctx.library(dir, isItem, ID, `a ${kind} folder is named in lowercase letters, digits and dashes`);
  const find = (kind, isItem, id, at) => {
    const own = lib(kind, isItem)(path.join(shared, kind + 's')).get(id), both = [own, lib(kind, isItem)(path.join(common, kind + 's')).get(id)].filter(Boolean);
    if (both.length > 1) fail(at, `${kind} "${id}" is in both ${rel(both[0])} and ${rel(both[1])}, keep one`);
    return both[0] ?? fail(at, `unknown ${kind} "${id}", add ${rel(path.join(shared, kind + 's', id))}/${kind}.yaml`);
  };
  E.model = (id, at) => {
    if (E.models[id]) return E.models[id];
    const dir = find('model', isModel, id, at), file = path.join(dir, 'model.yaml'), m = ctx.readYaml(file, Model);
    const t = ctx.translatorFor({ defaultLang: m.default_language, dir, where: rel(file) });
    // a part's name per language, from the model folder's catalogue, else its id in words
    const names = Object.fromEntries([...Object.keys(m.parts), ...Object.keys(m.groups)].map(k => [k, t.tr(k.replace(/-/g, ' '), `parts.${k}`, { shared: true })]));
    const glb = path.join(dir, m.file);
    E.folders.push({ kind: 'model', id, dir: rel(dir), defaultLang: m.default_language, translator: t });
    return E.models[id] = { id, dir, file: glb, exists: fs.existsSync(glb), sha256: m.sha256 ?? null, credit: m.credit ?? null, parts: m.parts, groups: m.groups, names, known: new Set([...Object.keys(m.parts), ...Object.keys(m.groups)]) };
  };
  E.structure = (id, at, scope) => {
    if (E.structures[id]) return E.structures[id];
    const dir = find('structure', isStructure, id, at), file = path.join(dir, 'structure.yaml'), c = ctx.readYaml(file, Structure);
    const t = ctx.translatorFor({ defaultLang: c.default_language, dir, where: rel(file) });
    const images = c.images.map(ref => ctx.resolveImage(scope, ref, rel(file)));
    E.folders.push({ kind: 'structure', id, dir: rel(dir), defaultLang: c.default_language, translator: t });
    return E.structures[id] = { id, kind: 'structure', name: t.tr(c.name, 'structure.name'), subtitle: Object.fromEntries(langs.map(l => [l, c.latin ?? ''])), text: c.role ? t.tr(c.role, 'structure.role') : ctx.emptyText(), source: c.source ?? null, images,
      facts: c.facts.map((f, i) => ({ label: t.tr(f.label, `structure.facts.${i}.label`), value: t.tr(f.value, `structure.facts.${i}.value`, { shared: true }) })) };
  };
  E.model(S.model, ctx.storyFile);
  return E;
}

// the beden fields of a page, checked against the model it shows
function readPage(bp, { at, own, scope: s }, ctx) {
  const E = ctx.state, pg = check(PageBody, bp, at), m = E.model(pg.model ?? E.story.model, at), ids = m.known;
  const need = id => ids.has(id) || ctx.fail(at, `names part "${id}", which model ${m.id} does not hold`);
  for (const k of ['show', 'highlight', 'ghost', 'hide', 'flow']) pg.parts[k].forEach(need);
  for (const l of pg.labels) need(l.part);
  if (typeof pg.look === 'string') need(pg.look);
  if (pg.camera && !E.story.cameras[pg.camera]) ctx.fail(at, `names camera "${pg.camera}", which story.yaml does not define`);
  const open = pg.open ?? pg.structure ?? null;
  if (open) E.structure(open, at, s);
  const labels = pg.labels.map((l, i) => ({ part: l.part, text: s.T(l.text, `pages.${own}.labels.${i}`) }));
  const { structure, ...rest } = pg;
  return {
    data: { ...rest, open, labels, model: m.id },
    // a place the text links is a part or a group of the page's model
    links: { has: id => ids.has(id), attr: id => ` data-ref="${esc(id)}"`, missing: (name, id) => `[${name}](@${id}) links to "${id}", which model ${m.id} does not hold: link a part or group of its model.yaml`,
      names: lang => [...ids].map(id => [id, m.names[id]?.[lang]]) },
  };
}

function finish({ pages }, ctx) {
  const E = ctx.state;
  for (const m of Object.values(E.models)) if (!m.exists) ctx.warn(`${ctx.rel(m.file)} is not built, run: beden model ${ctx.rel(m.dir)}`);
  const images = pages.flatMap(pg => pg.beden.open ? E.structures[pg.beden.open]?.images ?? [] : []);
  return { images, folders: E.folders };
}

// the bundle: every model the pages show with its file in the store, its parts and names, and the cards
function bundle(content, ctx) {
  const E = content.state, S = E.story, models = {};
  for (const m of Object.values(E.models)) models[m.id] = { file: ctx.objectLink(modelKey(content.story.id, m)), parts: m.parts, groups: m.groups, names: m.names, layers: Object.fromEntries(Object.values(m.parts).map(p => [p.layer, 1])) };
  const cards = Object.fromEntries(Object.values(E.structures).map(c => [c.id, c]));
  return { data: { models, default: S.model, cameras: S.cameras, families: S.families, cards, overview: S.overview ?? null }, families: S.families, credits: [...new Set(Object.values(E.models).map(m => m.credit).filter(Boolean))] };
}
const modelKey = (story, m) => `models/${story}/${m.id}-${(m.sha256 ?? 'unbuilt').slice(0, 12)}${path.extname(m.file)}`;

// the model files, keyed by their sha256, which kitap puts in the store and checks there
function objects(content) {
  const groups = {}, files = {};
  for (const m of Object.values(content.state.models)) { const key = modelKey(content.story.id, m); (groups[`models/${m.id}`] ??= []).push(key); files[key] = m.file; }
  return { groups, files };
}
async function make({ stories, out, log }) {
  let n = 0;
  for (const s of stories) for (const [key, file] of Object.entries(s.own?.files ?? s.files ?? {})) {
    if (!Object.values(s.groups).flat().includes(key)) continue;
    if (!fs.existsSync(file)) throw new Error(`${file} is not built, run beden model on its folder`);
    const to = path.join(out, key); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(file, to); n++;
  }
  if (n) log(`wrote ${n} model file${n === 1 ? '' : 's'} into ${path.basename(out)}/models`);
}

export default {
  id: 'beden',
  dir: PKG,
  schemas: { story: StoryBody, page: PageBody },
  ui: new URL('./i18n/', import.meta.url),
  client: { script: new URL('./client.js', import.meta.url), styles: new URL('./client.css', import.meta.url), module: true,
    imports: { three: ['three', 'build', 'three.module.js'], 'three/addons/': ['three', 'examples/jsm'] } },
  read: { story: readStory, page: readPage, finish },
  bundle, objects, make,
  describeObjects: keys => `${keys.length} model file${keys.length === 1 ? '' : 's'}`,
};
