/**
 * Explainer content: three tiers of HTML for every topic the viewer can show.
 * docs/MATH.md is the source of truth; HTML comments cite its sections
 * (`<!-- MATH.md §3.2 -->`). Fragments use simple elements only (h3, p, ul,
 * li, code, em, strong) and are trusted: they are authored here, not taken
 * from users. Formulas are plain text inside <code>, following MATH.md's
 * conventions: positive θ turns e_i toward e_j (§2.1), the composite order of
 * §2.2, perspective (x, y, z)·d/(d − w) (§3.2), the chart of §4, the
 * limit-from-below slicing convention of §6 and the colour encoding of §10.
 */
import type { Explainer, Tier } from './index';
import type { Axis, RotationPlane } from '../math/types';
import { isHyperPlane, PLANE_AXES, ROTATION_PLANES } from '../math/rotation';
import { SHAPE_IDS } from '../app/registry';

type BestView = 'projection' | 'slice' | 'overlay';

interface TopicSpec {
  id: string;
  title: string;
  eli5: string;
  intermediate: string;
  math: string;
}

interface ShapeSpec extends TopicSpec {
  /** View that shows the described feature best; rendered as a closing note. */
  view: BestView;
  /** Why that view, one clause. */
  viewNote: string;
}

const tiersOf = (spec: TopicSpec, suffix = ''): Record<Tier, string> => ({
  eli5: spec.eli5 + suffix,
  intermediate: spec.intermediate + suffix,
  math: spec.math + suffix,
});

const topic = (spec: TopicSpec): Explainer => ({ id: spec.id, title: spec.title, tiers: tiersOf(spec) });

/** A shape topic: every tier ends with the one-line "best view" note. */
const shapeTopic = (spec: ShapeSpec): Explainer => {
  const note = `<p class="explainer-view-note">Best seen in the <strong>${spec.view}</strong> view: ${spec.viewNote}</p>`;
  return { id: spec.id, title: spec.title, tiers: tiersOf(spec, note) };
};

// ---- Intro -----------------------------------------------------------------

const intro = topic({
  id: 'intro',
  title: 'Seeing the fourth dimension',
  eli5: `
<p>Imagine flat creatures living on a sheet of paper. They can move left, right, forward and back, but "up" means nothing to them. If you pushed a ball through their sheet, they would see a dot appear, grow into a circle, shrink, and vanish. If you held a wire cube above the sheet with a lamp, they would see its shadow: a square inside a square.</p>
<p>We are in the same position with four-dimensional objects. We cannot see the fourth direction, so this viewer shows 4D things the two honest ways the flat creatures could see 3D things: as <strong>shadows</strong> (the projection view) and as <strong>slices</strong> (the slice view). The overlay view draws both at once.</p>
<p>Colour is the clue to the hidden direction: blue means "behind our space", white means "right here", orange-red means "ahead". Pick a shape, drag the sliders, and this panel follows whatever you touch. The three buttons above change how much background the explanation assumes.</p> <!-- MATH.md §3, §4, §10 -->`,
  intermediate: `
<p>A point of 4-space has four coordinates <code>(x, y, z, w)</code>. The viewer rotates the object in 4D and then shows it in 3D in one of two ways. <strong>Projection</strong> drops one dimension the way a camera does, either orthographically (just forget <code>w</code>) or in perspective from an eye on the <code>w</code> axis, so parts with larger <code>w</code> are drawn larger. <strong>Slicing</strong> intersects the object with our own 3-space, the hyperplane <code>w = c</code>; sliding <code>c</code> moves the object through. <!-- MATH.md §3, §4 --></p>
<p>Rotation in 4D happens in six coordinate planes, not about three axes. <code>XY</code>, <code>XZ</code> and <code>YZ</code> are the ordinary 3D rotations; <code>XW</code>, <code>YW</code> and <code>ZW</code> turn the object partly out of our space and produce the inside-out morphing that makes 4D animations look strange. <!-- MATH.md §2.1 --></p>
<p>Colour encodes <code>w</code>: in the projection view the <code>w</code> of each point after rotation (depth along the invisible axis), in the slice view the <code>w</code> the visible material came from inside the object. <!-- MATH.md §10 --></p>
<p>Good first experiments: the tesseract with the <em>pass-through</em> preset in the slice view, then the <code>XW</code> slider, then the hypersphere.</p>`,
  math: `
<p>Points are <code>p ∈ R^4</code>; rotations are the special orthogonal matrices <code>R</code> with <code>R^T R = I</code>, <code>det R = +1</code>. The six sliders set plane rotations <code>R_ij(θ)</code> (§2.1) combined in the fixed order <code>M = R_ZW · R_YW · R_YZ · R_XW · R_XZ · R_XY</code>, <code>XY</code> applied first (§2.2). <!-- MATH.md §2 --></p>
<p>The projection view draws the rotated vertices <code>M p</code> through <code>P_d(x, y, z, w) = (x, y, z) · d/(d − w)</code> (perspective, eye at <code>(0, 0, 0, d)</code>), or <code>(x, y, z)</code> (orthographic), or <code>(x, y, z)/(1 − w)</code> (stereographic, for figures on the unit 3-sphere). <!-- MATH.md §3 --></p>
<p>The slice view intersects the rotated object with the hyperplane <code>H(e_w, c) = { q : q_w = c }</code>. Equivalently it slices the unrotated object with <code>H(M^T e_w, c)</code> and reads the result in the chart with basis <code>(M^T e_x, M^T e_y, M^T e_z)</code>, whose coordinates <code>(M^T e_k) · p = (M p)_k</code> are the viewer's <code>x, y, z</code> of the rotated point: for <code>M = I</code> this shows the object's own <code>x, y, z</code> unchanged (§4), and in general the slice appears exactly as the rotated object sits in our space. Every solid is a closed, outward-oriented tetrahedral boundary complex (§5), sliced by marching tetrahedra (§6); the result is a closed oriented triangle mesh whose signed volume is positive. <!-- MATH.md §4, §5, §6 --></p>
<p>The data are checked, not drawn by hand: hypervolumes come out as cone sums over boundary tets (§7) and agree with the catalogue of §8, and the slice volume integrates over <code>c</code> to the hypervolume along any direction (Cavalieri). <!-- MATH.md §7, §8 --></p>`,
});

// ---- Views -----------------------------------------------------------------

const viewProjection = topic({
  id: 'view:projection',
  title: 'Projection view',
  eli5: `
<p>Hold a wire cube in sunlight and look at its shadow on the ground: a flat drawing of a solid thing. Depending on how you turn the cube, the shadow is a square inside a square, or a hexagon. The shadow loses one direction but keeps the shape's structure: every corner and every edge is still there.</p>
<p>This view shows the 3D "shadow" of a 4D object. With a far-away light (orthographic) all parts are drawn at the same size. With a nearby lamp (perspective) the parts nearer the lamp are drawn bigger, and the lamp sits in the hidden direction. That is why the tesseract looks like a small cube inside a big cube: both cubes are the same size, one is just nearer the lamp.</p>
<p>Colour tells you what the shadow forgot: blue parts are behind our space, orange parts are in front.</p> <!-- MATH.md §3 -->`,
  intermediate: `
<p>Orthographic projection simply drops the <code>w</code> coordinate: <code>(x, y, z, w) ↦ (x, y, z)</code>. <!-- MATH.md §3.1 --></p>
<p>Perspective projection puts an eye on the <code>w</code> axis at distance <code>d</code> and draws each point at scale <code>d/(d − w)</code>, so points with larger <code>w</code> (nearer the eye) appear larger. For the tesseract <code>[−1, 1]^4</code> with <code>d = 3</code> the cube at <code>w = +1</code> is drawn at scale <code>3/2</code> and the cube at <code>w = −1</code> at scale <code>3/4</code>: the familiar cube inside a cube is the <code>w = −1</code> cube inside the <code>w = +1</code> cube. <!-- MATH.md §3.2 --></p>
<p>Stereographic projection is meant for figures on the unit 3-sphere (the Clifford torus, the Hopf fibration): it is conformal and sends circles on the sphere to circles or straight lines. <!-- MATH.md §3.3 --></p>
<p>The ordinary 3D rotations <code>XY</code>, <code>XZ</code>, <code>YZ</code> leave every <code>w</code> unchanged, so they only turn the image rigidly. The <code>XW</code>, <code>YW</code>, <code>ZW</code> rotations change which parts are near the eye, so the image morphs: faces swell as they come forward and shrink as they recede. Colour shows the <code>w</code> of each point after rotation. <!-- MATH.md §2.1, §10 --></p>`,
  math: `
<h3>Definitions</h3>
<ul>
<li>Orthographic: <code>(x, y, z, w) ↦ (x, y, z)</code>, a linear map with kernel <code>span(e_w)</code>. <!-- MATH.md §3.1 --></li>
<li>Perspective: eye at <code>(0, 0, 0, d)</code>, <code>d &gt; 0</code>, image hyperplane <code>w = 0</code>. The ray from the eye through <code>p</code> meets the image hyperplane at <code>P_d(x, y, z, w) = (x, y, z) · d/(d − w)</code>, valid for <code>w &lt; d</code>. The viewer clamps the denominator <code>d − w</code> below by a small positive value, so points at or beyond the eye are pushed far away rather than inverted. <!-- MATH.md §3.2 --></li>
<li>Stereographic, for <code>|p| = 1</code>: projection from the pole <code>(0, 0, 0, 1)</code> onto <code>w = 0</code>, <code>S(x, y, z, w) = (x, y, z)/(1 − w)</code>. It is conformal and maps circles of <code>S^3</code> to circles or lines of <code>R^3</code>. The pole itself has no image (it is the point at infinity); the viewer draws points within <code>10⁻⁶</code> of it far out along their own direction rather than at the origin. <!-- MATH.md §3.3 --></li>
</ul>
<h3>Reasons</h3>
<p>Because the perspective scale depends on <code>w</code> alone, every point of a hyperplane <code>w = c</code> is scaled by the same factor <code>d/(d − c)</code>; for the tesseract with <code>d = 3</code> the cells at <code>w = ±1</code> are drawn at <code>3/2</code> and <code>3/4</code>. Both projections send straight lines to straight lines, so a polytope's edges are drawn as segments and its faces as planar polygons. <!-- MATH.md §3.2 --></p>
<p>If <code>R</code> is a rotation in a plane not containing <code>w</code> (<code>XY</code>, <code>XZ</code>, <code>YZ</code>), then <code>R</code> fixes <code>w</code> and acts on <code>(x, y, z)</code> as a 3D rotation <code>R_3</code>, so <code>P_d(R p) = R_3 P_d(p)</code>: the image turns rigidly. For <code>XW</code>, <code>YW</code>, <code>ZW</code> the <code>w</code> coordinates change and the image is not a rigid motion of the previous one. <!-- MATH.md §2.1 --></p>
<p>Vertex colour is the <code>w</code> of <code>M p</code>, after rotation and before projection, on a fixed two-ended gradient with <code>w = 0</code> at the midpoint; the viewer spans it over <code>[−R, R]</code>, <code>R</code> the shape's radius, since <code>|w| ≤ |M p| = |p| ≤ R</code> for every rotation. <!-- MATH.md §10 --></p>`,
});

