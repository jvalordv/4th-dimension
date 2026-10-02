# Mathematical Specification

This document is the source of truth for the geometry in this project. Every
module in `src/math` and `src/geometry` implements a definition from here, and
every test in `test/` checks a statement made here. If code and this document
disagree, the code is wrong.

Notation: vectors are columns, `·` is the dot product, `|v|` is the Euclidean
norm, `e_1..e_4` are the standard basis vectors of R^4, written as the axes
`x, y, z, w`. Indices in code are 0-based: x=0, y=1, z=2, w=3.

---

## 1. Points, vectors, matrices

A point of 4-space is `p = (x, y, z, w) ∈ R^4`. A `Vec4` is a tuple of four
numbers. A `Mat4` is a real 4×4 matrix stored row-major, `m[r*4 + c]`, and
acts linearly: `(M p)_r = Σ_c m[r*4+c] p_c`. These are plain linear maps, not
homogeneous-coordinate matrices; translation is handled separately as vector
addition.

## 2. Rotations of R^4

### 2.1 Plane rotations

In 3-space a rotation has an axis. In 4-space a rotation has an invariant
*plane*: the plane that turns, and the complementary plane that stays fixed.
There are six coordinate planes, hence six elementary rotations.

For a pair of axes `i < j`, the rotation by angle `θ` in the `(i, j)` plane is
the matrix `R_ij(θ)` equal to the identity except

```
R[i][i] =  cos θ     R[i][j] = -sin θ
R[j][i] =  sin θ     R[j][j] =  cos θ
```

Convention: positive `θ` turns `e_i` toward `e_j`, i.e.
`R_ij(θ) e_i = cos θ e_i + sin θ e_j`.

The six planes, in canonical order: `XY (0,1)`, `XZ (0,2)`, `XW (0,3)`,
`YZ (1,2)`, `YW (1,3)`, `ZW (2,3)`. The first, second and fourth are ordinary
3D rotations (about the z, y and x axes respectively). The three involving `w`
are the ones with no 3D counterpart.

Facts every implementation must satisfy:

- `R^T R = I` and `det R = +1` (rotations are special orthogonal).
- `R_ij(a) R_ij(b) = R_ij(a + b)`; `R_ij(0) = I`; `R_ij(θ)^{-1} = R_ij(-θ)`.
- `R_ij` leaves the complementary plane pointwise fixed: for `k ∉ {i, j}`,
  `R_ij(θ) e_k = e_k`.
- Rotations in disjoint planes commute: `XY` with `ZW`, `XZ` with `YW`,
  `XW` with `YZ`. Rotations in planes sharing an axis do not commute in
  general.

### 2.2 Composite rotation (UI convention)

The viewer exposes six angles `(θ_XY, θ_XZ, θ_XW, θ_YZ, θ_YW, θ_ZW)`. The
object's rotation is

```
M = R_ZW(θ_ZW) · R_YW(θ_YW) · R_YZ(θ_YZ) · R_XW(θ_XW) · R_XZ(θ_XZ) · R_XY(θ_XY)
```

so `XY` is applied first and `ZW` last. This is a convention, not a theorem;
it is fixed here so that saved scenes mean the same thing everywhere.

### 2.3 Double and isoclinic rotations

A *double rotation* turns two complementary planes at once, e.g.
`D(α, β) = R_XY(α) R_ZW(β)`. Unlike in 3D, a generic 4D rotation has no fixed
axis at all; it is a double rotation in some pair of planes.

When `|α| = |β|` the rotation is *isoclinic*: every nonzero vector `v` is
turned through the same angle, i.e. `v · D v = |v|^2 cos α` for all `v`. The
cases `β = α` and `β = -α` are the left and right isoclinic rotations; they
are the two families of Clifford translations of the 3-sphere.

## 3. Projection from R^4 to R^3

Projection is the first of two projections the viewer applies; the second,
from R^3 to the screen, is the ordinary 3D camera and is not part of this
specification.

### 3.1 Orthographic

Drop `w`: `(x, y, z, w) ↦ (x, y, z)`.

### 3.2 Perspective

Eye at `(0, 0, 0, d)` with `d > 0`, image hyperplane `w = 0`. The ray from the
eye through `p` meets the image hyperplane at

```
P_d(x, y, z, w) = (x, y, z) · d / (d - w),      valid for w < d.
```

Points nearer the eye (larger `w`) appear larger. For the tesseract
`[-1, 1]^4` with `d = 3`, the cell at `w = +1` is drawn at scale `3/2` and the
cell at `w = -1` at scale `3/4`; the familiar "cube inside a cube" is the
`w = -1` cube inside the `w = +1` cube. Implementations must document how they
treat `w ≥ d` (clamp the denominator to a small positive value).

