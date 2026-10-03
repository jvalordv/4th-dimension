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

In 3-space a rotation has an axis. In 4-space a *simple* rotation has an
invariant *plane*: the plane that turns, and the complementary plane that
stays pointwise fixed (a general 4D rotation turns two complementary planes
at once and fixes no plane, section 2.3). There are six coordinate planes,
hence six elementary simple rotations.

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
3D rotations, about the z, y and x axes respectively, but note the sense:
`XY` and `YZ` coincide with the right-handed rotations about `+z` and `+x`,
whereas `XZ(θ)` turns `e_x` toward `e_z`, which is the right-handed rotation
about `-y`. In the usual 3D convention `R_y(φ) e_x = cos φ e_x - sin φ e_z`,
so `R_XZ(θ) = R_y(-θ)`; a reader comparing with a textbook matrix about `y`
must flip the sign. The three involving `w` are the ones with no 3D
counterpart.

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
this project are outward oriented. For a solid that is star-shaped *with
respect to* `o` (`o` in its kernel: every boundary point is visible from `o`),
outwardness means `N · (a - o) > 0`. For an interior `o` outside the kernel
the test flips the wrong tets. Any interior point of a convex solid is in the
kernel, which covers every shape in section 8.

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
is occasional zero-area triangles, which are harmless. The convention is
equivalent to slicing at `c - ε`, so the output at an offset where a whole
cell lies in `H` is the limit from below: for the tesseract `[-1, 1]^4`, the
slice at `w = +1` is the cube and the slice at `w = -1` is empty.

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

- At every offset where the slice has positive volume, the slice of a valid
  tet complex is a closed, consistently oriented triangle mesh (every edge in
  exactly two triangles, opposite directions), after discarding zero-area
  triangles and merging coincident vertices. At a generic offset (no vertex
  in `H`) no cleaning is needed. For a convex solid this is every offset
  except the supporting ones described below.
- Its signed volume (divergence theorem, `V = Σ (v_0 · (v_1 × v_2)) / 6`) is
  then positive.

Degenerate offsets. Because the output is the limit from below, a hyperplane
that supports the solid from above (`c = max n · p` over the solid) gives a
zero-volume slice unless a whole cell lies in `H`:

- `H` touches a vertex or an edge: every emitted triangle is zero-area and the
  cleaned output is empty (the 4-ball of §8.5 at `c = R`).
- `H` contains a 2-face `F`: `F` is emitted *twice*, once by each tet adjacent
  to it, with opposite orientations and nonzero area. The cleaned output is a
  doubled flat polygon with every interior edge in four triangles, volume 0,
  and it is *not* closed in the sense above. Examples: the tesseract with
  `n = (0,0,1,1)/√2, c = √2` (the square `z = w = 1`), and the discretised
  duocylinder of §8.6 at `w = r_2` when its polygon `P_2` has a vertex at
  `(0, r_2)` (the disc `P_1 × {(0, r_2)}`).

In general a 2-face of the complex lying in `H` is emitted twice exactly when
both tets adjacent to it have their fourth vertex on the negative side (the
solid is locally below `H` there) and once otherwise; for a convex solid the
former happens only at a supporting offset. The slicer does not cancel such
coincident pairs. Tests check closedness at positive-volume offsets only, and
may check the zero-volume behaviour at supporting offsets.

## 7. Hypervolume and the slice integral

For a solid star-shaped with respect to an interior point `o` (`o` in the
kernel, as in 5.1; any interior point for a convex solid), the 4-volume is the
sum over boundary tets of cone volumes:

```
vol_4 = Σ_tets  | det [ a - o ; b - o ; c - o ; d - o ] | / 24 .
```

The signed sum without absolute values,

```
vol_4 = Σ_tets  det [ a - o ; b - o ; c - o ; d - o ] / 24 ,
```

is the 4D divergence theorem and holds for *every* closed, outward-oriented
tet complex, star-shaped or not, with any reference point `o` (a solid with a
hole, such as a spun ball of section 9.2, is not star-shaped about the
origin; this form still gives its 4-volume). The two agree exactly when the
cone form is valid.