const viewSlice = topic({
  id: 'view:slice',
  title: 'Slice view',
  eli5: `
<p>Push a ball slowly through a sheet of paper. A creature living in the paper sees a dot, then a growing circle, then a shrinking one, then nothing. It never sees the ball, only the thin piece of it that is inside the paper at each moment.</p>
<p>Our whole 3D space is the "sheet of paper" for a 4D object. The slice view shows exactly the part of the object that is inside our space right now. The <strong>slice offset</strong> slider pushes the object through; the <em>pass-through</em> animation does it for you.</p>
<p>A 4D ball comes through as a 3D ball that grows and shrinks. A tesseract pushed straight through is strange in a different way: a full-size cube appears all at once, stays the same for a while, and vanishes all at once. Tilt it onto its long diagonal and it comes through as a point, then a pyramid-like tetrahedron, then an eight-sided octahedron, and back.</p> <!-- MATH.md §4, §6, §8.4, §8.5 -->`,
  intermediate: `
<p>The slice is the cross-section of the rotated object by the hyperplane <code>w = c</code>, our own 3-space displaced by <code>c</code> along the invisible axis. It is a genuine 3D solid: what a 4D object passing through our space would leave inside it at that instant. <!-- MATH.md §4 --></p>
<p>Known cases: the tesseract <code>[−1, 1]^4</code> sliced by <code>w = c</code> for any <code>|c| &lt; 1</code> is a cube of side 2 and volume 8. Sliced along its long diagonal (normal <code>(1, 1, 1, 1)/2</code>) the sequence from <code>c = −2</code> to <code>c = 2</code> is point, tetrahedron, truncated tetrahedron, regular octahedron (at <code>c = 0</code>, edge <code>2√2</code>, volume <code>32/3</code>), and back. A 4-ball of radius <code>R</code> slices to a ball of radius <code>√(R² − c²)</code>. <!-- MATH.md §8.4, §8.5 --></p>
<p>Integrating the slice volume over <code>c</code> gives the 4-volume, in every direction (Cavalieri's principle): 16 for the tesseract. <!-- MATH.md §7, §8.4 --></p>
<p>The rotation sliders tilt the object relative to our space. <code>XY</code>, <code>XZ</code> and <code>YZ</code> only rotate the slice as a rigid body; <code>XW</code>, <code>YW</code> and <code>ZW</code> change its shape, because they change which part of the object meets <code>w = c</code>. Colour shows where in the object's own <code>w</code> direction each bit of the slice came from. <!-- MATH.md §2.1, §10 --></p>`,
  math: `
<h3>Hyperplane and chart</h3>
<p>A hyperplane is <code>H(n, c) = { p : n · p = c }</code> with <code>|n| = 1</code>; the signed distance of <code>p</code> is <code>s(p) = n · p − c</code>. To draw <code>H</code> we choose an orthonormal basis <code>(u_1, u_2, u_3)</code> of <code>n^⊥</code> with <code>det(u_1, u_2, u_3, n) = +1</code> and use the chart <code>chart(p) = (u_1 · p, u_2 · p, u_3 · p)</code>, an isometry of <code>H</code> onto <code>R^3</code>. For <code>n = e_w</code> the basis is exactly <code>(e_x, e_y, e_z)</code>, so slicing at <code>w = c</code> shows the object's own <code>x, y, z</code>. The viewer always slices the rotated object with <code>n = e_w</code>, which equals slicing the unrotated object with <code>n = M^T e_w</code>. <!-- MATH.md §4 --></p>
<h3>Marching tetrahedra</h3>
<p>Each solid is a closed, outward-oriented complex of tetrahedra in <code>R^4</code> (§5). For each tet compute <code>s_k = n · p_k − c</code> at its four vertices and call a vertex <em>positive</em> when <code>s_k ≥ 0</code>, otherwise <em>negative</em>. Counting zero as positive is a symbolic perturbation equivalent to slicing at <code>c − ε</code>: the output is the <strong>limit from below</strong>, watertight even when vertices lie in <code>H</code>. For the tesseract <code>[−1, 1]^4</code> the slice at <code>w = +1</code> is the whole cube and the slice at <code>w = −1</code> is empty. <!-- MATH.md §6 --></p>
<p>An edge <code>(p, q)</code> crosses <code>H</code> iff its endpoints differ in class; the crossing is <code>p + t (q − p)</code>, <code>t = s_p/(s_p − s_q) ∈ [0, 1]</code>. With 0 or 4 positive vertices a tet contributes nothing; with 1 or 3 it contributes one triangle on its three crossing edges; with 2 (positives <code>{a, b}</code>, negatives <code>{c, d}</code>) the four crossings lie on edges <code>ac, ad, bd, bc</code> in that cyclic order, giving triangles <code>(ac, ad, bd)</code> and <code>(ac, bd, bc)</code>. Each triangle is oriented so that <code>cross(v_1 − v_0, v_2 − v_0) · N_3 &gt; 0</code>, where <code>N_3 = chart(N − (N · n) n)</code> is the tet's outward normal projected into <code>H</code>. <!-- MATH.md §6 --></p>
<p>Consequences the tests check: the slice is a closed, consistently oriented mesh and its signed volume <code>Σ v_0 · (v_1 × v_2)/6</code> is positive; integrated over <code>c</code> it equals the 4-volume <code>Σ |det[a − o; b − o; c − o; d − o]|/24</code> of §7. <!-- MATH.md §6, §7 --></p>`,
});

const viewOverlay = topic({
  id: 'view:overlay',
  title: 'Overlay view',
  eli5: `
<p>This view shows the shadow and the slice at the same time: the shadow faintly, the slice as a solid inside it. The slice is drawn at the size the shadow gives that part of the object, so it sits exactly where the shadow says it should be.</p>
<p>Try the tesseract: as you move the slice offset slider, a solid cube glides from the small inner cube of the shadow to the big outer one. Those two cubes are the same size in 4D; the lamp just makes the nearer one look bigger, and the solid slice grows the same way.</p> <!-- MATH.md §3.2 -->`,
  intermediate: `
<p>The slice is the part of the object in the hyperplane <code>w = c</code>. Under perspective from an eye at <code>w = d</code>, every point of that hyperplane is drawn at the same scale <code>d/(d − c)</code>, so the overlay scales the slice by exactly that factor and it lands where the projected wireframe crosses <code>w = c</code>. <!-- MATH.md §3.2 --></p>
<p>For the tesseract with <code>d = 3</code>: as <code>c</code> approaches <code>+1</code> the slice (a cube of side 2) is drawn at scale <code>3/2</code> and coincides with the outer cube of the projection; as <code>c</code> approaches <code>−1</code> it is drawn at <code>3/4</code> and coincides with the inner cube. <!-- MATH.md §3.2 --></p>
<p>Under orthographic projection the scale is 1 (nothing depends on <code>w</code>). Under stereographic projection the viewer uses <code>1/(1 − c)</code>, which is exact for figures on the unit 3-sphere and a convention for everything else. <!-- MATH.md §3.1, §3.3 --></p>`,
  math: `
<p>Let <code>q</code> be a slice vertex in chart coordinates. For the viewer's hyperplane <code>n = e_w</code> the chart basis is <code>(e_x, e_y, e_z)</code> (§4), so <code>q = (x, y, z)</code> are the first three coordinates of the rotated point <code>M p = (x, y, z, c)</code>. Its perspective image is <code>P_d(x, y, z, c) = (x, y, z) · d/(d − c) = q · d/(d − c)</code>. The factor is independent of <code>q</code>, so drawing the whole slice mesh under the uniform scale <code>d/(d − c)</code> reproduces <code>P_d</code> exactly on it, and the slice coincides with the projected wire wherever the wire meets <code>w = c</code>. The denominator is clamped below exactly as in the projection itself. <!-- MATH.md §3.2, §4 --></p>
<p>Orthographic projection is <code>(x, y, z, c) ↦ (x, y, z)</code>, scale 1. Stereographic projection of a point of the unit 3-sphere with <code>w = c</code> is <code>(x, y, z)/(1 − c)</code>, scale <code>1/(1 − c)</code>; this is exact only for <code>|p| = 1</code>, so for shapes not on <code>S^3</code> it is a convention rather than a theorem. <!-- MATH.md §3.1, §3.3 --></p>
<p>Limit-from-below convention: at <code>c = +1</code> the tesseract's slice is the cell <code>w = 1</code> itself, drawn at <code>3/2</code> for <code>d = 3</code>; at <code>c = −1</code> the slice is empty, and just above it the cube appears at scale <code>≈ 3/4</code>. <!-- MATH.md §6, §3.2 --></p>`,
});

// ---- Colour -----------------------------------------------------------------

const color = topic({
  id: 'color',
  title: 'What the colours mean',
  eli5: `
<p>Colour here is not decoration; it is a code for the direction you cannot see. Blue means "behind our space", white means "right here with us", orange-red means "ahead of our space". The legend at the bottom shows the scale.</p>
<p>In the shadow (projection) view, colour says which parts are nearer the 4D lamp and which are farther, so a flat-looking drawing gets its depth back. In the slice view, colour says where inside the object the visible material came from: pushing an object straight through, the slice changes colour as different layers pass through our space.</p> <!-- MATH.md §10 -->`,
  intermediate: `
<p>In the projection view each vertex is coloured by its <code>w</code> coordinate after rotation and before projection: the depth along the invisible axis that the projection discards. In the slice view each slice vertex is coloured by the <code>w</code> of the corresponding 4D point <em>before</em> rotation: where in the object's own fourth direction the visible material came from. The map from <code>w</code> to colour is a fixed two-ended gradient, cool blue for negative, near-white at <code>w = 0</code>, warm orange-red for positive, with the object's <code>w</code> extent at the ends. <!-- MATH.md §10 --></p>
<p>Consequences: an unrotated object pushed through <code>w = c</code> gives a slice of one uniform colour that shifts with <code>c</code>, because every point in it has source <code>w = c</code>. Once the object is tilted (<code>XW</code>, <code>YW</code>, <code>ZW</code>), one slice contains material from several layers and shows a gradient across it; the direction of the gradient is the direction of the tilt. In the projection view the <code>w = +1</code> cube of the tesseract is warm and the <code>w = −1</code> cube is cool. <!-- MATH.md §10, §3.2 --></p>`,
  math: `
<p>Let <code>g : [t_min, t_max] → colour</code> be the fixed gradient with <code>g(0)</code> the midpoint colour. Projection view: vertex <code>p</code> gets <code>g(w(M p))</code>, where <code>w(·)</code> is the fourth coordinate and <code>M</code> the composite rotation of §2.2; the viewer spans <code>g</code> over <code>[−R, R]</code>, <code>R</code> the shape's radius, because <code>|w(M p)| ≤ |p| ≤ R</code> for every rotation. Slice view: a slice vertex <code>q = (q_1, q_2, q_3)</code> corresponds to the unrotated point <code>p = M^T (q_1, q_2, q_3, c)</code> (<code>q</code> lifted into <code>w = c</code> and rotated back; equivalently <code>unchart</code> on <code>H(M^T e_w, c)</code> with the viewer's basis <code>(M^T e_x, M^T e_y, M^T e_z)</code>, the rows of <code>M</code>) and gets <code>g(w(p))</code>; the viewer spans <code>g</code> over the object's own <code>w</code> range <code>[w_min, w_max]</code>. <!-- MATH.md §10, §4 --></p>
<p>For a symmetric range the map is linear, <code>t = 1/2 + w/(2 w_max)</code>; for an asymmetric range (the 5-cell has <code>w ∈ [−1/√5, 4/√5]</code>) each side is scaled by its own extent so that both ends of the object reach the ends of the gradient while <code>w = 0</code> stays at the midpoint. <!-- MATH.md §10, §8.1 --></p>
<p>Why the slice colour is uniform without rotation: with <code>M = I</code> every point of the slice satisfies <code>w(p) = c</code>, so <code>g(w(p)) = g(c)</code>. After a rotation the slice points satisfy <code>(M^T e_w) · p = c</code> but their <code>w(p) = e_w · p</code> varies, and the variation is linear across the slice. <!-- MATH.md §4, §10 --></p>`,
});