### 3.3 Stereographic (for the 3-sphere)

For a point on the unit 3-sphere `S^3 = { |p| = 1 }`, projection from the pole
`(0, 0, 0, 1)` onto the hyperplane `w = 0`:

```
S(x, y, z, w) = (x, y, z) / (1 - w).
```

It is conformal and sends circles on `S^3` to circles or lines in `R^3`. Used
for the Clifford torus and the Hopf fibration, which live on `S^3`.

## 4. Hyperplanes and the chart of a slice

A hyperplane is `H(n, c) = { p ∈ R^4 : n · p = c }` with `|n| = 1`. The signed
distance of `p` from `H` is `s(p) = n · p - c`.

To draw what lies in `H` we need 3D coordinates on it. Choose an orthonormal
basis `(u_1, u_2, u_3)` of `n^⊥` such that the 4×4 matrix with columns
`(u_1, u_2, u_3, n)` has determinant `+1`. The *chart* is

```
chart(p) = (u_1 · p, u_2 · p, u_3 · p) ∈ R^3,
```

an isometry from `H` onto `R^3` (the `c n` component of `p` is killed because
`u_k ⊥ n`). Requirement: for the default hyperplane `n = e_w` the basis must
be exactly `(e_x, e_y, e_z)`, so that slicing at `w = c` shows the object's
own `x, y, z` coordinates unchanged. The basis must depend continuously on `n`
in a neighbourhood of `e_w`.

The viewer rotates the object by `M` and always slices with `n = e_w`. This is
equivalent to slicing the unrotated object with `n = M^T e_w`, so the general
machinery is only needed in tests and in library use.

## 5. Shapes as tetrahedral boundary complexes

A 4D solid is represented by its boundary, a closed 3-manifold, triangulated
into tetrahedra ("tets") with vertices in R^4. This is the 4D analogue of a
triangle mesh. It covers every polytope exactly and every curved solid to any
desired accuracy, and it slices with one uniform algorithm (section 6).

### 5.1 Orientation and the 4D cross product

For `u, v, w ∈ R^4` define `cross4(u, v, w) ∈ R^4` by

```
cross4(u, v, w)_i = det [ e_i ; u ; v ; w ]       (rows)
```

equivalently `cross4(u, v, w) · y = det [ y ; u ; v ; w ]` for all `y`. It is
orthogonal to `u, v, w`, and `(cross4, u, v, w)` is a positively oriented
basis whenever it is a basis. This is the exact analogue of
`cross(u, v)_i = det [ e_i ; u ; v ]` in R^3.

A boundary tet `(a, b, c, d)` is *outward oriented* when
`N = cross4(b - a, c - a, d - a)` points out of the solid. All tet lists in
this project are outward oriented. For a star-shaped solid with interior point
`o`, outwardness means `N · (a - o) > 0`.

### 5.2 Validity

A tet list is valid when

- every triangular face (unordered vertex triple) belongs to exactly two tets
  (the boundary is closed);
- adjacent tets induce opposite orientations on their shared face (the
  boundary is consistently oriented);
- no tet is degenerate beyond tolerance, except where a construction
  deliberately produces zero-volume tets (documented per shape).

### 5.3 Combinatorial structure for drawing

For projection we draw a polytope's true edges and 2-faces, not the tets. A
`Polytope4` therefore also carries `vertices`, `edges` (index pairs), `faces`
(index cycles) and `cells` (lists of face indices). For a convex 4-polytope
the Euler relation `V - E + F - C = 0` must hold.

## 6. Slicing: marching tetrahedra

Input: a tet complex, a hyperplane `H(n, c)`. Output: a triangle mesh in chart
coordinates, outward oriented.

For each tet, compute `s_k = n · p_k - c` for its four vertices. Classify each
vertex as *positive* if `s_k ≥ 0`, otherwise *negative*. Treating zero as
positive is a symbolic perturbation: every vertex falls in exactly one class,
so the output is watertight even when vertices lie exactly on `H`; the price
is occasional zero-area triangles, which are harmless.

An edge `(p, q)` crosses `H` iff its endpoints are in different classes. The
crossing point is `p + t (q - p)` with `t = s_p / (s_p - s_q)`, `t ∈ [0, 1]`.

Cases by the number of positive vertices:

- 0 or 4: no output.
- 1 or 3: three crossing edges, one triangle.
- 2: positives `{a, b}`, negatives `{c, d}`. The four crossing points lie on
  edges `ac, ad, bd, bc`, and that is their cyclic order (consecutive edges
  share a vertex). Emit triangles `(ac, ad, bd)` and `(ac, bd, bc)`.