For any unit `n`, the slice volume `A(c)` as a function of offset satisfies
`∫ A(c) dc = vol_4` (Cavalieri). This is a strong, direction-independent
consistency check between the slicer and the tet complex; tests integrate
`A(c)` numerically along several random directions and compare. If `o` were
outside the kernel, overlapping cones would be counted with absolute value
and the sum would overestimate `vol_4`.

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

For a solid `S ⊂ R^3` lying in the half-space `z ≥ 0`,

```
spin(S) = { (x, y, z cos φ, z sin φ) : (x, y, z) ∈ S, φ ∈ [0, 2π) }.
```

`S` is swept about the plane `z = 0`, which becomes the `zw`-plane's origin:
the 4D analogue of a solid of revolution. One dimension down, a half-disc
spun about its diameter is a ball. Here a half-ball spun about its equatorial
plane is a 4-ball, a ball lying in `z > 0` spun this way is a ball swept
round a circle, the *torisphere* of section 9.3 (`S^1 × B^3`, boundary
`S^2 × S^1`, the 4D analogue of a solid torus), and a cube in `z > 0` becomes
a solid ring with square cross-section.

A solid that crosses `z = 0` is first clipped to `z ≥ 0` (section 9.4), so
that the spun solid is well defined; the viewer says so.

Boundary. Let `M` be `S`'s boundary mesh and `F ⊂ M` the part lying in the
plane `z = 0`. Points of `F` are fixed by the spin and land in the interior
of `spin(S)`, so the boundary of `spin(S)` is the spin of `M \ F`: every
triangle of `M` with at least one vertex at `z > 0`.

Discretisation with `N` steps `φ_k = 2πk/N`: vertex `(x, y, z)` maps to
`v_k = (x, y, z cos φ_k, z sin φ_k)`; a vertex with `z = 0` maps to the
single point `(x, y, 0, 0)` for every `k`. Each triangle `(a, b, c)` of
`M \ F` and each step `k` gives the prism `(a_k, b_k, c_k, a_{k+1}, b_{k+1},
c_{k+1})`, split into three tets with a consistent diagonal rule. The lateral
quads of the prism are planar trapezoids (`a_k a_{k+1}` and `b_k b_{k+1}` are
both parallel to `(0, 0, cos φ_k − cos φ_{k+1}, sin φ_k − sin φ_{k+1})`), so
the split is exact. A prism with a vertex at `z = 0` collapses into a pyramid
and yields tets with repeated vertices; those are dropped and the remaining
tets still close up.

Orientation: the outward 4D normal of a lateral tet at step `k` is
positively proportional to `(n_x, n_y, (n_z / cos(π/N)) cos φ_mid,
(n_z / cos(π/N)) sin φ_mid)` with `φ_mid` the step's middle angle; its dot
product with the spun triangle normal `(n_x, n_y, n_z cos φ_mid, n_z sin
φ_mid)` is `n_x^2 + n_y^2 + n_z^2 / cos(π/N) > 0`, so testing the sign of
`cross4` of the tet's edges against the spun normal is exact. Tets are
oriented by that test (swap two vertices when the sign is wrong).

Known answers (Pappus): the 4-volume of the swept solid equals the 3-volume
of `S` times the length of the circle traced by its centroid,

```
vol_4(spin(S)) = 2π · z̄ · vol_3(S) = 2π ∫_S z dV ,
```

and the discrete construction gives exactly `(N/(2π)) sin(2π/N)` times that,
because each point sweeps an `N`-gon of circumradius `z` (area
`(N/2) z^2 sin(2π/N)`) instead of a circle. Tests assert the discrete value
to round-off and the continuum value within the polygon factor. For a ball
of radius `r` centred at height `z_0 > r`: `vol_4 = 2π z_0 · (4/3)π r^3` (the
torisphere volume of section 9.3);
for the half-ball `{|p| ≤ R, z ≥ 0}`: `2π · (3R/8) · (2/3)π R^3 = π^2 R^4/2`,
the 4-ball, whose slices and hypervolume must then match section 8.5.