// ---- Lifting ------------------------------------------------------------------

const liftExtrude = topic({
  id: 'lift:extrude',
  title: 'Extrusion: lifting a 3D solid into 4D',
  eli5: `
<p>Drag a dot sideways and it sweeps out a line. Drag the line sideways and it sweeps out a square. Drag the square straight up out of the paper and it sweeps out a cube. Drag the cube in the fourth direction and it sweeps out a tesseract. Each step is the same move: take the shape and sweep it along a new direction.</p>
<p>That move is called extrusion, and it is how the viewer turns ordinary 3D things (a ball, a doughnut, a mug) into 4D things. There is no single "right" 4D version of a 3D object; extrusion is one honest, clearly named choice.</p>
<p>Pushed straight through our space, an extruded object looks like the original 3D object, unchanged, for a while, then disappears. Tilt it first and you see a stretched and cut-off version of the original instead.</p> <!-- MATH.md §9.1 -->`,
  intermediate: `
<p>There is no canonical 4D version of a 3D object, so the viewer offers explicit, named liftings. Extrusion takes a closed, consistently oriented triangle mesh <code>M</code> bounding a solid <code>S ⊂ R^3</code> and forms the prism <code>P = S × [−h, h]</code> along <code>w</code>. This is exactly how a square becomes a cube and a cube a tesseract: <code>extrude(cube) = tesseract</code>. <!-- MATH.md §9, §9.1 --></p>
<p>The boundary of <code>P</code> has two parts: the <em>lateral</em> part <code>M × [−h, h]</code>, one triangular prism per triangle of <code>M</code>, and two <em>caps</em> <code>S × {−h}</code> and <code>S × {+h}</code>, solid copies of <code>S</code>. For the projection view the vertices are <code>(v, −h)</code> and <code>(v, +h)</code>, the edges are those of <code>M</code> at both levels plus one edge per vertex joining the levels, and the faces are the triangles of <code>M</code> at both levels plus one quad per edge of <code>M</code>. In perspective the cap nearer the eye is drawn larger: a sphere inside a sphere, a doughnut inside a doughnut. <!-- MATH.md §9.1, §3.2 --></p>
<p>Sliced by <code>w = c</code> with <code>|c| &lt; h</code> the result is a copy of <code>S</code>. Sliced by a tilted hyperplane (with <code>n_w ≠ 0</code>) the result is a <strong>sheared slab</strong>: an affine image of <code>S</code> clipped between two parallel planes. The hypervolume is <code>vol_3(S) · 2h</code> (for the cube of side 2 with <code>h = 1</code>, <code>8 · 2 = 16</code>, the tesseract). <!-- MATH.md §9.1, §8 --></p>`,
  math: `
<h3>Definition</h3>
<p><code>P = S × [−h, h] = { (q, w) : q ∈ S, −h ≤ w ≤ h }</code>. Lateral tets: each triangular prism <code>T × [−h, h]</code> is split into three tets with outward orientation derived from <code>M</code>'s counter-clockwise-from-outside orientation. Caps: <code>S × {±h}</code>, with outward normals <code>±e_w</code>. <!-- MATH.md §9.1 --></p>
<h3>Slicing</h3>
<p>The lateral part is sliced by marching tetrahedra (§6). A cap at <code>w = w_0 ∈ {−h, +h}</code> meets <code>H(n, c)</code> where <code>n_xyz · q = c − n_w w_0</code>, a plane in <code>R^3</code>; its slice is the planar section of <code>S</code> by that plane, lifted by <code>q ↦ (q, w_0)</code> and mapped through the chart. Planar sections are built by intersecting each triangle of <code>M</code> with the plane, chaining segments into closed loops by shared mesh edge, classifying loops as outer or hole by nesting parity, and ear-clipping with holes; cap orientation follows <code>±e_w</code> projected into <code>H</code>. <!-- MATH.md §9.1 --></p>
<h3>The sheared-slab fact</h3>
<p>If <code>n_w ≠ 0</code>, a point <code>(q, w)</code> of <code>P</code> lies in <code>H</code> iff <code>w = (c − n_xyz · q)/n_w</code>. So <code>H ∩ P</code> is the graph of this affine function over the part of <code>S</code> where it stays within <code>[−h, h]</code>, i.e. over <code>S ∩ { c − n_w h ≤ n_xyz · q ≤ c + n_w h }</code> (for <code>n_w &gt; 0</code>): an affine image of <code>S</code> clipped between two parallel planes. Composed with the chart (an isometry), a tilted hyperplane through an extruded object shows a sheared slab of the original. With <code>n = e_w</code> and <code>|c| &lt; h</code> the slice is <code>S</code> itself; at <code>c = +h</code> it is the cap (limit from below, §6) and at <code>c = −h</code> it is empty. <!-- MATH.md §9.1, §6 --></p>
<p>Hypervolume: <code>vol_4(P) = vol_3(S) · 2h</code>, consistent with the cone formula of §7 and the slice integral <code>∫ A(c) dc</code>. Other liftings named in MATH.md but not in this build: spinning <code>S</code> about a plane (§9.2) and signed distance fields (§9.3). <!-- MATH.md §7, §9.2, §9.3 --></p>`,
});

// ---- Rotations ----------------------------------------------------------------

const AXIS_NAMES = ['x', 'y', 'z', 'w'] as const;

/** The plane disjoint from `plane`: the one its rotations commute with. MATH.md §2.1 */
function complementaryPlane(plane: RotationPlane): RotationPlane {
  const [i, j] = PLANE_AXES[plane];
  const rest = ([0, 1, 2, 3] as Axis[]).filter((a) => a !== i && a !== j);
  const found = ROTATION_PLANES.find((p) => PLANE_AXES[p][0] === rest[0] && PLANE_AXES[p][1] === rest[1]);
  if (!found) throw new Error(`complementaryPlane: no plane for ${plane}`);
  return found;
}

const ORDINAL = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'] as const;

/**
 * One explainer per rotation plane. The matrix entries, the sign convention
 * and the commuting pairs come from §2.1, the composite order from §2.2; the
 * tilted-hyperplane equivalence from §4; the 45° tesseract example from §8.4
 * with the axes relabelled (the tesseract is symmetric under permutations of
 * its coordinates, so the (1, 1, 0, 0)/√2 slice of §8.4 and the
 * (1, 0, 0, 1)/√2 slice are congruent).
 */
