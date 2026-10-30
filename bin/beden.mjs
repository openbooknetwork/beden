#!/usr/bin/env node
// beden model <model dir> --obj <dir of FJ*.obj>[,<dir>...] --lists <dir of BodyParts3D tables>
// beden z-anatomy <fbx> --skeleton <SkeletalSystem fbx> --obj <dir>[,<dir>...] --lists <dir> --out <dir>
import path from 'node:path';
import fs from 'node:fs';
import yaml from 'js-yaml';
import { buildModel } from '../src/model.mjs';

const USAGE = 'usage: beden model <model dir> --obj <dir> --lists <dir> | beden z-anatomy <fbx> --skeleton <fbx> --obj <dir> --lists <dir> --out <dir>';
const [cmd, target, ...rest] = process.argv.slice(2);
const opt = k => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : undefined; };
const need = (...ks) => { const miss = ks.filter(k => !opt(k)); if (!target || miss.length) { console.error(`${USAGE}\nmissing: ${[!target && 'the target', ...miss].filter(Boolean).join(', ')}`); process.exit(2); } };
const objDirs = () => opt('--obj').split(',').map(d => path.resolve(d));

if (cmd === 'model') {
  need('--obj', '--lists');
  const { file, raw, report, compress } = buildModel(path.resolve(target), { objDirs: objDirs(), listsDir: path.resolve(opt('--lists')), yaml });
  for (const r of report) console.log(`${r.id.padEnd(28)} ${String(r.elements).padStart(4)} elements ${String(r.triangles).padStart(8)} triangles${r.missing ? `   ${r.missing} element files missing` : ''}`);
  const { bytes, sha256 } = await compress();
  console.log(`${file}: ${(raw / 1e6).toFixed(1)} MB raw, ${(bytes / 1e6).toFixed(1)} MB simplified and compressed, sha256 ${sha256}`);
  const y = path.join(path.dirname(file), 'model.yaml'), text = fs.readFileSync(y, 'utf8');
  fs.writeFileSync(y, /^sha256:.*$/m.test(text) ? text.replace(/^sha256:.*$/m, `sha256: ${sha256}`) : text.replace(/^file:.*$/m, m => `${m}\nsha256: ${sha256}`));
} else if (cmd === 'z-anatomy') {
  need('--skeleton', '--obj', '--lists', '--out');
  const { importZAnatomy } = await import('../src/zanatomy.mjs');
  await importZAnatomy({ fbx: path.resolve(target), skeleton: path.resolve(opt('--skeleton')), objDirs: objDirs(), listsDir: path.resolve(opt('--lists')), out: path.resolve(opt('--out')) });
} else { console.error(USAGE); process.exit(2); }