Orientation: the tet's outward normal `N ∈ R^4` projects into `H` as
`N_H = N - (N · n) n`; in chart coordinates `N_3 = chart(N_H)`. Orient each
output triangle so that `cross(v_1 - v_0, v_2 - v_0) · N_3 > 0`. `N_H` is zero
only when the tet is parallel to `H`, in which case its slice is degenerate
and may be dropped.

Consequences that tests must check:

- The slice of a valid tet complex is a closed, consistently oriented
  triangle mesh (every edge in exactly two triangles, opposite directions),
  after discarding zero-area triangles and merging coincident vertices.
- Its signed volume (divergence theorem, `V = Σ (v_0 · (v_1 × v_2)) / 6`) is
  positive.

## 7. Hypervolume and the slice integral

For a star-shaped solid with interior point `o`, the 4-volume is the sum over
boundary tets of cone volumes:

```
vol_4 = Σ_tets  | det [ a - o ; b - o ; c - o ; d - o ] | / 24 .
```

For any unit `n`, the slice volume `A(c)` as a function of offset satisfies
`∫ A(c) dc = vol_4` (Cavalieri). This is a strong, direction-independent
consistency check between the slicer and the tet complex; tests integrate
`A(c)` numerically along several random directions and compare.

## 8. Catalogue of shapes with known answers

All regular polytopes below are centred at the origin.

| Shape | Vertices | V | E | F | C | Cell | 4-volume |
|---|---|---|---|---|---|---|---|
| 5-cell | see 8.1 | 5 | 10 | 10 | 5 | tetrahedron | `√5/96 · a^4` |
| Tesseract | `(±1, ±1, ±1, ±1)` | 16 | 32 | 24 | 8 | cube | 16 |
| 16-cell | `±e_i` | 8 | 24 | 32 | 16 | tetrahedron | 2/3 |
| 24-cell | perms of `(±1, ±1, 0, 0)` | 24 | 96 | 96 | 24 | octahedron | 8 |
| 600-cell | see 8.2 | 120 | 720 | 1200 | 600 | tetrahedron | see 8.2 |
| 120-cell | see 8.2 | 600 | 1200 | 720 | 120 | dodecahedron | see 8.2 |

`a` is the edge length. Euler: `V - E + F - C = 0` for all six.

### 8.1 5-cell

Vertices `(1,1,1,-1/√5)`, `(1,-1,-1,-1/√5)`, `(-1,1,-1,-1/√5)`,
`(-1,-1,1,-1/√5)`, `(0,0,0,4/√5)`. Every pair is at distance `a = 2√2`;
circumradius `4/√5`; centroid at the origin.

### 8.2 600-cell and 120-cell

600-cell vertices on the unit 3-sphere, with `φ = (1 + √5)/2`:

- 8 of the form `(±1, 0, 0, 0)` and permutations;
- 16 of the form `(±1/2, ±1/2, ±1/2, ±1/2)`;
- 96 *even* permutations of `(±φ/2, ±1/2, ±1/(2φ), 0)`.

Edge length `a = 1/φ`. Edges join vertices at distance `1/φ`; each vertex has
12 neighbours; cells are the 600 4-cliques of the edge graph. The 120-cell is
its dual: 600 vertices at the normalised centroids of the 600-cell's cells,
120 dodecahedral cells each consisting of the 20 cell-centroids around a
600-cell vertex. Hypervolumes are not asserted as closed forms here; they are
checked by the slice integral (section 7) and by lying between the volumes of
the inscribed and circumscribed 4-balls.

### 8.3 Cells of each polytope

Cells are facets: the vertex set of a cell is the set of vertices maximising
`ν · v` over a facet normal `ν`. Facet normals (up to scale):

- Tesseract: `±e_i` (8).
- 16-cell: `(±1, ±1, ±1, ±1)` (16).
- 24-cell: `±e_i` and `(±1, ±1, ±1, ±1)` (24).
- 5-cell: `-v_k` for each vertex `v_k` (5).
- 600-cell: centroids of its 4-cliques (600).
- 120-cell: the 600-cell's vertices (120).

Within a cell, faces are the facets of the cell's own 3D convex hull.

### 8.4 Slices of the tesseract `[-1, 1]^4`

- `n = e_w`, any `|c| < 1`: a cube of side 2, volume 8.
- `n = (1,1,1,1)/2`, `c = 0`: the regular octahedron with vertices the six
  permutations of `(1, 1, -1, -1)`; edge `2√2`, circumradius 2, volume `32/3`.