function rotationTopic(plane: RotationPlane): Explainer {
  const [i, j] = PLANE_AXES[plane];
  const a = AXIS_NAMES[i];
  const b = AXIS_NAMES[j];
  const partner = complementaryPlane(plane);
  const order = ROTATION_PLANES.indexOf(plane);
  const hyper = isHyperPlane(plane);
  const fixedAxis3 = hyper ? null : AXIS_NAMES[([0, 1, 2] as Axis[]).find((k) => k !== i && k !== j) as Axis];
  const title = `Rotation in the ${plane} plane`;

  // Row w of R_ab(θ) for the hyper planes (a, w): M^T e_w = (…, sin θ at a, …, cos θ at w). §2.1, §4
  const normalText = hyper
    ? `(${AXIS_NAMES.map((n) => (n === a ? 'sin θ' : n === 'w' ? 'cos θ' : '0')).join(', ')})`
    : '';

  const eli5 = hyper
    ? `
<p>This slider tilts the object into the direction you cannot see. Think of a square lying on a sheet of paper: lift one edge off the paper and, to the flat creatures, its shadow gets narrower while the part still touching the paper shrinks to a line. Here the <code>${a}</code> direction of the object is turned toward the hidden direction in the same way.</p>
<p>In the slice view the shape changes, because a different part of the object is now inside our space. In the shadow view faces swell as they come toward the 4D lamp and shrink as they move away.</p>
<p>Watch the colours: whatever turns orange is moving ahead of our space, whatever turns blue is moving behind it. A quarter turn swaps the roles of the <code>${a}</code> direction and the hidden direction completely.</p> <!-- MATH.md §2.1, §4 -->`
    : `
<p>This is an ordinary turn, the kind you can do with a globe: it turns the <code>${a}</code> direction toward the <code>${b}</code> direction and leaves the <code>${fixedAxis3}</code> direction and the hidden direction alone.</p>
<p>Because nothing moves into or out of the hidden direction, the shadow simply turns and the slice simply turns. Nothing morphs. Compare it with the <code>${a.toUpperCase()}W</code> slider, which does move things into the hidden direction.</p>
<p>Turning here and turning in the <code>${partner}</code> plane never interfere with each other: you can do them in either order and get the same result.</p> <!-- MATH.md §2.1 -->`;

  const intermediate = `
<p>A <em>simple</em> 4D rotation turns one plane and leaves the complementary plane pointwise fixed; a general 4D rotation turns two complementary planes at once (§2.3). There are six coordinate planes, hence six elementary simple rotations and six sliders. <code>${plane}</code> turns the <code>${a}</code> axis toward the <code>${b}</code> axis (positive angle) and fixes the <code>${partner}</code> plane pointwise. ${hyper
    ? `It has no 3D counterpart: it moves material along <code>w</code>, out of or into our space.`
    : `It is the ordinary 3D rotation about the <code>${fixedAxis3}</code> axis.`} <!-- MATH.md §2.1 --></p>
<p>Rotations in disjoint planes commute: <code>${plane}</code> commutes with <code>${partner}</code> (<code>XY</code> with <code>ZW</code>, <code>XZ</code> with <code>YW</code>, <code>XW</code> with <code>YZ</code>); rotations in planes sharing an axis do not, in general. The viewer composes the six angles in a fixed order, <code>XY</code> first and <code>ZW</code> last; <code>${plane}</code> is applied ${ORDINAL[order]}. <!-- MATH.md §2.1, §2.2 --></p>
${hyper
    ? `<p>Slicing the rotated object by <code>w = c</code> is the same as slicing the unrotated object by a hyperplane whose normal is tilted by the angle θ from <code>e_w</code> toward <code>e_${a}</code>. For the tesseract, a 45° turn here followed by the slice at <code>w = 0</code> gives a <code>2 × 2 × 2√2</code> box of volume <code>8√2</code>; a 90° turn gives a cube again, with the <code>${a}</code> and <code>w</code> axes exchanged. In the projection view the cells move toward or away from the eye, so the image morphs. <!-- MATH.md §4, §8.4 --></p>`
    : `<p>Since it leaves every <code>w</code> unchanged, it turns the projected image rigidly and turns the slice rigidly: the slice's shape never changes under <code>${plane}</code>, only its orientation. <!-- MATH.md §2.1 --></p>`}
${plane === 'XY' || plane === 'ZW'
    ? `<p>Turning <code>XY</code> and <code>ZW</code> together is a <em>double rotation</em>; with equal angles it is <em>isoclinic</em>: every point of the object turns through the same angle, which no 3D rotation can do. The <em>double-rotation</em> and <em>isoclinic</em> animation presets drive exactly these two sliders. <!-- MATH.md §2.3 --></p>`
    : ''}`;

  const math = `
<h3>Definition</h3>
<p>For axes <code>i &lt; j</code> (here <code>${a}</code> = ${i}, <code>${b}</code> = ${j}), <code>R_${plane}(θ)</code> is the identity except</p>
<ul>
<li><code>R[${i}][${i}] = cos θ</code>, <code>R[${i}][${j}] = −sin θ</code>,</li>
<li><code>R[${j}][${i}] = sin θ</code>, <code>R[${j}][${j}] = cos θ</code>,</li>
</ul>
<p>so <code>R_${plane}(θ) e_${a} = cos θ e_${a} + sin θ e_${b}</code>: positive θ turns <code>e_${a}</code> toward <code>e_${b}</code>. <!-- MATH.md §2.1 --></p>
<h3>Facts</h3>
<ul>
<li><code>R^T R = I</code>, <code>det R = +1</code>; <code>R_${plane}(α) R_${plane}(β) = R_${plane}(α + β)</code>, <code>R_${plane}(0) = I</code>, <code>R_${plane}(θ)^{−1} = R_${plane}(−θ)</code>.</li>
<li><code>R_${plane}(θ) e_k = e_k</code> for <code>k ∉ {${a}, ${b}}</code>: the <code>${partner}</code> plane is fixed pointwise.</li>
<li><code>R_${plane}</code> commutes with <code>R_${partner}</code> (disjoint planes) and in general with no other elementary rotation.</li>
<li>Composite: <code>M = R_ZW · R_YW · R_YZ · R_XW · R_XZ · R_XY</code>; <code>${plane}</code> is factor number ${6 - order} from the left, applied ${ORDINAL[order]} to a vector. This order is a convention fixed so saved scenes agree, not a theorem.</li>
</ul>
<!-- MATH.md §2.1, §2.2 -->
${hyper
    ? `<h3>Effect on the slice</h3>
<p>The viewer slices <code>M p</code> by <code>n = e_w</code>, equivalently <code>p</code> by <code>n = M^T e_w</code>, the <code>w</code> row of <code>M</code>. For <code>M = R_${plane}(θ)</code> alone that row is <code>${normalText}</code>: the slicing hyperplane tilts by θ from <code>e_w</code> toward <code>e_${a}</code>, and the chart basis becomes the first three rows of <code>M</code>. Example: θ = π/4 on the tesseract <code>[−1, 1]^4</code> gives <code>n = (e_${a} + e_w)/√2</code>, <code>c = 0</code>: a square prism of volume <code>8√2</code>, a <code>2 × 2</code> square extruded along the <code>2√2</code> diagonal of the <code>(${a}, w)</code> square; θ = π/2 maps <code>e_${a} ↦ e_w</code>, <code>e_w ↦ −e_${a}</code>, and the slice is again a cube of volume 8. <!-- MATH.md §4, §8.4 --></p>`
    : `<h3>Effect on the views</h3>
<p><code>R_${plane}</code> fixes <code>e_w</code>, so <code>M^T e_w = e_w</code>: the slicing hyperplane is unchanged and the slice of the rotated object is the rigidly rotated slice, with the chart turned by the same 3D rotation. Likewise <code>P_d(R p) = R_3 P_d(p)</code> with <code>R_3</code> the 3D rotation about <code>${fixedAxis3}</code>, because the perspective factor <code>d/(d − w)</code> depends on <code>w</code> alone. <!-- MATH.md §4, §3.2 --></p>`}
${plane === 'XY' || plane === 'ZW'
    ? `<h3>Double and isoclinic rotations</h3>
<p><code>D(α, β) = R_XY(α) R_ZW(β)</code> turns two complementary planes at once; a generic 4D rotation is of this form in some pair of planes and has no fixed axis. For <code>|α| = |β|</code> it is isoclinic: <code>v · D v = |v|² cos α</code> for every <code>v</code>, so every vector turns through the same angle. <code>β = α</code> and <code>β = −α</code> are the left and right isoclinic rotations, the two families of Clifford translations of <code>S^3</code>. <!-- MATH.md §2.3 --></p>`
    : ''}`;

  return topic({ id: `rotation:${plane}`, title, eli5, intermediate, math });
}

const rotations: Explainer[] = ROTATION_PLANES.map(rotationTopic);

// ---- Regular polytopes (MATH.md §8) -------------------------------------------

const tesseract = shapeTopic({
  id: SHAPE_IDS.tesseract,
  title: 'Tesseract',
  view: 'projection',
  viewNote: 'the cube inside a cube; switch to the slice view and tilt the object for the point, tetrahedron, octahedron sequence.',
  eli5: `
<p>A square has 4 corners and 4 sides. A cube has 8 corners, 12 edges and 6 square faces. Take one more step in the same direction and you get the tesseract, the 4D cube: 16 corners, 32 edges, 24 squares, and 8 cubes as its "sides".</p>
<p>Its shadow in perspective is a small cube inside a big cube. The eight cubes are the inner cube, the outer cube and the six cubes joining them, each drawn as a flat-topped pyramid (a frustum) with a face of the outer cube as its big end and a face of the inner cube as its small end. In 4D they are all the same size and all perfect cubes; the inner one only looks small because it is farther from the lamp.</p>
<p>Pushed straight through our space, the tesseract appears as a full-size cube all at once, stays a cube, and vanishes all at once. Tilted onto its longest diagonal first, it enters as a point, grows into a tetrahedron, becomes an eight-sided octahedron halfway through, and shrinks back the same way.</p> <!-- MATH.md §8, §3.2, §8.4 -->`,
  intermediate: `
<p>Vertices <code>(±1, ±1, ±1, ±1)</code>: 16 vertices, 32 edges, 24 square faces, 8 cubic cells; Euler's relation <code>16 − 32 + 24 − 8 = 0</code>. Each vertex has 4 neighbours (change one coordinate), each edge has length 2, and the hypervolume is <code>2^4 = 16</code>. <!-- MATH.md §8, §5.3 --></p>
<p>Perspective from <code>d = 3</code> draws the cell at <code>w = +1</code> at scale <code>3/2</code> and the cell at <code>w = −1</code> at scale <code>3/4</code>: the cube inside a cube. <!-- MATH.md §3.2 --></p>
<p>Slices: by <code>w = c</code> with <code>|c| &lt; 1</code>, a cube of side 2, volume 8. Along the long diagonal (normal <code>(1, 1, 1, 1)/2</code>, offsets from <code>−2</code> to <code>2</code>): point, tetrahedron, truncated tetrahedron, regular octahedron at <code>c = 0</code> (vertices the six permutations of <code>(1, 1, −1, −1)</code>, edge <code>2√2</code>, volume <code>32/3</code>), and back. Along <code>(1, 1, 0, 0)/√2</code> at <code>c = 0</code>: a <code>2 × 2 × 2√2</code> square prism of volume <code>8√2</code>. In every direction the slice volume integrates to 16. <!-- MATH.md §8.4 --></p>`,
  math: `
<p>The tesseract is <code>[−1, 1]^4</code>. Facet normals <code>±e_i</code>; the 8 cells are <code>{x_i = ±1}</code>, the 24 squares are <code>{x_i = ±1, x_j = ±1}</code> (<code>6 · 4</code>), the 32 edges fix three coordinates at <code>±1</code> (<code>4 · 8</code>), and the 16 vertices are the sign vectors. <code>V − E + F − C = 0</code>. Hypervolume <code>2^4 = 16</code>, which the cone sum <code>Σ |det[a − o; b − o; c − o; d − o]|/24</code> over the boundary tets reproduces. <!-- MATH.md §8, §8.3, §7 --></p>
<p>Perspective <code>P_d(p) = (x, y, z) · d/(d − w)</code>: for <code>d = 3</code> the cells <code>w = ±1</code> appear at <code>3/2</code> and <code>3/4</code>. <!-- MATH.md §3.2 --></p>
<p>Slices of §8.4: <code>n = e_w</code>, <code>|c| &lt; 1</code>: the cube <code>[−1, 1]^3</code>, volume 8; at <code>c = +1</code> the cell itself and at <code>c = −1</code> the empty set (limit from below). <code>n = (1, 1, 1, 1)/2</code>, <code>c = 0</code>: the octahedron with vertices the permutations of <code>(1, 1, −1, −1)</code>, edge <code>2√2</code>, circumradius 2, volume <code>32/3</code>; <code>c = ±2</code>: a single vertex; in between, tetrahedra and truncated tetrahedra. <code>n = (1, 1, 0, 0)/√2</code>, <code>c = 0</code>: a square prism of volume <code>8√2</code>. For every unit <code>n</code>, <code>∫ A(c) dc = 16</code>. <!-- MATH.md §8.4, §6, §7 --></p>
<p>Extrusion: <code>extrude(cube of side 2, h = 1) = tesseract</code> exactly, so the tesseract is also the test case for the lifting pipeline. <!-- MATH.md §9.1 --></p>`,
});

const cell5 = shapeTopic({
  id: SHAPE_IDS.cell5,
  title: '5-cell',
  view: 'slice',
  viewNote: 'a tetrahedron that grows from a point as the object passes through; the projection view shows a tetrahedron with a fifth vertex at its centre.',
  eli5: `
<p>The simplest 4D shape, the way a triangle is the simplest flat shape and a tetrahedron (a pyramid with a triangular base) is the simplest solid. Build it the same way: take a tetrahedron and add one more corner "above" it in the hidden direction, joined to all four. Five corners, and every pair of them is joined by an edge.</p>
<p>Its shadow looks like a tetrahedron with a point in the middle connected to the four corners. That middle point is the fifth corner, directly ahead in the hidden direction.</p>
<p>Pushed through our space tip first, it appears as a point that grows into a bigger and bigger tetrahedron, and then it is gone.</p> <!-- MATH.md §8.1 -->`,
  intermediate: `
<p>5 vertices, 10 edges, 10 triangular faces, 5 tetrahedral cells; every pair of vertices is joined by an edge, so it is the 4D simplex, and it is self-dual. Vertices <code>(1, 1, 1, −1/√5)</code>, <code>(1, −1, −1, −1/√5)</code>, <code>(−1, 1, −1, −1/√5)</code>, <code>(−1, −1, 1, −1/√5)</code>, <code>(0, 0, 0, 4/√5)</code>: every pair is at distance <code>a = 2√2</code>, the circumradius is <code>4/√5</code> and the centroid is the origin. <!-- MATH.md §8, §8.1 --></p>
<p>Hypervolume <code>√5/96 · a^4</code>, which for <code>a = 2√2</code> is <code>2√5/3 ≈ 1.49</code>. <!-- MATH.md §8 --></p>
<p>Sliced by <code>w = c</code>: from the apex at <code>w = 4/√5</code> down to the base cell at <code>w = −1/√5</code>, the slice is a regular tetrahedron growing linearly from a point to the base tetrahedron of edge <code>2√2</code>. The four base vertices sit at the alternate corners of the cube <code>[−1, 1]^3</code>, so in the projection view they form a tetrahedron and the apex projects to its centre. <!-- MATH.md §8.1 --></p>`,
  math: `
<p>Vertices as in §8.1. Pairwise distances: two base vertices differ in two coordinates by 2, distance <code>√8 = 2√2</code>; apex to base vertex: <code>√(3 + (5/√5)²) = √8</code>. The cell opposite <code>v_k</code> has facet normal <code>−v_k</code>. Hypervolume <code>√5/96 · (2√2)^4 = 64√5/96 = 2√5/3</code>. <!-- MATH.md §8.1, §8.3, §8 --></p>
<p>Slice by <code>w = c</code>, <code>−1/√5 &lt; c &lt; 4/√5</code>: the 5-cell is the cone from the apex <code>A = (0, 0, 0, 4/√5)</code> over the base tetrahedron <code>B</code> at <code>w = −1/√5</code>, whose <code>x, y, z</code> centroid is the origin, so the slice is <code>B</code> scaled by <code>λ = (4/√5 − c)/√5</code> toward the axis: a regular tetrahedron of edge <code>2√2 λ</code> and volume <code>(8/3) λ³</code>.
<!-- Derivation: the cone has height 4/√5 + 1/√5 = √5 (apex to base); the
     slice at w = c is at distance 4/√5 − c from the apex, so it is B scaled
     by λ = (4/√5 − c)/√5. B is the tetrahedron on alternate corners of [−1,1]^3:
     volume 8 − 4·(2·2·2/6) = 8 − 16/3 = 8/3. Check against §8:
     ∫ (8/3) λ³ dc over c ∈ [−1/√5, 4/√5] = (8/3) · √5 · ∫_0^1 λ³ dλ
     = (8/3) · √5/4 = 2√5/3. -->
At <code>c = 4/√5</code> the slice is the apex alone; at <code>c = −1/√5</code> it is empty (limit from below), the base cell being approached from above. Integrating the slice volume recovers <code>2√5/3</code>. <!-- MATH.md §8.1, §6, §7 --></p>
<p>Colour: the <code>w</code> range <code>[−1/√5, 4/√5]</code> is asymmetric, so the gradient is scaled per side with <code>w = 0</code> at the midpoint; the apex is drawn at the warm end and the base at the cool end. <!-- MATH.md §10 --></p>`,
});

const cell16 = shapeTopic({
  id: SHAPE_IDS.cell16,
  title: '16-cell',
  view: 'slice',
  viewNote: 'an octahedron that grows from a point and shrinks back; in the projection view two vertices overlap at the centre until you rotate in XW, YW or ZW.',
  eli5: `
<p>Put a corner at distance 1 in both directions along every axis. In the plane that gives a diamond (4 corners); in space, an octahedron (6 corners, 8 triangles); in 4D, the 16-cell: 8 corners and 16 tetrahedra as its sides.</p>
<p>It is the partner of the tesseract: the tesseract has 8 cubes and 16 corners, the 16-cell has 16 tetrahedra and 8 corners. Every corner is joined to every other corner except the one directly opposite it.</p>
<p>Its shadow straight along the hidden axis is an octahedron with two corners piled up at the centre: those are the corners pointing straight ahead and straight behind. Pushed through our space it is an octahedron growing from a point and shrinking back.</p> <!-- MATH.md §8, §8.3 -->`,
  intermediate: `
<p>Vertices <code>±e_i</code>: 8 vertices, 24 edges, 32 triangles, 16 tetrahedral cells; <code>8 − 24 + 32 − 16 = 0</code>. Every pair of non-opposite vertices is joined (<code>28 − 4 = 24</code> edges) at distance <code>√2</code>. It is the dual of the tesseract and the 4D cross-polytope, the analogue of the octahedron. Hypervolume <code>2/3</code>. <!-- MATH.md §8 --></p>
<p>Its 16 cells are the tetrahedra with one vertex of each sign pair, <code>(±e_x, ±e_y, ±e_z, ±e_w)</code>, one per facet normal <code>(±1, ±1, ±1, ±1)</code>. The 4-ball in this viewer is built by repeatedly subdividing these 16 cells. <!-- MATH.md §8.3, §8.5 --></p>
<p>As a solid it is <code>|x| + |y| + |z| + |w| ≤ 1</code>, so the slice by <code>w = c</code> is the octahedron <code>|x| + |y| + |z| ≤ 1 − |c|</code>: at <code>c = 0</code> the octahedron with vertices <code>±e_x, ±e_y, ±e_z</code> (volume <code>4/3</code>), shrinking linearly to a point at <code>c = ±1</code>. In the projection along <code>w</code> both <code>±e_w</code> land at the origin. <!-- MATH.md §8.3 --></p>`,
  math: `
<p>The facet with normal <code>ν = (s_1, s_2, s_3, s_4)</code>, <code>s_k = ±1</code>, is the set of vertices maximising <code>ν · v</code>, namely <code>{s_1 e_1, s_2 e_2, s_3 e_3, s_4 e_4}</code>; hence the 16-cell is <code>{ p : ν · p ≤ 1 for all 16 ν } = { |x| + |y| + |z| + |w| ≤ 1 }</code>, the unit ball of the 1-norm. <!-- MATH.md §8.3 --></p>
<p>Slice by <code>w = c</code>: <code>{ |x| + |y| + |z| ≤ 1 − |c| }</code>, an octahedron of volume <code>(4/3)(1 − |c|)³</code>.
<!-- Octahedron |x|+|y|+|z| ≤ r has volume (4/3) r³ (eight corner tets of
     volume r³/6). Cavalieri check against the §8 table:
     ∫_{−1}^{1} (4/3)(1 − |c|)³ dc = 2 · (4/3) · 1/4 = 2/3. -->
Integrating over <code>c ∈ [−1, 1]</code> gives <code>2/3</code>, the hypervolume of §8. <!-- MATH.md §7, §8 --></p>
<p>Projection: orthographic along <code>w</code> sends <code>±e_w</code> to the origin and the other six vertices to the octahedron; perspective does the same, since points on the <code>w</code> axis have <code>(x, y, z) = 0</code> whatever the scale. A rotation in <code>XW</code>, <code>YW</code> or <code>ZW</code> separates the two central vertices. <!-- MATH.md §3.1, §3.2 --></p>
<p>Level 0 of the 4-ball tessellation is this complex (hypervolume <code>2/3</code>); midpoint subdivision with projection onto the sphere converges to <code>π²/2</code>. <!-- MATH.md §8.5 --></p>`,
});

const cell24 = shapeTopic({
  id: SHAPE_IDS.cell24,
  title: '24-cell',
  view: 'slice',
  viewNote: 'octahedron, truncated octahedron, cuboctahedron and back as it passes through; the projection view shows a cuboctahedron with two octahedra: orthographically both just touch its square faces from inside, in perspective the nearer one pokes out through them and the farther one sits inside.',
  eli5: `
<p>The odd one out. Every other regular 4D shape has a 3D cousin: the tesseract is a cube, the 5-cell a tetrahedron, the 16-cell an octahedron, and the 120- and 600-cells the twelve- and twenty-sided dice. The 24-cell has none. It has 24 corners, 96 edges, 96 triangles and 24 octahedra, and it is its own partner.</p>
<p>Its corners sit exactly at the centres of the 24 squares of the tesseract.</p>
<p>Pushed through our space it starts as an octahedron, grows into a cuboctahedron (a cube with its corners cut off down to the middles of its edges) halfway, and goes back.</p> <!-- MATH.md §8, §8.3 -->`,
  intermediate: `
<p>Vertices: the 24 permutations of <code>(±1, ±1, 0, 0)</code>; 24 vertices, 96 edges of length <code>√2</code>, 96 triangles, 24 octahedral cells; <code>24 − 96 + 96 − 24 = 0</code>; self-dual; hypervolume 8. Eight edges meet at each vertex (<code>2 · 96/24</code>). It is the only regular convex 4-polytope with no 3D analogue. <!-- MATH.md §8 --></p>
<p>The vertices are the centres of the 24 square faces of the tesseract <code>[−1, 1]^4</code> (two coordinates <code>±1</code>, two zero), and equally the midpoints of the 24 edges of the 16-cell with vertices <code>±2 e_i</code>. <!-- MATH.md §8 --></p>
<p>Slice by <code>w = c</code>: just inside <code>c = ±1</code> an octahedron (the cell with vertices <code>(±1, 0, 0, ±1)</code> and permutations of the first three coordinates), at <code>c = 0</code> the cuboctahedron with vertices the permutations of <code>(±1, ±1, 0)</code> (volume <code>20/3</code>), and in between truncated octahedra, the regular (Archimedean) one at <code>|c| = 1/2</code>. <!-- MATH.md §8, §8.3 --></p>`,
  math: `
<p>Facet normals <code>±e_i</code> and <code>(±1, ±1, ±1, ±1)</code> (24 in all), giving the inequality description <code>{ |x_i| ≤ 1 for all i, and |x| + |y| + |z| + |w| ≤ 2 }</code>: the intersection of the tesseract with the 16-cell of circumradius 2. Each facet is an octahedron: the cell with normal <code>e_w</code> has vertices <code>(±1, 0, 0, 1)</code>, <code>(0, ±1, 0, 1)</code>, <code>(0, 0, ±1, 1)</code>. <!-- MATH.md §8.3 --></p>
<p>Slice by <code>w = c</code>, <code>|c| &lt; 1</code>: <code>{ |x|, |y|, |z| ≤ 1, |x| + |y| + |z| ≤ 2 − |c| }</code>, the cube <code>[−1, 1]^3</code> with its corners cut by the planes <code>±x ± y ± z = 2 − |c|</code>.
<!-- 2 − |c| ∈ (1, 2]: at 2 the cuts pass through the edge midpoints
     (cuboctahedron, vertices perms of (±1, ±1, 0)); as 2 − |c| → 1 the cut
     planes reach the face centres and the cube faces shrink to points
     (octahedron with vertices ±e_x, ±e_y, ±e_z). At 2 − |c| = 3/2 the
     vertices are the permutations of (±1, ±1/2, 0), all edges 1/√2: the
     Archimedean truncated octahedron. Cuboctahedron volume: cube 8 minus
     eight corner tets of legs 1 (volume 1/6 each) = 8 − 4/3 = 20/3. -->
At <code>c = 0</code> this is the cuboctahedron, volume <code>8 − 8/6 = 20/3</code>; for <code>0 &lt; |c| &lt; 1</code> a truncated octahedron, Archimedean at <code>|c| = 1/2</code> (vertices the permutations of <code>(±1, ±1/2, 0)</code>, all edges <code>1/√2</code>); as <code>|c| → 1</code> the octahedron <code>|x| + |y| + |z| ≤ 1</code>. By the limit-from-below convention the slice at <code>c = +1</code> is the octahedral cell and at <code>c = −1</code> the empty set. <!-- MATH.md §8.3, §6 --></p>
<p>Projection along <code>w</code>: the 12 vertices with <code>w = 0</code> form a cuboctahedron at scale 1, the 6 with <code>w = +1</code> an octahedron at scale <code>d/(d − 1)</code> and the 6 with <code>w = −1</code> an octahedron at scale <code>d/(d + 1)</code>; orthographically the two octahedra coincide. <!-- MATH.md §3.1, §3.2 --></p>`,
});

const cell600 = shapeTopic({
  id: SHAPE_IDS.cell600,
  title: '600-cell',
  view: 'slice',
  viewNote: 'many-sided faceted blobs that grow and shrink like a ball; the projection view shows the dense icosahedral wireframe.',
  eli5: `
<p>The 4D cousin of the icosahedron, the twenty-sided die. Where the icosahedron is 20 triangles meeting five at each corner, the 600-cell is 600 tetrahedra meeting twenty at each corner, arranged around the corner like the 20 faces of an icosahedron. It has 120 corners, 720 edges and 1200 triangles.</p>
<p>All 120 corners lie on a 4D sphere. Pushed through our space it comes out as many-sided faceted solids that grow and shrink much like a ball passing through.</p>
<p>In the shadow view it is a dense cage of triangles; the tetrahedra nearest the lamp are drawn largest.</p> <!-- MATH.md §8, §8.2 -->`,
  intermediate: `
<p>120 vertices, 720 edges, 1200 triangular faces, 600 tetrahedral cells; <code>120 − 720 + 1200 − 600 = 0</code>. Each vertex has 12 neighbours arranged as an icosahedron, 20 cells meet at each vertex and 5 around each edge. It is the dual of the 120-cell. <!-- MATH.md §8, §8.2 --></p>
<p>Vertices on the unit 3-sphere, with <code>φ = (1 + √5)/2</code>: the 8 points <code>(±1, 0, 0, 0)</code> and permutations, the 16 points <code>(±1/2, ±1/2, ±1/2, ±1/2)</code>, and the 96 even permutations of <code>(±φ/2, ±1/2, ±1/(2φ), 0)</code>. Edges join vertices at distance <code>1/φ ≈ 0.618</code>; the cells are the 600 four-cliques of that graph. <!-- MATH.md §8.2 --></p>
<p>MATH.md deliberately states no closed-form hypervolume; the value computed from the boundary tets is checked by the slice integral and by lying between the hypervolumes of the inscribed and circumscribed 4-balls (the circumscribed ball has radius 1 and hypervolume <code>π²/2</code>). Since all vertices lie on the unit sphere, the slice at offset <code>c</code> fits inside a ball of radius <code>√(1 − c²)</code>. <!-- MATH.md §8.2, §8.5 --></p>`,
  math: `
<p>Vertex set as in §8.2 (<code>8 + 16 + 96 = 120</code>), all of norm 1. Edge graph: pairs at distance <code>a = 1/φ</code>, 12 per vertex, 720 in all; cells: the 600 four-cliques; facet normals: the centroids of the cliques. Within a cell the faces are the facets of the cell's 3D convex hull. <!-- MATH.md §8.2, §8.3 --></p>
<p>Incidences follow from the counts: <code>600 · 4/120 = 20</code> cells per vertex (the icosahedral vertex figure has 20 faces), <code>600 · 6/720 = 5</code> cells per edge, <code>1200 · 3/120 = 30</code> faces per vertex (the icosahedron's 30 edges). Euler: <code>V − E + F − C = 0</code>. <!-- MATH.md §8, §5.3 --></p>
<p>Hypervolume: not asserted as a closed form in MATH.md; the computed cone sum (§7) must satisfy <code>vol_4(inscribed ball) &lt; vol_4 &lt; vol_4(circumscribed ball) = π²/2</code> and must equal <code>∫ A(c) dc</code> along any direction. Because the polytope is convex and contained in the unit ball, its slice by <code>H(n, c)</code> is contained in the ball of radius <code>√(1 − c²)</code> of §8.5. <!-- MATH.md §8.2, §7, §8.5 --></p>
<p>Duality: the 120-cell's 600 vertices are the normalised centroids of these 600 cells. <!-- MATH.md §8.2 --></p>`,
});

