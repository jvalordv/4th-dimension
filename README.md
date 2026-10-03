# 4th-dimension

An interactive, mathematically grounded visualizer of four-dimensional
objects seen from three-dimensional space. Everything you see is computed
from the definitions in [`docs/MATH.md`](docs/MATH.md) and checked by tests
against known results. Nothing is hand-animated.

## What it shows

A 4D object is a set of points with four coordinates `(x, y, z, w)`. There
are two honest ways to show one in 3D, and the viewer offers both:

- **Projection.** Drop one dimension the way a camera drops one when it
  photographs a 3D scene. The familiar "cube inside a cube" tesseract is a
  perspective projection. Edges and faces are drawn; colour encodes the
  invisible `w` coordinate.
- **Slicing.** Intersect the object with our 3D space, the hyperplane
  `w = c`. Sliding `c` animates the object passing through. A 4D ball passing
  through appears as a 3D ball that grows and shrinks. A tesseract tilted on
  its long diagonal appears as a point, a tetrahedron, an octahedron, and
  back.
- **Overlay.** Both at once: the slice drawn inside the projected wireframe
  at the scale the 4D perspective eye would see it.

Rotation in 4D happens in six planes, not around three axes. Three of them
(`XY`, `XZ`, `YZ`) are ordinary 3D rotations. The other three (`XW`, `YW`,
`ZW`) turn the object partly out of our space and produce the inside-out
morphing that makes 4D animations look strange.

## Shapes

| Group | Shapes |
|---|---|
| Regular polytopes | 5-cell, tesseract, 16-cell, 24-cell, 120-cell, 600-cell |
| Curved solids | 4-ball (hypersphere, 65 536 tets, within 1.4 % of the true hypervolume), duocylinder with its Clifford torus, Hopf fibration |
| Lifted 3D objects | spherinder (ball × interval), cubinder (cylinder × interval), torus prism, torus-knot prism |
| Spun 3D objects | a ball, a half-ball (which becomes the 4-ball), a cube and the humanoid, each swept about a plane |
| Smooth forms (SDF) | spheritorus, torisphere, tiger, ditorus and a blended creature, defined by signed distance fields |
| Figures | a mug and a humanoid, built from primitives and extruded along `w` |
| Imported | any .obj or .glb you drop on the page, lifted by extrusion or spin |

There is no canonical 4D version of a 3D object. The viewer offers two
explicit liftings: *extrusion*, which is exactly how a square becomes a cube
and a cube becomes a tesseract, and *spin*, the 4D solid of revolution, under
which a figure passes through our space as a pair of mirror twins. Smooth
forms are given as signed distance fields and sliced directly, or extracted
to a 4D surface by marching pentatopes for the projection view.

**Flatland mode** runs the whole viewer one dimension down: a 3D solid seen
by creatures living in a plane, with the same three views and the same known
answers (the cube's square-inside-a-square shadow, its point, triangle,
hexagon, triangle, point slice sequence). Watching the analogy run is the
best explainer of the 4D case.

**WebXR**: on a headset browser a VR button appears and the slice or
projection is placed in the room as a real object you can walk around.

## Try it

The viewer is published with GitHub Pages at
<https://jvalordv.github.io/4th-dimension/> on every push to the default
branch (`.github/workflows/pages.yml`). Pages must be enabled once in the
repository settings with source "GitHub Actions", and a private repository
needs a paid GitHub plan for Pages, otherwise make the repository public.

## Run it locally

```
npm install
npm run dev        # open the printed URL
npm test           # the math checks
npm run build      # static site in dist/
```

Keyboard: `space` play/pause, `1` `2` `3` view modes, `R` reset, `?` help, `Esc` closes help. The bar at the top switches between the 4D viewer and Flatland; `Import model` opens the drop zone.

## How the math is checked

The geometry library represents every solid by its boundary, a closed
3-manifold triangulated into tetrahedra with vertices in R⁴ (the 4D analogue
of a triangle mesh). One algorithm, marching tetrahedra, slices every shape.
Tests check, among other things:

- rotation matrices are special orthogonal, add angles in a plane, and
  commute exactly when their planes are disjoint;
- the six regular polytopes have the right vertex, edge, face and cell
  counts, satisfy Euler's relation, and have the known hypervolumes
  (tesseract 16, 16-cell 2/3, 24-cell 8);
- slices of the tesseract have the known volumes (a cube of volume 8, the
  central octahedron of volume 32/3, a prism of volume 8√2);
- every slice is a closed, consistently oriented surface;
- integrating slice volume along *any* direction gives the 4-volume
  (Cavalieri's principle), which ties the slicer to the shape data;
- the extruded cube is the tesseract, slice for slice.

The suite has two layers. `test/core` and `test/geometry` were written with
the code. `test/adversarial` was written afterwards by independent reviewers
working only from the spec, with the goal of breaking the implementation;
the defects they found (a cap-plane perturbation in the extrusion slicer for
nearly parallel hyperplanes, the stereographic pole landing at the origin,
trigonometric noise breaking watertightness on axis-aligned slices) are fixed
and their tests kept. The second round added spin lifting, signed distance
fields, Flatland and import, with their own spec sections and adversarial
suites; it also caught an error in the spec itself (a wrong volume for the
spheritorus), which is why the spec is tested too. Around 850 checks run in
about a minute.

See [`docs/MATH.md`](docs/MATH.md) for the definitions and the catalogue of
known answers, and `test/` for the checks.

## Layout

```
docs/MATH.md        the specification; code follows it
src/math/           vectors, 4×4 rotations, projections, hyperplanes
src/geometry/       tet complexes, slicer, polytopes, curved solids, lifting (extrude, spin), SDFs, isosurfaces
src/flat/           Flatland mode: the same ideas for 3D solids on a 2D canvas
src/render/         Three.js viewer, WebXR
src/app/            state, UI, shape registry, animation presets
src/explain/        three-tier explainers (plain words, some background, the math)
test/               unit tests and adversarial tests derived from the spec
```
