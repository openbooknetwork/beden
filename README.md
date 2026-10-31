# Beden

The body engine of the Open Book Network: a three.js viewport over anatomical models whose parts are named, so
that a page can show, light, ghost or cut them.

## Models

A story's model is `content/<story>/shared/models/<id>/model.yaml` and the `model.glb` built beside it from
BodyParts3D (The Database Center for Life Science, CC BY-SA 2.1 Japan). Each part names a BodyParts3D concept:

```yaml
file: model.glb
parts:
  heart:          { concept: FMA7088, layer: heart, family: muscle }
  left-ventricle: { concept: FMA7101, layer: chambers, family: oxygenated }
  veins:          { from: cardiovascular, minus: [arteries, heart], layer: veins, family: deoxygenated }
```

```
node bin/beden.mjs model content/<story>/shared/models/<id> --obj ~/.cache/beden/bodyparts3d/isa_BP3D_4.0_obj_99 --lists ~/.cache/beden/bodyparts3d
```

The command welds each part's element meshes into one, writes `model.glb` with one node per part and the sha256
into `model.yaml`.

### Parts from Z-Anatomy

[Z-Anatomy](https://github.com/LluisV/Z-Anatomy) (CC BY-SA 4.0) builds on BodyParts3D and adds structures it lacks,
such as the lymph nodes. `beden z-anatomy` fits Z-Anatomy's skeleton onto BodyParts3D's, about 3 mm apart along the
spine, and writes each mesh of a Z-Anatomy FBX as an element file `za-<mesh name>.obj` in BodyParts3D's frame:

```
node bin/beden.mjs z-anatomy LymphoidOrgans100.fbx --skeleton SkeletalSystem100.fbx --obj <BodyParts3D obj dirs> --lists ~/.cache/beden/bodyparts3d --out ~/.cache/beden/z-anatomy/lymphoid-organs
```

A part names those files with `elements`, where `*` matches any run of characters, and `beden model` takes their
folder as one more `--obj` folder:

```yaml
axillary-nodes: { elements: [za-*-axillary-nodes*, za-interpectoral-nodes*], grow: { length: 0.010 }, layer: nodes, family: node }
```

Z-Anatomy marks each lymph node with a 2.5 mm sphere. `grow` turns every separate piece of a part into a bean of
`length` metres around the same centre, `shape` giving its three axes as fractions of the length (default
`[1, 0.65, 0.45]`), each bean turned by angles taken from its centre.

### Drawn parts

A structure neither source holds, such as the thoracic duct, is drawn as a `tube` through points
`[x, y, z, radius]` in metres of the model's frame (x to the body's left, y up, z forward). Place the points on
landmarks measured on the BodyParts3D parts around it, and name each landmark beside its point:

```yaml
thoracic-duct:
  layer: ducts
  family: duct
  tube:
    - [-0.004, 1.081, 0.104, 0.0025]  # T12, the aortic hiatus, between the aorta and the azygos vein
    - [-0.004, 1.135, 0.088, 0.0025]  # T10
```

### Trimmed parts

`trim` takes off a part's triangles with a corner inside a box, given as two corners in metres of the model's frame,
and closes the hole with a smooth patch. BodyParts3D's skin holds the genitals, which a story about another system
leaves out:

```yaml
skin: { concept: FMA7163, layer: skin, family: skin, trim: [[-0.04, 0.683, 0.112], [0.04, 0.8, 0.26]] }
```

## A page

```yaml
beden:
  model: body
  camera: front            # a camera of the story, or
  look: heart              # the part the camera turns to
  layers: [skin, heart]    # layers shown; parts in `show` are shown whatever their layer
  parts: { show: [], highlight: [aorta], ghost: [skin], hide: [], flow: [left-ventricle, aorta] }
  section: { plane: coronal, at: 0.0 }
  labels: [{ part: aorta, text: "aorta" }]
```

A page shows what its own fields say. In `src/client.js`, `view(page, ...)` works out the whole look of the scene
from the page alone, with a value for every field a page leaves out, and `paint(view, meshes)` writes all of it onto
every part. The flow pulse and the glow of a part a text link points at are worked out again each frame on top of the
view. `test/view.test.mjs` paints every pair of its pages in both orders and fails when one page shows in the next.

`labels` show as callouts: a dot on the part, the label in a column beside the lit parts, and a line between them, so
small parts stay in sight. `callouts()` places them anew every frame as the camera moves.