const cell120 = shapeTopic({
  id: SHAPE_IDS.cell120,
  title: '120-cell',
  view: 'projection',
  viewNote: 'a thick nest of pentagons with the nearest dodecahedron drawn largest; the slice view shows faceted solids growing and shrinking.',
  eli5: `
<p>The 4D cousin of the dodecahedron, the twelve-sided die. Just as 12 pentagons curl up to close a dodecahedron, 120 dodecahedra curl up to close the 120-cell. It has 600 corners and 1200 edges, the most of any regular 4D shape.</p>
<p>In the shadow view you see a thick nest of pentagons; the dodecahedron nearest the lamp is drawn biggest, and the ones around it are squashed into it.</p>
<p>It is the partner of the 600-cell: put a corner at the centre of each of the 600-cell's tetrahedra and join the neighbours, and you get the 120-cell.</p> <!-- MATH.md §8, §8.2 -->`,
  intermediate: `
<p>600 vertices, 1200 edges, 720 pentagonal faces, 120 dodecahedral cells; <code>600 − 1200 + 720 − 120 = 0</code>. Four edges, six faces and four cells meet at each vertex (the vertex figure is a tetrahedron); three pentagons and three cells meet along each edge. <!-- MATH.md §8 --></p>
<p>It is the dual of the 600-cell: its 600 vertices are the normalised centroids of the 600-cell's 600 tetrahedral cells, all on the unit 3-sphere, and each of its 120 dodecahedral cells consists of the 20 cell-centroids around one 600-cell vertex. <!-- MATH.md §8.2 --></p>
<p>As for the 600-cell, MATH.md states no closed-form hypervolume; the computed value is checked by the slice integral and by the inscribed and circumscribed 4-balls. Its slice at offset <code>c</code> fits inside a ball of radius <code>√(1 − c²)</code>. <!-- MATH.md §8.2, §8.5 --></p>`,
  math: `
<p>Construction: vertices <code>ν/|ν|</code> for the centroids <code>ν</code> of the 600-cell's cells; facet normals are the 600-cell's 120 vertices, and the cell with normal <code>v</code> is the set of the 20 centroids around <code>v</code>, a dodecahedron. Faces are the facets of each cell's 3D convex hull, edges the union of face edges. <!-- MATH.md §8.2, §8.3 --></p>
<p>Incidences from the counts: <code>1200 · 2/600 = 4</code> edges per vertex, <code>720 · 5/1200 = 3</code> faces per edge, <code>120 · 20/600 = 4</code> cells per vertex, <code>120 · 30/1200 = 3</code> cells per edge, <code>120 · 12/720 = 2</code> cells per face. <code>V − E + F − C = 0</code>. <!-- MATH.md §8, §5.3 --></p>
<p>Hypervolume: not asserted as a closed form; checked by <code>∫ A(c) dc</code> and by the bounds <code>vol_4(inscribed ball) &lt; vol_4 &lt; π²/2</code>. Slices lie inside the ball of radius <code>√(1 − c²)</code> because the polytope is convex with all vertices on the unit sphere. <!-- MATH.md §8.2, §7, §8.5 --></p>`,
});