Slices of a spun solid by `w = c`: a point `(x, y, z)` is in the slice iff
`(x, y, √(z^2 + c^2)) ∈ S`. At `c = 0` the slice is `S` together with its
mirror image in `z = 0`: a spun figure passes through our space as a pair of
mirror twins that approach each other and vanish once `|c|` exceeds the
figure's greatest height. For the spun ball (radius `r` at height `z_0`) the
slice at `|c| < z_0 − r` is two balls of radius `r` at heights
`±√(z_0^2 − c^2)` up to the distortion of `√(z^2 + c^2)`, and the slice
4-volume integral along `e_w` recovers the Pappus value.

### 9.3 Signed distance fields

A solid may also be given implicitly by `f : R^4 → R`, `f ≤ 0` inside, `f`
Lipschitz with constant 1 (a *signed distance field*, SDF) or at least a
bound on the distance to the surface. Primitives, all centred at the origin
unless translated (`|·|` is the Euclidean norm):

| Primitive | `f(p)` | 4-volume |
|---|---|---|
| 4-ball radius `r` | `|p| − r` | `π^2 r^4 / 2` |
| 4-box half-sizes `h` | `q_i = |p_i| − h_i`; `f = |max(q, 0)| + min(max_i q_i, 0)` | `16 h_1 h_2 h_3 h_4` |
| capsule, segment `ab`, radius `r` | `|p − a − t(b − a)| − r`, `t = clamp((p−a)·(b−a)/|b−a|^2, 0, 1)` | ball + cylinder |
| duocylinder `r_1, r_2` | `max(√(x²+y²) − r_1, √(z²+w²) − r_2)` (a bound, exact on the two tori) | `π^2 r_1^2 r_2^2` |
| spheritorus `R, r` | `√((√(x²+y²+z²) − R)^2 + w^2) − r` | `4π^2 R^2 r^2 + π^2 r^4` |
| torisphere `R, r` | `√((√(x²+y²) − R)^2 + z^2 + w^2) − r` | `2πR · (4/3)π r^3` |
| tiger `R_1, R_2, r` | `√((√(x²+y²) − R_1)^2 + (√(z²+w²) − R_2)^2) − r` | `4π^3 R_1 R_2 r^2` |
| ditorus `R_1, R_2, r` | `√((√((√(x²+y²) − R_1)^2 + z^2) − R_2)^2 + w^2) − r` | `2πR_1 · 2πR_2 · π r^2` |

The volumes: the *torisphere* is the set of points within `r` of a circle
of radius `R`, a 3-ball swept around the circle (Pappus, `S^1 × B^3`); it is
the spun ball of section 9.2 turned by `R_YW(π/2) R_XZ(π/2)`, which swaps
the `xy` and `zw` circles. The *spheritorus* is the set within `r` of the
2-sphere of radius `R` in `w = 0`, a 2-disc bundle over the sphere
(`S^2 × D^2`): its slice at `w = c` is the spherical shell `R − a ≤ |q| ≤
R + a`, `a = √(r^2 − c^2)`, of volume `8πR^2 a + (8π/3) a^3`, and
integrating over `c` gives `4π^2 R^2 r^2 + π^2 r^4`. The two share the
boundary type `S^2 × S^1` but are different solids (one is simply connected,
the other is not). The tiger is the set within `r` of the flat Clifford torus
(area `4π^2 R_1 R_2`, normal disc of area `π r^2`, exact because the torus is
flat and `r < min(R_1, R_2)`); at `w = 0` its slice is two coaxial solid
tori at heights `±R_2`, which touch at `|c| = R_2 − r`, fuse, and vanish
beyond `R_2 + r`. The ditorus is a circle swept twice. These hold when `r` is
small enough that the normal discs do not overlap (`r < R` for the
torus-like ones).