- `n = (1,1,1,1)/2`, `c = ±2`: a single vertex. Moving `c` from `-2` to `2` the
  slice goes point, tetrahedron, truncated tetrahedron, octahedron, and back.
- `n = (1,1,0,0)/√2`, `c = 0`: a square prism with volume `8√2`
  (a `2×2` square extruded along the diagonal of a `2×2` square).
- Integral of slice volume over `c` is 16 for every `n`.

### 8.5 4-ball of radius R

Boundary `S^3` is tessellated by recursive midpoint subdivision of the
16-cell's 16 tets (or the 600-cell's 600), projecting new vertices onto the
sphere. Known values: `vol_4 = π^2 R^4 / 2`; slice at offset `c` is a ball of
radius `√(R^2 - c^2)`, volume `(4/3) π (R^2 - c^2)^{3/2}`. Discrete versions
must converge to these with refinement; tests assert a tolerance appropriate
to the subdivision level and document it.

### 8.6 Duocylinder and Clifford torus

Duocylinder of radii `r_1, r_2`: `{ x^2 + y^2 ≤ r_1^2, z^2 + w^2 ≤ r_2^2 }`,
4-volume `π^2 r_1^2 r_2^2`. Its boundary is two solid tori glued along the
Clifford torus `{ x^2+y^2 = r_1^2, z^2+w^2 = r_2^2 }`, parametrised by
`(r_1 cos α, r_1 sin α, r_2 cos β, r_2 sin β)`. With `r_1 = r_2 = 1/√2` it
lies on the unit 3-sphere and its stereographic image is a round torus.

Slice at `n = e_w`: `z^2 ≤ r_2^2 - c^2` and `x^2 + y^2 ≤ r_1^2`, a cylinder of
radius `r_1` and height `2√(r_2^2 - c^2)`.

## 9. Lifting 3D solids into 4D

There is no canonical 4D version of a 3D object. The project offers explicit,
named liftings. Each takes a closed, consistently oriented (counter-clockwise
seen from outside) triangle mesh `M` bounding a solid `S ⊂ R^3`.

### 9.1 Extrusion (prism)

`P = S × [-h, h]`. This is how a square becomes a cube and a cube becomes a
tesseract; `extrude(cube) = tesseract` exactly.

Boundary of `P`:

- *lateral*: `M × [-h, h]`, one triangular prism per triangle of `M`, each
  split into three tets with outward orientation derived from `M`'s;
- *caps*: `S × {-h}` and `S × {+h}`, solid copies of `S`.

Projection structure: vertices `(v, -h)` and `(v, +h)`; edges of `M` at both
levels plus one edge per vertex joining the levels; faces: triangles of `M` at
both levels plus one quad per edge of `M`.

Slicing by `H(n, c)`: the lateral part slices by marching tets. A cap at
`w = w_0 ∈ {-h, +h}` meets `H` where `n_xyz · q = c - n_w w_0`, a *plane* in
R^3; its slice is the planar section of `S` by that plane, lifted by
`q ↦ (q, w_0)` and mapped through the chart. Planar sections of `S` are
computed by intersecting each triangle of `M` with the plane, chaining the
resulting segments into closed loops by shared mesh edge (not by coordinate
matching), classifying loops as outer or hole by nesting parity, and
triangulating with an ear-clipping routine that supports holes. Cap
orientation follows the 4D outward normal `±e_w` projected into `H`.

Geometric fact worth an explainer: when `n_w ≠ 0` the whole slice is an
affine image of `S` clipped between two parallel planes. A tilted hyperplane
through an extruded object shows a sheared slab of the original.

### 9.2 Spin (rotation about a plane)

For `S` in the half-space `z ≥ 0`, `spin(S) = { (x, y, z cos φ, z sin φ) }`.
A disc spun about a line is a ball; a half-ball spun about a plane is a
4-ball; a ball with `z > 0` spun this way is the 4D analogue of a torus. Not
in the first build; the interface must leave room for it.

### 9.3 Signed distance fields

A solid may also be given as `f : R^4 → R` with `f ≤ 0` inside. Slicing is
marching cubes on `g(a, b, d) = f(c n + a u_1 + b u_2 + d u_3)`. Not in the
first build; the `Shape4` interface admits an implementation that provides a
slice without a tet complex.

## 10. Colour encoding

Colour is data, not decoration. In the projection view each vertex is coloured
by its `w` coordinate after rotation and before projection, so depth along the
invisible axis is readable. In the slice view each slice vertex is coloured by
the `w` coordinate of the corresponding 4D point *before* rotation, i.e. where
in the object's own fourth direction the visible material came from. The map
from `w` to colour is a fixed two-ended gradient with `w = 0` at the midpoint
and the object's `w` extent at the ends.