// ---- Curved solids (MATH.md §8.5, §8.6, §3.3) ------------------------------------

const hypersphere = shapeTopic({
  id: SHAPE_IDS.hypersphere,
  title: 'Hypersphere (4-ball)',
  view: 'slice',
  viewNote: 'a ball that grows from a point and shrinks back; this shape has no edges, so the projection view draws nothing (see the Hopf fibration for a picture of its surface).',
  eli5: `
<p>Push a ball through a sheet of paper and the flat creatures see a dot that swells into a circle and shrinks away. Push a 4D ball through our space and we see a 3D ball that appears as a point, swells to full size, and shrinks away.</p>
<p>It is perfectly round in every direction, so turning it with the sliders changes nothing about its shape; only the colours move, showing which part of the ball is passing through.</p>
<p>A smooth ball has no corners or edges, so there is no wireframe shadow to draw. The Hopf fibration is a picture of the 4D ball's skin.</p> <!-- MATH.md §8.5 -->`,
  intermediate: `
<p>The 4-ball of radius <code>R</code> is <code>{ |p| ≤ R }</code>; its boundary is the 3-sphere <code>S^3</code>. Hypervolume <code>π² R^4 / 2</code>. The slice at offset <code>c</code> is a ball of radius <code>√(R² − c²)</code> and volume <code>(4/3) π (R² − c²)^{3/2}</code>: full size at <code>c = 0</code>, a point at <code>c = ±R</code>. <!-- MATH.md §8.5 --></p>
<p>The viewer tessellates <code>S^3</code> by starting from the 16 tetrahedra of the 16-cell and repeatedly splitting each tet into 8, projecting new vertices onto the sphere; the discrete volumes converge to the exact ones with refinement. Every rotation is a symmetry of the ball, so the sliders only change which source material (and hence which colours) you see. <!-- MATH.md §8.5, §10 --></p>`,
  math: `
<p><code>B_R = { p ∈ R^4 : |p| ≤ R }</code>, boundary <code>S^3_R = { |p| = R }</code>. For <code>p = (x, y, z, c)</code>, <code>|p|² ≤ R²</code> iff <code>x² + y² + z² ≤ R² − c²</code>, so the slice by <code>w = c</code> is the ball of radius <code>√(R² − c²)</code>, volume <code>A(c) = (4/3) π (R² − c²)^{3/2}</code>; by rotational symmetry the same holds for every unit normal. <!-- MATH.md §8.5 --></p>
<p>Cavalieri check: <code>∫_{−R}^{R} (4/3) π (R² − c²)^{3/2} dc = (4/3) π · (3π/8) R^4 = π² R^4 / 2 = vol_4(B_R)</code>. <!-- MATH.md §7, §8.5 --></p>
<p>Tessellation: the 16-cell's 16 tets (level 0, hypervolume <code>2/3</code> for <code>R = 1</code>) are refined by midpoint subdivision, <code>16 · 8^level</code> tets, each new vertex normalised to radius <code>R</code>. Tests assert convergence to <code>π² R^4 / 2</code> and to the slice volumes with a tolerance appropriate to the level. <!-- MATH.md §8.5, §8 --></p>`,
});

const duocylinder = shapeTopic({
  id: SHAPE_IDS.duocylinder,
  title: 'Duocylinder and Clifford torus',
  view: 'slice',
  viewNote: 'a cylinder whose height changes with the offset while its radius stays fixed; the wire in the projection view is the Clifford torus, a round torus under stereographic projection.',
  eli5: `
<p>A can (a cylinder) is a disc swept along a straight line. The duocylinder is a disc swept over every point of a second disc that lies in a completely separate pair of directions: a disc times a disc. It is round in two independent ways at once.</p>
<p>Its skin is two doughnut-shaped solids glued to each other along a torus, the Clifford torus, which is what the shadow view draws.</p>
<p>Pushed straight through our space it is a can whose height grows and shrinks while its radius never changes.</p> <!-- MATH.md §8.6 -->`,
  intermediate: `
<p>Duocylinder of radii <code>r_1, r_2</code>: <code>{ x² + y² ≤ r_1², z² + w² ≤ r_2² }</code>, the product of two discs, hypervolume <code>π² r_1² r_2²</code>. Its boundary is two solid tori glued along the Clifford torus <code>{ x² + y² = r_1², z² + w² = r_2² }</code>, parametrised by <code>(r_1 cos α, r_1 sin α, r_2 cos β, r_2 sin β)</code>. With <code>r_1 = r_2 = 1/√2</code> the Clifford torus lies on the unit 3-sphere and its stereographic image is a round torus. <!-- MATH.md §8.6 --></p>
<p>Slice by <code>w = c</code>: a cylinder of radius <code>r_1</code> and height <code>2√(r_2² − c²)</code>, present for <code>|c| &lt; r_2</code>. Rotations in <code>XY</code> and <code>ZW</code> turn each disc within its own plane and are symmetries of the solid; the other four planes tilt it. <!-- MATH.md §8.6 --></p>`,
  math: `
<p><code>D = { x² + y² ≤ r_1² } × { z² + w² ≤ r_2² }</code>, <code>vol_4 = (π r_1²)(π r_2²)</code>. Boundary: <code>{ x² + y² = r_1², z² + w² ≤ r_2² } ∪ { x² + y² ≤ r_1², z² + w² = r_2² }</code>, two solid tori meeting along the Clifford torus. <!-- MATH.md §8.6 --></p>
<p>Slice by <code>n = e_w</code>: <code>w = c</code> turns <code>z² + w² ≤ r_2²</code> into <code>z² ≤ r_2² − c²</code>, so the slice is <code>{ x² + y² ≤ r_1² } × { |z| ≤ √(r_2² − c²) }</code>, a cylinder of volume <code>A(c) = 2 π r_1² √(r_2² − c²)</code>. Cavalieri: <code>∫_{−r_2}^{r_2} A(c) dc = π r_1² · π r_2²</code>, the area of a disc of radius <code>r_2</code> being <code>∫ 2√(r_2² − c²) dc</code>. <!-- MATH.md §8.6, §7 --></p>
<p>Invariance: <code>R_XY(θ)</code> and <code>R_ZW(θ)</code> preserve <code>x² + y²</code> and <code>z² + w²</code>, hence map <code>D</code> to itself; the isoclinic rotation <code>D(α, α) = R_XY(α) R_ZW(α)</code> slides the Clifford torus along itself. For <code>r_1 = r_2 = 1/√2</code> the torus lies in <code>S^3</code> and <code>S(x, y, z, w) = (x, y, z)/(1 − w)</code> maps it to a torus of revolution. <!-- MATH.md §2.1, §2.3, §3.3 --></p>
<p>The viewer's model discretises both circles into regular <code>n</code>-gons, so the solid is exactly a product of polygons and its hypervolume the product of their areas, converging to <code>π² r_1² r_2²</code> as <code>n</code> grows. <!-- MATH.md §8.6 --></p>`,
});