Operations: union `min(f, g)`, intersection `max(f, g)`, difference
`max(f, −g)`, smooth union `smin_k(f, g) = min(f, g) − h^2 / (4k)` with
`h = max(k − |f − g|, 0)` (the polynomial smooth minimum; a bound, not a
distance), translation `f(p − t)`, rotation `f(M^T p)` for a rotation `M`
(so the shape rotates by `M`), uniform scale `s · f(p / s)`. Unions and
smooth unions of primitives give the blended "creatures" the viewer offers.

Slicing (direct). On the hyperplane `H(n, c)` with chart basis `u_k`, define
`g(q) = f(c n + q_1 u_1 + q_2 u_2 + q_3 u_3)` on a grid over
`[−R, R]^3`, where `R` bounds the solid. Extract the zero level set of `g` by
marching tetrahedra on the grid: each cube is split into six tets (the
Kuhn/Freudenthal split along the main diagonal), each tet is classified by
the signs of `g` at its corners exactly as in section 6 (zero counts as
positive), crossing points are placed by linear interpolation, and each
output triangle is oriented so that its normal points toward the positive
(outside) corners. The result converges to the true slice as the grid is
refined; tests compare slice volumes against the table (the 4-ball slice
`(4/3)π(r^2 − c^2)^{3/2}`, the Cavalieri integral of each primitive against
its 4-volume) with tolerances tied to the grid spacing.

Extraction to a tet complex (marching pentatopes). The zero set of `f` in
`R^4` is a closed 3-manifold. On a 4D grid over `[−R, R]^4`, split each
hypercube into `4! = 24` pentatopes (4-simplices) by the Freudenthal rule
(the simplices are the chains `p ≤ p + e_{σ(1)} ≤ ... ≤ p + e_{σ(1)} + ... +
e_{σ(4)}` over permutations `σ`), classify the five corners by sign, and
emit: nothing for 0 or 5 positive corners; one tet (the four crossing points)
for 1 or 4; a triangular prism (six crossing points, split into three tets)
for 2 or 3. For positives `{a, b}` and negatives `{c, d, e}` the two
triangles of the prism are `(ac, ad, ae)` and `(bc, bd, be)`, joined along
corresponding vertices. Orient each tet outward by the rule of section 6
lifted one dimension: `cross4` of its edges must point toward the positive
corners. The result is a valid tet complex (section 5.2) and feeds the same
slicer, hypervolume and wire machinery as every other shape; its signed
hypervolume converges to the table values with refinement, and slicing it
must agree with the direct slice above to within both discretisations.

Projection view for an SDF shape draws the vertices and edges of its
extracted complex, coloured by `w` like any wire.

### 9.4 Clipping a 3D solid by a plane

