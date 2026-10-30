// The engine module loads with the hooks kitap calls, and its schemas take a story's and a page's beden fields.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import beden, { StoryBody, PageBody, Model } from '../src/index.mjs';

test('the engine exports its id, schemas, client and hooks', () => {
  assert.equal(beden.id, 'beden');
  assert.deepEqual(Object.keys(beden.read), ['story', 'page', 'finish']);
  for (const k of ['bundle', 'objects', 'make', 'describeObjects']) assert.equal(typeof beden[k], 'function');
  assert.equal(beden.client.module, true);
  assert.ok(beden.client.imports.three);
});

test('the schemas take the fields the stories write and refuse unknown ones', () => {
  const story = StoryBody.parse({ model: 'body', cameras: { front: { direction: [0, 0.05, 1] } } });
  assert.deepEqual(story.families, {});
  const page = PageBody.parse({ camera: 'front', look: 'heart', parts: { highlight: ['heart'] }, labels: [{ part: 'heart', text: 'The heart' }] });
  assert.deepEqual(page.parts.ghost, []);
  assert.throws(() => PageBody.parse({ colour: 'red' }));
  const model = Model.parse({ parts: { heart: { concept: 'FMA7088' } } });
  assert.equal(model.file, 'model.glb');
});