const hopf = shapeTopic({
  id: SHAPE_IDS.hopf,
  title: 'Hopf fibration',
  view: 'projection',
  viewNote: 'choose the stereographic projection to see the circles arranged on nested tori; this figure is a wire only, so its slices are empty.',
  eli5: `
<p>The skin of a 4D ball can be filled completely with circles: every point lies on exactly one circle, and any two of the circles are linked like two rings of a chain. This is the Hopf fibration. Nothing like it is possible on the skin of a 3D ball.</p>
<p>The picture shows a selection of these circles. Seen through the stereographic projection they appear as round circles arranged on nested doughnut surfaces, with one circle, the one passing through the projection point, stretched into a straight line.</p>
<p>Turn on the <em>isoclinic</em> animation (with the other sliders at zero): every circle slides along itself, so the picture stands still while the colours flow around it.</p> <!-- MATH.md §3.3 -->`,
  intermediate: `
<p>Write a point of the unit 3-sphere as a pair of complex numbers <code>(z_1, z_2)</code> with <code>|z_1|² + |z_2|² = 1</code>, using <code>(x, y, z, w) = (Re z_1, Im z_1, Re z_2, Im z_2)</code>. The Hopf map sends <code>(z_1, z_2)</code> to a point of the ordinary 2-sphere, and the points sent to the same place form the great circle <code>{ (e^{it} z_1, e^{it} z_2) }</code>. These circles are the <em>fibres</em>: they fill <code>S^3</code>, no two meet, and every two are linked once. <!-- MATH.md §3.3 --></p>
<p>The fibres over a circle of latitude of the 2-sphere form a torus in <code>S^3</code>; over the equator it is the Clifford torus with <code>r_1 = r_2 = 1/√2</code>. Stereographic projection is conformal and sends circles to circles or lines, so the fibres appear as circles (one as a straight line) lying on nested tori. <!-- MATH.md §3.3, §8.6 --></p>
<p>Each fibre is an orbit of the isoclinic rotation <code>R_XY(t) R_ZW(t)</code>, which turns every vector through the same angle <code>t</code>; with the other four angles at zero the <em>isoclinic</em> preset therefore maps every fibre to itself. The figure is drawn as a wire only; it bounds no solid, so the slice view is empty. <!-- MATH.md §2.3 --></p>`,
  math: `
<p><code>S^3 = { (z_1, z_2) ∈ C² : |z_1|² + |z_2|² = 1 }</code>. The Hopf map <code>h(z_1, z_2) = (2 Re(z_1 z̄_2), 2 Im(z_1 z̄_2), |z_1|² − |z_2|²)</code> lands on <code>S^2</code>, since <code>|h|² = 4|z_1|²|z_2|² + (|z_1|² − |z_2|²)² = (|z_1|² + |z_2|²)² = 1</code>. The fibre over <code>h(z_1, z_2)</code> is <code>{ (e^{it} z_1, e^{it} z_2) : t ∈ [0, 2π) }</code>, the intersection of <code>S^3</code> with a complex line through the origin (a real 2-plane), hence a great circle. Distinct fibres are disjoint and any two have linking number <code>±1</code>. <!-- MATH.md §3.3 --></p>
<p>In real coordinates, multiplication of <code>z_1</code> and <code>z_2</code> by <code>e^{it}</code> is <code>R_XY(t) R_ZW(t) = D(t, t)</code>, the left isoclinic rotation of §2.3 (a Clifford translation): every fibre is an orbit of this one-parameter group, and <code>v · D v = cos t</code> for every unit <code>v</code>. <!-- MATH.md §2.1, §2.3 --></p>
<p>Fibres over the latitude <code>b_z = const</code> satisfy <code>|z_1|² = (1 + b_z)/2</code>, <code>|z_2|² = (1 − b_z)/2</code>, so they lie on the torus <code>{ x² + y² = (1 + b_z)/2, z² + w² = (1 − b_z)/2 }</code>; for <code>b_z = 0</code> this is the Clifford torus of §8.6. Stereographic projection from <code>(0, 0, 0, 1)</code>, <code>S(p) = (x, y, z)/(1 − w)</code>, is conformal and maps circles of <code>S^3</code> to circles or lines of <code>R^3</code>: the fibre <code>{ z_1 = 0 }</code>, which contains the pole, becomes a straight line (the <code>z</code> axis), every other fibre a circle, and the latitude tori become nested tori of revolution about that line. <!-- MATH.md §3.3, §8.6 --></p>`,
});

// ---- Lifted 3D objects (MATH.md §9) ----------------------------------------------

const spherinder = shapeTopic({
  id: SHAPE_IDS.spherinder,
  title: 'Spherinder (ball × interval)',
  view: 'slice',
  viewNote: 'a ball that appears at full size, holds, and vanishes, unlike the hypersphere; in the projection view it is a sphere inside a sphere.',
  eli5: `
<p>Sweep a disc straight up and you get a can. Sweep a ball along the hidden direction and you get the spherinder. It is to the ball what a can is to a disc.</p>
<p>Pushed straight through our space it is a ball that appears at full size, stays exactly the same for a while, and vanishes, quite unlike the 4D ball, which grows and shrinks. Tilt it first and you see a stretched ball with two flat cuts.</p>
<p>Its shadow in perspective is a sphere inside a sphere, joined by spokes: the two ends of the sweep, one nearer the lamp than the other.</p> <!-- MATH.md §9.1 -->`,
  intermediate: `
<p>The extrusion of a ball of radius <code>r</code>: <code>P = B_r × [−h, h]</code>, hypervolume <code>(4/3) π r³ · 2h</code>. Its boundary is the lateral part <code>S² × [−h, h]</code> plus two ball-shaped caps at <code>w = ±h</code>. <!-- MATH.md §9.1 --></p>
<p>Slice by <code>w = c</code> with <code>|c| &lt; h</code>: the ball <code>B_r</code> itself, constant in size. Tilted (rotate in <code>XW</code>, <code>YW</code> or <code>ZW</code>): a sheared slab, an ellipsoid (the affine image of the ball) clipped between two parallel planes. Rotations in <code>XY</code>, <code>XZ</code>, <code>YZ</code> are symmetries. <!-- MATH.md §9.1 --></p>
<p>Projection: the two caps are spheres of radius <code>r</code> centred on the <code>w</code> axis at <code>w = ±h</code>; in perspective they are drawn at scales <code>d/(d − h)</code> and <code>d/(d + h)</code>, nested, joined by the lateral edges; orthographically they coincide. <!-- MATH.md §3.2, §9.1 --></p>`,
  math: `
<p><code>P = { (q, w) : |q| ≤ r, |w| ≤ h }</code>. Slice by <code>H(n, c)</code> with <code>n_w ≠ 0</code>: <code>{ (q, (c − n_xyz · q)/n_w) : |q| ≤ r, |c − n_xyz · q| ≤ h |n_w| }</code>. The map <code>q ↦ (q, (c − n_xyz · q)/n_w)</code> is affine and injective, so the image of the ball is an ellipsoid; its linear part stretches the direction <code>n_xyz</code> by <code>√(1 + |n_xyz|²/n_w²) = 1/|n_w|</code> and fixes the perpendicular directions, so in the chart (an isometry) the slice is the ellipsoid with semi-axes <code>r, r, r/|n_w|</code> clipped between the two planes <code>n_xyz · q = c ∓ n_w h</code>: the sheared slab of §9.1. For <code>n = e_w</code> and <code>|c| &lt; h</code> it is <code>B_r</code>; at <code>c = +h</code> the cap and at <code>c = −h</code> the empty set (limit from below). <!-- MATH.md §9.1, §4, §6 --></p>
<p><code>vol_4(P) = vol_3(B_r) · 2h = (8/3) π r³ h</code>, and <code>∫ A(c) dc</code> along <code>e_w</code> is <code>(4/3) π r³ · 2h</code>. <!-- MATH.md §7, §9.1 --></p>`,
});

const cubinder = shapeTopic({
  id: SHAPE_IDS.cubinder,
  title: 'Cubinder (cylinder × interval)',
  view: 'slice',
  viewNote: 'a cylinder that holds its shape while passing straight through; rotate in ZW and only its height changes.',
  eli5: `
<p>Sweep a can along the hidden direction and you get the cubinder. It is round in one pair of directions and box-like in the other pair: a disc times a rectangle.</p>
<p>Pushed straight through our space it is a can that appears, stays the same, and vanishes. Turn it with the <code>ZW</code> slider and the can stays perfectly round but gets taller or shorter as it passes. Tilt it with <code>XW</code> or <code>YW</code> and the round end is stretched into an oval and cut off by two flat planes.</p> <!-- MATH.md §9.1 -->`,
  intermediate: `
<p>The extrusion of a cylinder of radius <code>r</code> and height <code>H</code> (axis <code>z</code>): <code>P = D_r × [−H/2, H/2] × [−h, h]</code>, a disc in the <code>xy</code>-plane times a rectangle in the <code>zw</code>-plane, hypervolume <code>π r² H · 2h</code>. <!-- MATH.md §9.1 --></p>
<p>Slice by <code>w = c</code>, <code>|c| &lt; h</code>: the cylinder itself. A <code>ZW</code> rotation turns the rectangle within its own plane and leaves the disc alone, so every slice is still a circular cylinder of radius <code>r</code>; only its height changes. An <code>XW</code> or <code>YW</code> rotation tilts the disc and produces a sheared slab: an elliptic cylinder clipped between two parallel planes. <!-- MATH.md §9.1, §2.1 --></p>`,
  math: `
<p><code>P = D × Q</code> with <code>D = { x² + y² ≤ r² }</code> and <code>Q = [−H/2, H/2] × [−h, h]</code> in the <code>(z, w)</code> plane. <code>R_ZW(θ)</code> acts on <code>Q</code> alone, so the slice of the rotated solid by <code>w = c</code> is <code>D × { z : (z, c) ∈ R_ZW(θ) Q }</code>, a disc times an interval: a circular cylinder of radius <code>r</code> whose height is the length of the chord of the rotated rectangle at <code>w = c</code>. <!-- MATH.md §2.1, §4 --></p>
<p>For a hyperplane with <code>n_w ≠ 0</code> the general statement of §9.1 applies: the slice is the affine image of the cylinder under <code>q ↦ (q, (c − n_xyz · q)/n_w)</code>, clipped between the planes <code>n_xyz · q = c ∓ n_w h</code>. For <code>n = e_w</code>, <code>|c| &lt; h</code>, it is the cylinder; <code>vol_4(P) = π r² H · 2h</code>. <!-- MATH.md §9.1, §7 --></p>`,
});