`clip(S, m, k) = S ∩ { q : m · q ≥ k }`. Triangles of `M` are classified by
the signs of `m · v − k` at their vertices (zero positive, as in section 6);
a triangle with mixed signs is cut into the part on the positive side (one
triangle or a quad split in two), with crossing points on edges identified by
edge so that neighbours share them exactly. Vertices within `10^{-9}` of the
mesh extent from the plane are snapped onto it (and so count as positive);
without that, a plane within rounding of a vertex scatters crossing points
that cannot be triangulated reliably. The cut is closed by the planar
section of `S` by the plane (section 9.1's section machinery), oriented with
normal `−m`. As in section 6, the result is the limit from the removed side:
a plane touching only a vertex or an edge removes everything, and a plane
containing a face with the solid behind it leaves a doubled flat polygon of
volume 0. Otherwise the result is a closed, consistently oriented mesh whose volume
is `vol_3(S)` minus the removed part; for the ball `|p| ≤ R` clipped by
`z ≥ 0` the volume is `(2/3)π R^3` and for the box `[−1, 1]^3` clipped by
`z ≥ 0` it is 4.

## 10. Colour encoding

Colour is data, not decoration. In the projection view each vertex is coloured
by its `w` coordinate after rotation and before projection, so depth along the
invisible axis is readable. In the slice view each slice vertex is coloured by
the `w` coordinate of the corresponding 4D point *before* rotation, i.e. where
in the object's own fourth direction the visible material came from. The map
from `w` to colour is a fixed two-ended gradient with `w = 0` at the midpoint;
the two views use different ends:

- Slice view: the ends are the object's own `w` extent `[w_min, w_max]`
  (`wRange`), each side scaled by its own extent so that `w = 0` stays at the
  midpoint and both extremes of the object reach the gradient ends (for the
  5-cell, `w ∈ [-1/√5, 4/√5]`).
- Projection view: the ends are `±R`, where `R` is the radius of an
  origin-centred ball containing the object (`radius`). After any rotation
  `|w| ≤ |p| ≤ R`, so `±R` is the extent `w` can reach under rotation, and the
  colours do not rescale as the object turns; a vertex reaches a gradient end
  exactly when it is rotated onto `±R e_w`.

The two scales differ: for the tesseract `R = 2` while its own `w` extent is
`[-1, 1]`, so at zero rotation its vertices sit at `t = 1/4` and `3/4` in the
projection view but at the ends in the slice view, and in the overlay the
same material is coloured differently by the two layers. The legend
therefore shows one row per view with its own end values.

## 11. Flatland mode: everything one dimension down

The same constructions with `R^3` in place of `R^4` and `R^2` in place of
`R^3`, so that the analogy the explainers lean on can be *watched* rather
than described. A 3D solid is the "higher-dimensional object"; its boundary
mesh plays the role of the tet complex; Flatland is the plane `z = 0`.

- Rotation planes: `XY` (the only rotation Flatlanders have), `XZ` and `YZ`
  (the two that turn the object partly out of their world; the analogues of
  `XW, YW, ZW`). Matrices as in section 2.1 restricted to `R^3`; `XZ(θ)`
  turns `e_x` toward `e_z`.
- Projection to the plane: orthographic `(x, y, z) ↦ (x, y)`; perspective
  from an eye at `(0, 0, d)`: `(x, y) · d / (d − z)`. The cube `[−1, 1]^3`
  from `d = 3` is the square-inside-a-square, scales `3/2` and `3/4`, the
  analogue of section 3.2.
- Slicing: the plane `{ q : m · q = k }`, `|m| = 1`, with a 2D chart basis
  `(u_1, u_2)` of `m^⊥`, `det(u_1, u_2, m) = +1`, equal to `(e_x, e_y)` when
  `m = e_z`. The slice of a closed mesh is the planar section of section 9.1
  (segments chained by edge into loops, holes by nesting parity), drawn as
  filled polygons, oriented counter-clockwise for outer loops.
- Colour encodes `z`, exactly as `w` in section 10.
- Known answers: the cube `[−1, 1]^3` sliced by `z = c`, `|c| < 1`, is a
  square of area 4; by the plane `(1,1,1)/√3` through the origin, a regular
  hexagon with vertices at the six edge midpoints, side `√2`, area `3√3`;
  moving that plane from one corner to the opposite one gives point,
  triangle, hexagon, triangle, point, the analogue of section 8.4. The ball
  of radius `R` gives discs of area `π(R^2 − c^2)`. The integral of slice
  area over the offset is the 3-volume, Cavalieri one dimension down.

## 12. Imported 3D models

A model arrives as triangles (OBJ or glTF/GLB). It is welded by position,
re-centred at its bounding-box centre and scaled so its bounding radius is 1,
then validated: every edge must belong to exactly two triangles with
opposite directions (section 9.1's requirement). A closed model may be lifted
by extrusion (9.1) or spin (9.2, after clipping). An open model can still be
projected (the lateral structure of 9.1 needs no caps) and sliced without
caps, and the viewer must say that its slices are then open surfaces. If the
signed volume of a closed model is negative its triangles are reversed, so
that outward orientation holds; for an open model the same rule is applied
as a heuristic (the flux through a nearly closed surface), since the
viewer's slice material is lit from the front. A WebXR session adds no
mathematics: the drawn slice or projection is placed in the room by a rigid
motion and a uniform scale.