const torusPrism = shapeTopic({
  id: SHAPE_IDS.torusPrism,
  title: 'Torus prism',
  view: 'slice',
  viewNote: 'a doughnut that holds its shape while passing straight through, and sheared or split rings when tilted; the projection view shows a doughnut inside a doughnut.',
  eli5: `
<p>A doughnut swept along the hidden direction. Pushed straight through our space, a doughnut appears, holds its shape, and vanishes.</p>
<p>Tilt it first and the slice becomes a stretched doughnut cut off by two flat planes; cut the right way it can split into two separate chunks, or show a ring with a hole in it, exactly as a knife through a doughnut can leave two pieces or a ring-shaped cut face.</p>
<p>Its shadow in perspective is a doughnut inside a doughnut, joined by spokes.</p> <!-- MATH.md §9.1 -->`,
  intermediate: `
<p>The extrusion of a torus with major radius <code>R</code> and minor radius <code>r</code> (volume <code>2π² R r²</code>): <code>P = T × [−h, h]</code>, hypervolume <code>2π² R r² · 2h</code>. The torus surface has Euler characteristic 0 and the solid has a hole, so its planar sections can have holes too (a horizontal cut through the middle is an annulus). <!-- MATH.md §9.1 --></p>
<p>Slice by <code>w = c</code>, <code>|c| &lt; h</code>: the torus itself. Tilted: a sheared slab, an affine image of the torus clipped between two parallel planes. The cap slices are planar sections of the torus, which the slicer assembles into closed loops and classifies as outer boundaries or holes by nesting parity before triangulating. <!-- MATH.md §9.1 --></p>`,
  math: `
<p>Torus <code>T</code>: boundary <code>((R + r cos v) cos u, (R + r cos v) sin u, r sin v)</code>, <code>R &gt; r</code>; <code>vol_3(T) = 2π² R r²</code> (Pappus: disc area <code>π r²</code> times the path <code>2π R</code> of its centre). <code>vol_4(T × [−h, h]) = 4π² R r² h</code>. <!-- MATH.md §9.1, §7 --></p>
<p>Cap at <code>w = w_0</code> meets <code>H(n, c)</code> in the plane <code>n_xyz · q = c − n_w w_0</code>; the section of <code>T</code> by a plane is found by intersecting each triangle of the mesh with it and chaining the segments into loops by shared mesh edge. For the plane <code>z = 0</code> the section is the annulus <code>R − r ≤ √(x² + y²) ≤ R + r</code>: two loops, the inner one a hole by nesting parity. For <code>n_w ≠ 0</code> the whole slice is the affine image of <code>T</code> clipped to a slab (§9.1). <!-- MATH.md §9.1 --></p>`,
});

const knotPrism = shapeTopic({
  id: SHAPE_IDS.knotPrism,
  title: 'Torus-knot prism',
  view: 'slice',
  viewNote: 'the knotted tube passing straight through unchanged, then sheared when tilted; the projection view nests two copies of the knot.',
  eli5: `
<p>Tie a knot in a tube, join its ends, and sweep the result along the hidden direction. Pushed straight through our space the knot appears, holds, and vanishes.</p>
<p>A famous fact about four dimensions: in 4D every knot can be untied without cutting, because there is room to lift one strand past another through the hidden direction. This viewer does not untie the knot; it only sweeps it, so every slice you see is still knotted.</p>
<p>Its shadow in perspective shows two copies of the knot, one inside the other, joined along the tube.</p> <!-- MATH.md §9.1 -->`,
  intermediate: `
<p>A <code>(p, q)</code> torus knot is a closed curve on a torus that winds <code>p</code> times around the axis and <code>q</code> times through the hole, with <code>p</code> and <code>q</code> coprime; <code>(2, 3)</code> is the trefoil. The solid is a tube of small radius around that curve, and the 4D shape is its extrusion <code>S × [−h, h]</code>. <!-- MATH.md §9.1 --></p>
<p>Slice by <code>w = c</code>, <code>|c| &lt; h</code>: the knotted tube itself. Tilted: a sheared slab of the tube, an affine image clipped between two parallel planes. Knottedness is a property of curves in 3-space: a knotted circle in <code>R^3</code> is always unknotted when viewed in <code>R^4</code>, but the extrusion copies the 3D tube level by level and does not use that freedom. <!-- MATH.md §9.1 --></p>`,
  math: `
<p>Carrier curve <code>c(t) = ((R + ρ cos qt) cos pt, (R + ρ cos qt) sin pt, ρ sin qt)</code>, <code>t ∈ [0, 2π)</code>, <code>gcd(p, q) = 1</code> (otherwise the curve retraces itself); the solid <code>S</code> is a closed tube around it, bounded by a torus-shaped mesh. The prism is <code>P = S × [−h, h]</code> with <code>vol_4 = vol_3(S) · 2h</code>. <!-- MATH.md §9.1, §7 --></p>
<p>Slicing follows §9.1: lateral prisms by marching tetrahedra, caps by planar sections of the tube chained into loops; for <code>n_w ≠ 0</code> the slice is the affine image of <code>S</code> clipped between the planes <code>n_xyz · q = c ∓ n_w h</code>, for <code>n = e_w</code> and <code>|c| &lt; h</code> it is <code>S</code>. Every knotted circle in <code>R^3 ⊂ R^4</code> bounds an embedded disc in <code>R^4</code> (knots of <code>S^1</code> in <code>R^4</code> are trivial), which is why "a knot in 4D" needs a 2-dimensional knotted object; this figure is not one, it is a product. <!-- MATH.md §9.1, §6 --></p>`,
});

const human = shapeTopic({
  id: SHAPE_IDS.human,
  title: 'Humanoid figure',
  view: 'slice',
  viewNote: 'the figure passing straight through unchanged, then as sheared slabs when tilted in XW, YW or ZW.',
  eli5: `
<p>There is no such thing as a 4D human, and this is not one. It is an ordinary 3D figure built from simple shapes, swept a little way along the hidden direction so that it has some 4D thickness.</p>
<p>Flat creatures living in the floor, watching a person sink through it, would see two footprints, then two oval slices through the legs, then a single larger slice through the body, changing as the person passed. We would see a four-dimensional being in the same way, as 3D slices. Here, pushed straight through, you see the whole figure unchanged for a while; tilt it to see sheared, cut-off versions.</p> <!-- MATH.md §9, §9.1 -->`,
  intermediate: `
<p>There is no canonical 4D version of a 3D object; the viewer makes an explicit, named choice. This figure is a humanoid assembled from 3D primitives and extruded along <code>w</code>: <code>P = S × [−h, h]</code>. <!-- MATH.md §9, §9.1 --></p>
<p>Slice by <code>w = c</code>, <code>|c| &lt; h</code>: the figure itself. Tilted: a sheared slab, an affine image of the figure clipped between two parallel planes, which is what the "pass-through" of a tilted prism always shows. In the projection view the two caps appear as nested copies of the figure under perspective. The alternative liftings MATH.md names (spinning about a plane, signed distance fields) are not in this build. <!-- MATH.md §9.1, §9.2, §9.3 --></p>`,
  math: `
<p><code>P = S × [−h, h]</code> for a closed, consistently oriented mesh bounding the 3D solid <code>S</code>; boundary <code>∂S × [−h, h] ∪ S × {−h} ∪ S × {+h}</code>; <code>vol_4(P) = vol_3(S) · 2h</code>. Slicing: lateral prisms by marching tetrahedra, caps by planar sections chained into loops and classified by nesting parity; for <code>n_w ≠ 0</code> the slice is the affine image of <code>S ∩ { c − n_w h ≤ n_xyz · q ≤ c + n_w h }</code> under <code>q ↦ (q, (c − n_xyz · q)/n_w)</code>, mapped through the chart. No further geometric claim is made: the construction is a product, and nothing about a "4D human" follows from it. <!-- MATH.md §9, §9.1, §7 --></p>`,
});

const mug = shapeTopic({
  id: SHAPE_IDS.mug,
  title: 'Mug',
  view: 'slice',
  viewNote: 'the mug passing straight through unchanged, and sheared slabs with a hole through the handle when tilted.',
  eli5: `
<p>A mug is not a 4D object, and there is no single right way to make one. This is an ordinary 3D mug shape, a solid cylinder with a ring handle (not hollowed out), swept a little way along the hidden direction.</p>
<p>Pushed straight through our space the whole mug is there, unchanged, for a while, then gone. Tilt it and you see a stretched mug cut off by two flat planes; where the cut passes through the handle, the slice has a hole in it.</p> <!-- MATH.md §9, §9.1 -->`,
  intermediate: `
<p>No canonical 4D mug exists; this one is the extrusion <code>P = S × [−h, h]</code> of a 3D mug built from primitives. The handle gives the solid a hole, so planar sections through it have holes, which the cap slicer detects by nesting parity before triangulating. <!-- MATH.md §9, §9.1 --></p>
<p>Slice by <code>w = c</code>, <code>|c| &lt; h</code>: the mug itself. Tilted: a sheared slab, an affine image of the mug clipped between two parallel planes. In perspective projection the two caps are nested copies of the mug. <!-- MATH.md §9.1, §3.2 --></p>`,
  math: `
<p><code>P = S × [−h, h]</code>, <code>vol_4 = vol_3(S) · 2h</code>; lateral boundary <code>∂S × [−h, h]</code> split into tets, caps <code>S × {±h}</code>. Cap sections by the plane <code>n_xyz · q = c − n_w w_0</code> are built by intersecting triangles, chaining by shared mesh edge, classifying loops as outer or hole by nesting parity and ear-clipping with holes; the handle's hole is a clockwise loop inside a counter-clockwise one. For <code>n_w ≠ 0</code> the slice is the affine image of <code>S</code> clipped to a slab (§9.1). <!-- MATH.md §9.1 --></p>`,
});

// ---- Registry -------------------------------------------------------------------

const EXPLAINERS: readonly Explainer[] = [
  intro,
  viewProjection,
  viewSlice,
  viewOverlay,
  ...rotations,
  liftExtrude,
  color,
  tesseract,
  cell5,
  cell16,
  cell24,
  cell600,
  cell120,
  hypersphere,
  duocylinder,
  hopf,
  spherinder,
  cubinder,
  torusPrism,
  knotPrism,
  human,
  mug,
];

const byId = new Map<string, Explainer>(EXPLAINERS.map((e) => [e.id, e]));
if (byId.size !== EXPLAINERS.length) throw new Error('explain/content: duplicate topic id');

export const getExplainer = (id: string): Explainer | undefined => byId.get(id);
export const listExplainers = (): Explainer[] => EXPLAINERS.slice();
