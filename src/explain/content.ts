/**
 * Explainer content: three tiers of HTML for every topic the viewer can show.
 * docs/MATH.md is the source of truth; HTML comments cite its sections
 * (`<!-- MATH.md §3.2 -->`). Fragments use simple elements only (h3, p, ul,
 * li, code, em, strong) and are trusted: they are authored here, not taken
 * from users. Formulas are plain text inside <code>, following MATH.md's
 * conventions: positive θ turns e_i toward e_j (§2.1), the composite order of
 * §2.2, perspective (x, y, z)·d/(d − w) (§3.2), the chart of §4, the
 * limit-from-below slicing convention of §6 and the colour encoding of §10.
 * The later topics follow §9.2 (spin and the mirror twins of a spun figure),
 * §9.3 (signed distance fields and the torus-like solids), §9.4 (clipping),
 * §11 (Flatland, the viewer one dimension down) and §12 (imported models);
 * the XR topic rests on the chart and orientation facts of §4 and §6 and the placement note of §12. Shape
 * parameters that MATH.md does not state (radii and heights of the figures)
 * are not quoted; the topics use the symbols of the section they follow.
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
<p>Colour is the clue to the hidden direction: blue means "behind our space", white means "right here", orange-red means "ahead". Pick a shape, drag the sliders, and this panel follows whatever you touch. The three buttons above change how much background the explanation assumes.</p>
<p>The shapes come from several families: the regular polytopes, round curved solids, ordinary 3D objects lifted into 4D by sweeping or by spinning, smooth blobs described by a rule, and models you bring yourself. Flatland mode shows the whole idea one dimension down, and with a headset you can stand next to the slice.</p> <!-- MATH.md §3, §4, §9, §10, §11, §12 -->`,
  intermediate: `
<p>A point of 4-space has four coordinates <code>(x, y, z, w)</code>. The viewer rotates the object in 4D and then shows it in 3D in one of two ways. <strong>Projection</strong> drops one dimension the way a camera does, either orthographically (just forget <code>w</code>) or in perspective from an eye on the <code>w</code> axis, so parts with larger <code>w</code> are drawn larger. <strong>Slicing</strong> intersects the object with our own 3-space, the hyperplane <code>w = c</code>; sliding <code>c</code> moves the object through. <!-- MATH.md §3, §4 --></p>
<p>Rotation in 4D happens in six coordinate planes, not about three axes. <code>XY</code>, <code>XZ</code> and <code>YZ</code> are the ordinary 3D rotations; <code>XW</code>, <code>YW</code> and <code>ZW</code> turn the object partly out of our space and produce the inside-out morphing that makes 4D animations look strange. <!-- MATH.md §2.1 --></p>
<p>Colour encodes <code>w</code>: in the projection view the <code>w</code> of each point after rotation (depth along the invisible axis), in the slice view the <code>w</code> the visible material came from inside the object. <!-- MATH.md §10 --></p>
<p>Shapes that are not polytopes enter in three ways. A 3D solid can be <em>lifted</em> into 4D: by extrusion, which sweeps it along <code>w</code>, or by spin, which turns it about a plane (a spun figure passes through our space as mirror twins). A solid can be given by a rule, a signed distance field, which the viewer samples on a grid. And a model you import is checked, centred and scaled to radius 1 before it is lifted. <!-- MATH.md §9.1, §9.2, §9.3, §12 --></p>
<p>Flatland mode runs the same construction with <code>R³</code> in place of <code>R⁴</code>, so that the analogy these explainers lean on can be watched; XR places what is drawn, the slice or the projection, in the room as a real 3D object. <!-- MATH.md §11, §12 --></p>
<p>Good first experiments: the tesseract with the <em>pass-through</em> preset in the slice view, then the <code>XW</code> slider, then the hypersphere.</p>`,
  math: `
<p>Points are <code>p ∈ R^4</code>; rotations are the special orthogonal matrices <code>R</code> with <code>R^T R = I</code>, <code>det R = +1</code>. The six sliders set plane rotations <code>R_ij(θ)</code> (§2.1) combined in the fixed order <code>M = R_ZW · R_YW · R_YZ · R_XW · R_XZ · R_XY</code>, <code>XY</code> applied first (§2.2). <!-- MATH.md §2 --></p>
<p>The projection view draws the rotated vertices <code>M p</code> through <code>P_d(x, y, z, w) = (x, y, z) · d/(d − w)</code> (perspective, eye at <code>(0, 0, 0, d)</code>), or <code>(x, y, z)</code> (orthographic), or <code>(x, y, z)/(1 − w)</code> (stereographic, for figures on the unit 3-sphere). <!-- MATH.md §3 --></p>
<p>The slice view intersects the rotated object with the hyperplane <code>H(e_w, c) = { q : q_w = c }</code>. Equivalently it slices the unrotated object with <code>H(M^T e_w, c)</code> and reads the result in the chart with basis <code>(M^T e_x, M^T e_y, M^T e_z)</code>, whose coordinates <code>(M^T e_k) · p = (M p)_k</code> are the viewer's <code>x, y, z</code> of the rotated point: for <code>M = I</code> this shows the object's own <code>x, y, z</code> unchanged (§4), and in general the slice appears exactly as the rotated object sits in our space. Every solid is a closed, outward-oriented tetrahedral boundary complex (§5), sliced by marching tetrahedra (§6); the result is a closed oriented triangle mesh whose signed volume is positive. <!-- MATH.md §4, §5, §6 --></p>
<p>The data are checked, not drawn by hand: hypervolumes come out as cone sums over boundary tets (§7) and agree with the catalogue of §8, and the slice volume integrates over <code>c</code> to the hypervolume along any direction (Cavalieri). <!-- MATH.md §7, §8 --></p>
<p>Solids that are not polytopes enter as lifts of a 3D solid <code>S</code> (extrusion <code>S × [−h, h]</code>, §9.1; spin about <code>z = 0</code>, §9.2), as the zero set of a field <code>f : R⁴ → R</code> sliced by marching tetrahedra on a grid and extracted to a tet complex by marching pentatopes (§9.3), or as imported closed meshes normalised to bounding radius 1 (§12). Flatland repeats §2 to §10 with <code>R³</code> in place of <code>R⁴</code> (§11). <!-- MATH.md §9, §11, §12 --></p>`,
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
<p>That move is called extrusion, and it is how the viewer turns ordinary 3D things (a ball, a doughnut, a mug) into 4D things. There is no single "right" 4D version of a 3D object; extrusion is one honest, clearly named choice, and spinning (its own topic) is another.</p>
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
<p>Hypervolume: <code>vol_4(P) = vol_3(S) · 2h</code>, consistent with the cone formula of §7 and the slice integral <code>∫ A(c) dc</code>. Two other liftings are described in their own topics: spinning <code>S</code> about a plane (§9.2) and signed distance fields (§9.3); an imported closed model may be lifted by extrusion or by spin (§12). <!-- MATH.md §7, §9.2, §9.3, §12 --></p>`,
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
<p>Slice by <code>w = c</code>, <code>|c| &lt; h</code>: the figure itself. Tilted: a sheared slab, an affine image of the figure clipped between two parallel planes, which is what the "pass-through" of a tilted prism always shows. In the projection view the two caps appear as nested copies of the figure under perspective. Spinning the same figure about a plane instead of extruding it gives the Spun human. <!-- MATH.md §9.1, §9.2 --></p>`,
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

// ---- Spin (MATH.md §9.2, §9.4) ------------------------------------------------------

const liftSpin = topic({
  id: 'lift:spin',
  title: 'Spin: turning a 3D solid about a plane',
  eli5: `
<p>Spin a half-disc about its straight edge and it sweeps out a ball. That is how a potter's wheel or a lathe turns a flat profile into a round solid: the edge stays put and everything else swings around it.</p>
<p>The viewer does the same one dimension up. Take a 3D object floating above the floor of our space and turn it, not about a line, but about the whole floor, swinging it out into the hidden direction and round again. A half-ball resting flat side down becomes the 4D ball. A whole ball floating above the floor becomes a 4D doughnut, a ring of balls. A cube becomes a ring of cubes.</p>
<p>A spun shape always passes through our space as <strong>mirror twins</strong>: the object and its reflection in the floor, side by side. Move the slice and the twins slide toward each other, join into one lump, and vanish once the slice passes the highest point of the object.</p>
<p>The object has to lie above the floor. If it crosses the floor, the viewer first cuts away the part below it, and tells you so.</p> <!-- MATH.md §9.2, §9.4 -->`,
  intermediate: `
<p>Take a solid <code>S</code> lying in the half-space <code>z ≥ 0</code> and sweep it about the plane <code>z = 0</code>: <code>spin(S) = { (x, y, z cos φ, z sin φ) : (x, y, z) ∈ S, φ ∈ [0, 2π) }</code>. The coordinates <code>x, y</code> never change; <code>(z, w)</code> turns as a pair, so every point of <code>S</code> traces a circle of radius <code>z</code> in the <code>ZW</code> plane. It is the 4D analogue of a solid of revolution: one dimension down, a half-disc spun about its diameter is a ball. <!-- MATH.md §9.2 --></p>
<p>Examples: a half-ball <code>{ |p| ≤ R, z ≥ 0 }</code> spun about its flat face is exactly the 4-ball; a ball of radius <code>r</code> centred at height <code>z_0 &gt; r</code> becomes a solid ring of balls with boundary <code>S² × S¹</code>, the 4D analogue of a solid torus (the smooth Torisphere is the same solid, turned); a cube becomes a ring of cubes, a square footprint times a flat ring; a solid torus with its axis along <code>z</code>, floating above the plane, becomes the smooth Tiger. A solid that crosses <code>z = 0</code> is first clipped to <code>z ≥ 0</code>, the cut being closed by a flat face, and the viewer says so. <!-- MATH.md §9.2, §9.3, §9.4 --></p>
<p>Slices. A point <code>(x, y, z)</code> lies in the slice <code>w = c</code> iff <code>(x, y, √(z² + c²))</code> lies in <code>S</code>: the slice is the part of <code>S</code> higher than <code>|c|</code>, with each height <code>ζ</code> replaced by <code>±√(ζ² − c²)</code>. At <code>c = 0</code> that is <code>S</code> together with its mirror image in <code>z = 0</code>, the <em>mirror twins</em>. As <code>|c|</code> grows the twins approach each other, join once <code>|c|</code> reaches the height of the lowest point of <code>S</code>, and vanish when <code>|c|</code> exceeds its greatest height. Width and length (<code>x</code> and <code>y</code>) are untouched; only the depth <code>z</code> is reshaped, and stretched. <!-- MATH.md §9.2 --></p>
<p>Hypervolume (Pappus): <code>vol_4(spin S) = 2π · z̄ · vol_3(S)</code>, the 3-volume of <code>S</code> times the length of the circle its centroid traces, <code>z̄</code> being the height of the centroid. A ball of radius <code>r</code> at height <code>z_0</code> gives <code>2π z_0 · (4/3)π r³</code>; the half-ball of radius <code>R</code> gives <code>2π · (3R/8) · (2/3)π R³ = π² R⁴ / 2</code>, the 4-ball. The viewer sweeps in <code>N</code> steps, so each point traces an <code>N</code>-gon, not a circle, and volumes come out multiplied by <code>(N/(2π)) sin(2π/N)</code>, slightly below 1 and close to it for large <code>N</code>. <!-- MATH.md §9.2, §8.5 --></p>`,
  math: `
<h3>Definition and boundary</h3>
<p><code>spin(S) = { (x, y, z cos φ, z sin φ) : (x, y, z) ∈ S, φ ∈ [0, 2π) }</code> for <code>S ⊂ { z ≥ 0 }</code>. Equivalently <code>(x, y, z, w) ∈ spin(S)</code> iff <code>(x, y, √(z² + w²)) ∈ S</code>, and <code>spin(S) = ∪_φ R_ZW(φ) S</code>, the union of the <code>ZW</code>-rotated copies of <code>S</code> (§2.1). Let <code>M</code> be the boundary mesh of <code>S</code> and <code>F ⊂ M</code> the part lying in the plane <code>z = 0</code>. Points of <code>F</code> are fixed by the spin and land in the interior of <code>spin(S)</code>, so the boundary of <code>spin(S)</code> is the spin of <code>M \\ F</code>: every triangle of <code>M</code> with at least one vertex at <code>z &gt; 0</code>. <!-- MATH.md §9.2 --></p>
<h3>Discretisation</h3>
<p>With <code>N</code> steps <code>φ_k = 2πk/N</code>, a vertex <code>(x, y, z)</code> maps to <code>v_k = (x, y, z cos φ_k, z sin φ_k)</code>, and a vertex with <code>z = 0</code> to the single point <code>(x, y, 0, 0)</code> for every <code>k</code>. Each triangle <code>(a, b, c)</code> of <code>M \\ F</code> and each step <code>k</code> gives the prism <code>(a_k, b_k, c_k, a_{k+1}, b_{k+1}, c_{k+1})</code>, split into three tets with a consistent diagonal rule. The lateral quads are planar trapezoids (<code>a_k a_{k+1}</code> and <code>b_k b_{k+1}</code> are both parallel to <code>(0, 0, cos φ_k − cos φ_{k+1}, sin φ_k − sin φ_{k+1})</code>), so the split is exact. A prism with a vertex at <code>z = 0</code> collapses to a pyramid; the tets with repeated vertices are dropped and the rest still close up. Orientation: the outward 4D normal of a lateral tet at step <code>k</code> is positively proportional to <code>(n_x, n_y, (n_z / cos(π/N)) cos φ_mid, (n_z / cos(π/N)) sin φ_mid)</code>, <code>φ_mid</code> the step's middle angle; its dot product with the spun triangle normal <code>(n_x, n_y, n_z cos φ_mid, n_z sin φ_mid)</code> is <code>n_x² + n_y² + n_z² / cos(π/N) &gt; 0</code>, so each tet is oriented by the sign of <code>cross4</code> of its edges against that spun normal (two vertices are swapped when the sign is wrong). <!-- MATH.md §9.2, §5.1 --></p>
<h3>Hypervolume</h3>
<p>Pappus: <code>vol_4(spin S) = 2π z̄ vol_3(S) = 2π ∫_S z dV</code>, since the volume element in the coordinates <code>(x, y, z, φ)</code> is <code>z dV dφ</code>. The discrete construction gives exactly <code>(N/(2π)) sin(2π/N)</code> times this, because each point sweeps an <code>N</code>-gon of circumradius <code>z</code>, of area <code>(N/2) z² sin(2π/N)</code>, instead of a disc of area <code>π z²</code>. Ball of radius <code>r</code> at height <code>z_0 &gt; r</code>: <code>2π z_0 · (4/3)π r³</code>. Half-ball <code>{ |p| ≤ R, z ≥ 0 }</code>: <code>2π · (3R/8) · (2/3)π R³ = π² R⁴ / 2</code>, the 4-ball of §8.5. A spun ball is not star-shaped about the origin, so the cone sum with absolute values would overcount; the signed sum of §7 (the 4D divergence theorem) is used, and holds for every closed outward-oriented complex. <!-- MATH.md §9.2, §7, §8.5 --></p>
<h3>Slices</h3>
<p>By <code>w = c</code>: <code>(x, y, z)</code> is in the slice iff <code>(x, y, √(z² + c²)) ∈ S</code>. Writing <code>ζ = √(z² + c²) ≥ |c|</code>, the slice is <code>{ (x, y, ±√(ζ² − c²)) : (x, y, ζ) ∈ S, ζ ≥ |c| }</code>. At <code>c = 0</code> it is <code>S</code> together with its mirror image in <code>z = 0</code>. The two halves meet in the plane <code>z = 0</code> exactly where <code>S</code> has a point at height <code>ζ = |c|</code>, that is (for connected <code>S</code>) for <code>z_min ≤ |c| ≤ z_max</code>, and the slice is empty for <code>|c| &gt; z_max</code>. For the ball of radius <code>r</code> at height <code>z_0</code> and <code>|c| &lt; z_0 − r</code> the slice is two balls of radius <code>r</code> at heights <code>±√(z_0² − c²)</code> up to the distortion <code>ζ ↦ √(ζ² − c²)</code>. Integrating the slice volume over <code>c</code> recovers the Pappus value. For the half-ball, <code>x² + y² + z² + c² ≤ R²</code> is a ball of radius <code>√(R² − c²)</code>, as §8.5 says. <!-- MATH.md §9.2, §8.5, §7 --></p>`,
});

const spunBall = shapeTopic({
  id: SHAPE_IDS.spunBall,
  title: 'Spun ball (ring of balls)',
  view: 'slice',
  viewNote: 'two mirror-twin balls that slide together, fuse and vanish as the offset moves out from zero; the projection view draws the spun copies of the ball.',
  eli5: `
<p>Float a ball above the floor and spin it about the floor, using the hidden direction. The ball sweeps out a ring of balls: a four-dimensional doughnut. A solid doughnut is a disc swept round a circle; this is a ball swept round a circle.</p>
<p>Pushed through our space it arrives as two balls of the same size: the ball and its mirror twin on the other side of the floor. Move the slice off the middle and the twins slide toward each other and stretch along the line joining them, until they touch and fuse into one blob that shrinks away to a point.</p>
<p>The ball floats completely clear of the floor, so at the start the twins are well apart.</p> <!-- MATH.md §9.2 -->`,
  intermediate: `
<p>The ball of radius <code>r</code> centred at height <code>z_0 &gt; r</code> above the plane <code>z = 0</code>, spun about that plane. In four coordinates it is <code>{ x² + y² + (√(z² + w²) − z_0)² ≤ r² }</code>: the points within <code>r</code> of the circle <code>z² + w² = z_0²</code> in the <code>ZW</code> plane, a ball swept round a circle. Its boundary is <code>S² × S¹</code>, so it is the 4D analogue of a solid torus; turned by a quarter turn in <code>XZ</code> together with a quarter turn in <code>YW</code> it is the smooth Torisphere. <!-- MATH.md §9.2, §9.3 --></p>
<p>Hypervolume <code>2π z_0 · (4/3)π r³</code> (Pappus: the centroid of the ball is at height <code>z_0</code>). Slices by <code>w = c</code> with <code>|c| &lt; z_0 − r</code> are two balls of radius <code>r</code> at heights <code>±√(z_0² − c²)</code>, up to the distortion of <code>√(z² + c²)</code>: each twin is stretched along <code>z</code>. The twins touch at <code>|c| = z_0 − r</code>, fuse into one body for <code>z_0 − r ≤ |c| &lt; z_0 + r</code> and vanish beyond <code>z_0 + r</code>. Integrating the slice volume over <code>c</code> recovers the Pappus value. <!-- MATH.md §9.2, §7 --></p>`,
  math: `
<p>Slice at <code>w = c</code>: <code>x² + y² + (√(z² + c²) − z_0)² ≤ r²</code>. With <code>ζ = √(z² + c²)</code> the slice is the set of <code>(x, y, ±√(ζ² − c²))</code> with <code>x² + y² + (ζ − z_0)² ≤ r²</code> and <code>ζ ≥ |c|</code>. The ball meets the heights <code>ζ ∈ [z_0 − r, z_0 + r]</code>. For <code>|c| &lt; z_0 − r</code> the slice therefore has two components (<code>z &gt; 0</code> and <code>z &lt; 0</code>), mirror images in <code>z = 0</code>; each spans <code>z ∈ [a, b]</code> with <code>a = √((z_0 − r)² − c²)</code> and <code>b = √((z_0 + r)² − c²)</code>, of length
<!-- b − a = (b² − a²)/(a + b) and b² − a² = (z_0 + r)² − (z_0 − r)² = 4 z_0 r; since a ≤ z_0 − r and b ≤ z_0 + r, a + b ≤ 2 z_0. -->
<code>b − a = 4 z_0 r/(a + b) ≥ 2r</code>, with equality only at <code>c = 0</code>: the stretch. At <code>|c| = z_0 − r</code> we have <code>a = 0</code> and the twins touch; for <code>z_0 − r ≤ |c| &lt; z_0 + r</code> the slice is one piece with <code>|z| ≤ b</code>; at <code>|c| = z_0 + r</code> we have <code>b = 0</code> and nothing is left. <!-- MATH.md §9.2 --></p>
<p>Hypervolume: <code>vol_4 = 2π z_0 · (4/3)π r³ = (8/3) π² z_0 r³</code>, which the signed cone sum of §7 reproduces (the solid is not star-shaped about the origin, so absolute values would overcount), up to the polygon factor <code>(N/(2π)) sin(2π/N)</code> of the discretisation. <!-- MATH.md §9.2, §7 --></p>
<p>Relation to the Torisphere: <code>T = R_YW(π/2) R_XZ(π/2)</code> acts as <code>(x, y, z, w) ↦ (−z, −w, x, y)</code> and carries the solid <code>{ (√(x² + y²) − R)² + z² + w² ≤ r² }</code> onto the spun ball with <code>z_0 = R</code>, because it exchanges the pair <code>(x, y)</code> with the pair <code>(z, w)</code> up to signs. The two are the same solid in different positions. <!-- MATH.md §2.1, §9.3 --></p>`,
});

const spunHalfBall = shapeTopic({
  id: SHAPE_IDS.spunHalfBall,
  title: 'Spun half-ball (the 4-ball again)',
  view: 'slice',
  viewNote: 'a ball that grows from a point and shrinks away, just like the Hypersphere; at the offset zero it is the half-ball and its mirror twin glued along the floor.',
  eli5: `
<p>Spin a half-disc about its straight edge and you get a ball. One dimension up, spin a half-ball about its flat face and you get the 4D ball.</p>
<p>Pushed through our space it behaves exactly like the hypersphere: a ball that grows from a point, reaches full size in the middle and shrinks away. The only trace of how it was made is at the middle, where the ball you see is the half-ball and its mirror twin glued together along the floor.</p>
<p>It is a second, quite different way of making the same shape, which makes a good check: two constructions, one solid.</p> <!-- MATH.md §9.2, §8.5 -->`,
  intermediate: `
<p>A point <code>(x, y, z, w)</code> lies in the spun half-ball <code>{ |p| ≤ R, z ≥ 0 }</code> iff <code>(x, y, √(z² + w²))</code> lies in the half-ball iff <code>x² + y² + z² + w² ≤ R²</code>. So the spun half-ball is the 4-ball of radius <code>R</code>. <!-- MATH.md §9.2, §8.5 --></p>
<p>Pappus agrees: the centroid of the half-ball is at height <code>3R/8</code> and its volume is <code>(2/3)π R³</code>, so <code>vol_4 = 2π · (3R/8) · (2/3)π R³ = π² R⁴ / 2</code>, the hypervolume of §8.5. The slice by <code>w = c</code> is a ball of radius <code>√(R² − c²)</code>; at <code>c = 0</code> it is the half-ball together with its mirror image, the two halves of one ball. <!-- MATH.md §9.2, §8.5 --></p>
<p>The Hypersphere is built differently, by subdividing the 16-cell's tets; here a polyhedral half-ball is spun in <code>N</code> steps. Both are polyhedral approximations that converge to the same exact values with refinement. <!-- MATH.md §8.5, §9.2 --></p>`,
  math: `
<p>Slice by <code>w = c</code>: <code>(x, y, z)</code> is in it iff <code>x² + y² + z² + c² ≤ R²</code>, a ball of radius <code>√(R² − c²)</code> and volume <code>(4/3)π (R² − c²)^{3/2}</code> for <code>|c| ≤ R</code>, and empty beyond. By §9.2's slice description this is the part of the half-ball higher than <code>|c|</code>, with heights replaced by <code>±√(ζ² − c²)</code>. <!-- MATH.md §9.2, §8.5 --></p>
<p>Pappus: <code>∫_S z dV = ∫_0^R z · π (R² − z²) dz = π R⁴/4</code> for the half-ball, so <code>vol_4 = 2π · π R⁴/4 = π² R⁴ / 2</code>. Cavalieri: <code>∫_{−R}^{R} (4/3)π (R² − c²)^{3/2} dc = π² R⁴ / 2</code>. The two agree with each other and with the 4-ball of §8.5. <!-- MATH.md §9.2, §7, §8.5 --></p>
<p>Discrete version: <code>N</code> spin steps of a polyhedral half-ball (clipped to <code>z ≥ 0</code> by §9.4) give a polyhedral 4-ball whose hypervolume is the Pappus value for the polyhedron times <code>(N/(2π)) sin(2π/N)</code>; both factors tend to 1 with refinement. <!-- MATH.md §9.2, §9.4 --></p>`,
});

const spunCube = shapeTopic({
  id: SHAPE_IDS.spunCube,
  title: 'Spun cube (ring of cubes)',
  view: 'slice',
  viewNote: 'two mirror-twin blocks that fatten, slide together, fuse into one slab and thin away; the projection view draws the spun copies of the cube.',
  eli5: `
<p>Float a cube above the floor and spin it about the floor. It sweeps out a ring made of cubes, one for every angle of the turn. Across the floor the ring is just the cube's square; in the other two directions, up from the floor and into the hidden direction, it is a flat ring like a washer.</p>
<p>Pushed through our space it arrives as the cube and its mirror twin. Move the slice off the middle and the two blocks fatten toward each other and slide together, fuse into one slab with the cube's square footprint, and the slab then thins away.</p>
<p>In the ideal ring every face stays perfectly flat in every slice: the blocks are boxes, not cubes, once the slice leaves the middle. The viewer spins in a finite number of steps, so what it draws is a close approximation of that.</p> <!-- MATH.md §9.2 -->`,
  intermediate: `
<p>A cube of side <code>s</code> centred at height <code>z_0 &gt; s/2</code>, spun about <code>z = 0</code>, is a product: <code>spin = [−s/2, s/2]² × { z_0 − s/2 ≤ √(z² + w²) ≤ z_0 + s/2 }</code>, the cube's square in the <code>xy</code> plane times a flat ring (an annulus) in the <code>zw</code> plane. Its hypervolume is <code>s² · π((z_0 + s/2)² − (z_0 − s/2)²) = 2π z_0 s³</code>, which is exactly Pappus: the cube's volume <code>s³</code> times the circle <code>2π z_0</code> traced by its centroid. <!-- MATH.md §9.2 --></p>
<p>For the ideal ring the slice by <code>w = c</code> is exact: the cube's faces at heights <code>z_0 ± s/2</code> become the flat planes <code>z = ±√((z_0 ± s/2)² − c²)</code>. For <code>|c| &lt; z_0 − s/2</code> there are two boxes with the cube's square footprint, thicker than <code>s</code> once <code>c ≠ 0</code>; for <code>z_0 − s/2 ≤ |c| &lt; z_0 + s/2</code> one slab <code>|z| ≤ √((z_0 + s/2)² − c²)</code>, thinning to nothing at <code>|c| = z_0 + s/2</code>. The viewer's <code>N</code>-step ring is a polygonal approximation of this. <!-- MATH.md §9.2 --></p>`,
  math: `
<p>A point <code>(x, y, z, w)</code> lies in the spun cube iff <code>(x, y, √(z² + w²))</code> lies in the cube, i.e. iff <code>|x|, |y| ≤ s/2</code> and <code>|√(z² + w²) − z_0| ≤ s/2</code>: a product of the square <code>[−s/2, s/2]²</code> and the annulus of radii <code>z_0 ∓ s/2</code>. The annulus has area <code>π((z_0 + s/2)² − (z_0 − s/2)²) = 2π z_0 s</code>, so <code>vol_4 = s² · 2π z_0 s = 2π z_0 s³ = 2π z̄ vol_3</code>. <!-- MATH.md §9.2 --></p>
<p>Slice by <code>w = c</code>: the square is untouched, and the annulus meets the line <code>w = c</code> where <code>z² ∈ [(z_0 − s/2)² − c², (z_0 + s/2)² − c²]</code>. With <code>a = √((z_0 − s/2)² − c²)</code> and <code>b = √((z_0 + s/2)² − c²)</code> the slice for <code>|c| &lt; z_0 − s/2</code> is the two boxes <code>[−s/2, s/2]² × ±[a, b]</code>, each of thickness
<!-- b − a = (b² − a²)/(a + b) = 2 z_0 s/(a + b) with a + b ≤ 2 z_0, so b − a ≥ s, equality only at c = 0. -->
<code>b − a = 2 z_0 s/(a + b) ≥ s</code>. For <code>z_0 − s/2 ≤ |c| &lt; z_0 + s/2</code> the inner radius is below <code>|c|</code> and the slice is the single slab <code>[−s/2, s/2]² × [−b, b]</code>, empty from <code>|c| = z_0 + s/2</code> on. Slice volume: <code>2 s² (b − a)</code> or <code>2 s² b</code>. <!-- MATH.md §9.2 --></p>
<p>Cavalieri: the length of the annulus's chord at <code>w = c</code>, integrated over <code>c</code>, is the annulus's area, so <code>∫ A(c) dc = s² · 2π z_0 s</code>, the Pappus value. The discretisation with <code>N</code> steps replaces the annulus by a polygonal ring and the value by <code>(N/(2π)) sin(2π/N)</code> times it. <!-- MATH.md §9.2, §7 --></p>`,
});

const spunHuman = shapeTopic({
  id: SHAPE_IDS.spunHuman,
  title: 'Spun human',
  view: 'slice',
  viewNote: 'the figure and its mirror twin drawing together and vanishing; its width and height never change, only its depth is stretched.',
  eli5: `
<p>A person is the best test of what spinning does, because you know what a person should look like. This is the same figure as the humanoid made by sweeping, but spun instead. It is first shifted away from the floor, in the direction it faces, so that no part touches the floor, and then every part is spun about the floor.</p>
<p>In the middle you see the figure and its mirror twin, reflected in the floor. Move the slice off the middle and the twins stay as wide and as tall as before, but get stretched in the direction pointing away from the floor, and draw together. The parts standing closest to the floor reach their twins first, and each part has vanished once the slice passes its greatest height above the floor.</p>
<p>There is no such thing as a 4D human. This is an ordinary 3D figure that has been spun, one honest choice among many.</p> <!-- MATH.md §9, §9.2 -->`,
  intermediate: `
<p>There is no canonical 4D version of a 3D object; spinning is an explicit, named choice. This figure is the humanoid of simple parts, each translated along its facing direction <code>+z</code> until the whole figure lies at <code>z &gt; 0</code>, then every part spun about the plane <code>z = 0</code> (§9.2). The facing direction is the one that becomes the spin's radial direction. The parts overlap at the joints and are drawn superimposed, as in the extruded humanoid. <!-- MATH.md §9, §9.2 --></p>
<p>Slice by <code>w = c</code>: each part contributes the part of itself higher than <code>|c|</code>, with each height <code>ζ</code> replaced by <code>±√(ζ² − c²)</code>. So the figure's width and height (<code>x</code> and <code>y</code>) never change, its depth is stretched, and at <code>c = 0</code> the slice is the figure together with its mirror image in <code>z = 0</code>. The twins approach each other, the parts nearest the floor joining their twins first (once <code>|c|</code> reaches a part's lowest point), and everything has vanished once <code>|c|</code> exceeds the figure's greatest height. <!-- MATH.md §9.2 --></p>`,
  math: `
<p>Each part <code>S_j</code> is a closed outward-oriented mesh lying in <code>z &gt; 0</code> after the translation, so no clipping is needed (§9.2 requires <code>S ⊂ { z ≥ 0 }</code>), and <code>spin(S_j)</code> is built as in §9.2 with <code>N</code> steps. The hypervolume of each part is <code>2π ∫_{S_j} z dV</code> (Pappus, up to the polygon factor <code>(N/(2π)) sin(2π/N)</code>); the parts overlap, so the sum over parts counts overlaps more than once and is not the hypervolume of the union. <!-- MATH.md §9.2 --></p>
<p>Slice: <code>(x, y, z) ∈ slice(S_j)</code> iff <code>(x, y, √(z² + c²)) ∈ S_j</code>. If <code>S_j</code> has depths <code>z ∈ [z_1, z_2]</code> at some <code>(x, y)</code>, the slice there has depths <code>±[√(z_1² − c²), √(z_2² − c²)]</code>, of total length <code>(z_2² − z_1²)/(√(z_1² − c²) + √(z_2² − c²))</code>, which grows with <code>|c|</code>: the stretch. The twins of part <code>j</code> meet in <code>z = 0</code> for <code>z_min(j) ≤ |c| ≤ z_max(j)</code> and the part has vanished for <code>|c| &gt; z_max(j)</code>. <!-- MATH.md §9.2 --></p>`,
});

// ---- Signed distance fields (MATH.md §9.3) -------------------------------------------

const sdf = topic({
  id: 'sdf',
  title: 'Signed distance fields: smooth shapes from a rule',
  eli5: `
<p>Every shape so far was built from flat pieces: corners, edges, flat faces. Here is another way to describe a shape. Instead of listing its pieces, give a rule that answers, for any point in space, "are you inside, and how far are you from the skin?" Such a rule can describe a perfectly smooth blob.</p>
<p>To draw it, the viewer lays a fine 3D grid of dots over our space, asks the rule about every dot, and stitches a skin of small flat triangles through the places where the answer flips from inside to outside. The skin is only an approximation of the true smooth surface: a finer grid sharpens it, at the price of more work.</p>
<p>Rules can be combined. Merge two shapes, keep only their overlap, carve one out of another, or blend two so that the join melts together like clay. The Creature is made that way; the torus-like shapes of this group are made by thickening a skin by a fixed distance.</p>
<p>For the slice view the viewer only has to ask the rule about points of our own space. For the shadow view it builds a skin of the whole 4D shape out of tiny four-cornered building blocks, a closed 3-dimensional surface sitting in 4D, and draws its corners and edges.</p> <!-- MATH.md §9.3 -->`,
  intermediate: `
<p>A signed distance field (SDF) describes a solid by a function <code>f : R⁴ → R</code> with <code>f ≤ 0</code> inside and <code>f &gt; 0</code> outside, whose size is the distance to the surface, or at least a bound on that distance, and which never changes faster than the distance moved (Lipschitz constant 1). The viewer's primitives are: the 4-ball <code>|p| − r</code>; the 4-box; the capsule (a ball swept along a segment); the duocylinder; and four torus-like solids made of all points within <code>r</code> of a sphere, a circle, the flat Clifford torus or an ordinary torus, called the spheritorus, torisphere, tiger and ditorus, each with its own topic. <!-- MATH.md §9.3 --></p>
<p>Operations: union is <code>min(f, g)</code>, intersection <code>max(f, g)</code>, difference <code>max(f, −g)</code>; a <em>smooth union</em> blends the two with a polynomial smooth minimum whose width <code>k</code> sets how far the join melts (the result is a bound, not an exact distance); translation, rotation and uniform scaling move the field. Unions and smooth unions of primitives give the blended Creature. <!-- MATH.md §9.3 --></p>
<p><strong>Slice view.</strong> On the slicing hyperplane the viewer defines <code>g(q) = f(c n + q_1 u_1 + q_2 u_2 + q_3 u_3)</code> on a grid over <code>[−R, R]³</code>, where <code>R</code> bounds the solid. It splits each grid cube into six tetrahedra, classifies each by the signs of <code>g</code> at its corners exactly as in §6, places crossing points by linear interpolation and orients every triangle toward the outside. This is marching tetrahedra on a grid. The drawn surface approximates the true slice and converges to it as the grid is refined. <!-- MATH.md §9.3, §6 --></p>
<p><strong>Projection view.</strong> The zero set of <code>f</code> is a closed 3-manifold in <code>R⁴</code>. The viewer extracts it on a 4D grid: each hypercube is split into 24 pentatopes (4-simplices), and each pentatope contributes nothing, one tet, or a prism of three tets, depending on how many of its five corners are outside. The result is a valid tetrahedral complex, the same kind of object as every polytope; its vertices and edges are drawn, coloured by <code>w</code>, and its hypervolume converges to the exact one with refinement. Slicing the complex and slicing the field directly agree to within both discretisations. <!-- MATH.md §9.3, §5.2 --></p>`,
  math: `
<h3>Fields</h3>
<p>All centred at the origin unless translated; <code>|·|</code> is the Euclidean norm. <!-- MATH.md §9.3 --></p>
<ul>
<li>4-ball radius <code>r</code>: <code>f = |p| − r</code>; 4-volume <code>π² r⁴ / 2</code>.</li>
<li>4-box, half-sizes <code>h</code>: <code>q_i = |p_i| − h_i</code>, <code>f = |max(q, 0)| + min(max_i q_i, 0)</code>; volume <code>16 h_1 h_2 h_3 h_4</code>.</li>
<li>Capsule, segment <code>ab</code>, radius <code>r</code>: <code>f = |p − a − t(b − a)| − r</code> with <code>t = clamp((p − a)·(b − a)/|b − a|², 0, 1)</code>; volume of a ball plus a cylinder, <code>π² r⁴/2 + (4/3)π r³ |b − a|</code>.</li>
<li>Duocylinder <code>r_1, r_2</code>: <code>max(√(x² + y²) − r_1, √(z² + w²) − r_2)</code>, a bound that is exact on the two tori of its boundary; volume <code>π² r_1² r_2²</code>.</li>
<li>Spheritorus <code>R, r</code> (tube around a sphere): <code>√((√(x² + y² + z²) − R)² + w²) − r</code>; volume <code>4π² R² r² + π² r⁴</code>.</li>
<li>Torisphere <code>R, r</code> (tube around a circle): <code>√((√(x² + y²) − R)² + z² + w²) − r</code>; volume <code>2πR · (4/3)π r³</code>.</li>
<li>Tiger <code>R_1, R_2, r</code> (tube around the Clifford torus): <code>√((√(x² + y²) − R_1)² + (√(z² + w²) − R_2)²) − r</code>; volume <code>4π³ R_1 R_2 r²</code>.</li>
<li>Ditorus <code>R_1, R_2, r</code> (tube around a torus): <code>√((√((√(x² + y²) − R_1)² + z²) − R_2)² + w²) − r</code>; volume <code>2πR_1 · 2πR_2 · π r²</code>.</li>
</ul>
<!-- The spheritorus line: the set is { ((s, w) in the disc (s − R)² + w² ≤ r²) × S² of radius s }, volume ∫∫ 4π s² ds dw over that disc = 4π (R² · π r² + π r⁴/4) = 4π² R² r² + π² r⁴ (the second moment of the disc about its centre is π r⁴/4). This is the leading term (sphere area 4π R²) times (normal disc area π r²) plus a curvature correction. This is the value the §9.3 table prints for the spheritorus; 2πR · (4/3)π r³ is the torisphere's. -->
<p>The volumes are by Pappus: the points within <code>r</code> of a circle of radius <code>R</code> are a 3-ball swept round the circle (torisphere); the tiger is the set within <code>r</code> of the flat Clifford torus, of area <code>4π² R_1 R_2</code>, with normal discs of area <code>π r²</code>, exact because the torus is flat and <code>r &lt; min(R_1, R_2)</code>; the ditorus is a circle swept twice. They hold while the normal discs do not overlap (<code>r &lt; R</code> for the torus-like ones). <!-- MATH.md §9.3 --></p>
<h3>Operations</h3>
<p>Union <code>min(f, g)</code>, intersection <code>max(f, g)</code>, difference <code>max(f, −g)</code>, smooth union <code>smin_k(f, g) = min(f, g) − h²/(4k)</code> with <code>h = max(k − |f − g|, 0)</code> (the polynomial smooth minimum; a bound, not a distance, and since <code>smin_k ≤ min</code> it only adds material), translation <code>f(p − t)</code>, rotation <code>f(M^T p)</code> (the shape turns by <code>M</code>), uniform scale <code>s · f(p/s)</code>. <!-- MATH.md §9.3 --></p>
<h3>Direct slicing</h3>
<p>On <code>H(n, c)</code> with chart basis <code>(u_1, u_2, u_3)</code>, <code>g(q) = f(c n + q_1 u_1 + q_2 u_2 + q_3 u_3)</code> on a grid over <code>[−R, R]³</code>. Each cube is split into six tets (the Kuhn/Freudenthal split along the main diagonal) and each tet classified by the signs of <code>g</code> at its corners as in §6 (zero counts as positive); an edge with differing signs crosses at <code>p + t (q − p)</code>, <code>t = g_p/(g_p − g_q)</code>, and each output triangle is oriented so that its normal points toward the positive (outside) corners. The result converges to the true slice as the grid is refined; for the 4-ball it is compared with <code>(4/3)π (r² − c²)^{3/2}</code>, and for every primitive the Cavalieri integral of the slices is compared with the 4-volume above, with tolerances tied to the grid spacing. <!-- MATH.md §9.3, §6, §7 --></p>
<h3>Extraction to a tet complex (marching pentatopes)</h3>
<p>On a 4D grid over <code>[−R, R]⁴</code> each hypercube splits into <code>4! = 24</code> pentatopes by the Freudenthal rule: the chains <code>p ≤ p + e_{σ(1)} ≤ … ≤ p + e_{σ(1)} + … + e_{σ(4)}</code> over permutations <code>σ</code>. The five corners are classified by sign; 0 or 5 positive corners emit nothing; 1 or 4 emit one tet on the four crossing points; 2 or 3 emit a triangular prism of six crossing points, split into three tets. For positives <code>{a, b}</code> and negatives <code>{c, d, e}</code> the two triangles of the prism are <code>(ac, ad, ae)</code> and <code>(bc, bd, be)</code>, joined along corresponding vertices. Each tet is oriented outward by the rule of §6 lifted one dimension: <code>cross4</code> of its edges must point toward the positive corners. The result is a valid tet complex (§5.2) and feeds the same slicer, hypervolume and wire machinery as every other shape. <!-- MATH.md §9.3, §5.2, §6 --></p>`,
});

const sdfSpheritorus = shapeTopic({
  id: SHAPE_IDS.sdfSpheritorus,
  title: 'Spheritorus (tube around a sphere)',
  view: 'slice',
  viewNote: 'a thick spherical shell that thins to a bare sphere and vanishes as the offset moves out; the projection view draws the vertices and edges of the extracted 4D surface.',
  eli5: `
<p>Take a hollow sphere, just the skin of a ball, in our 3D space. Thicken it in all four directions: include every point within a small distance of that skin. That is the spheritorus, a sphere-skin that also puffs out into the hidden direction.</p>
<p>Slice it through the middle and you get a thick-walled hollow ball, a spherical shell with an empty space inside. Slide the slice sideways in the hidden direction and the wall gets thinner and thinner until only the bare skin of a sphere is left, and then the slice is gone.</p>
<p>One dimension down the same thing is a doughnut: thicken a hoop (a circle) in 3D and you get a solid doughnut, and a flat sheet moved through it shows a ring that thins down to a bare circle.</p> <!-- MATH.md §9.3, §11 -->`,
  intermediate: `
<p>All points of <code>R⁴</code> within <code>r</code> of the 2-sphere of radius <code>R</code> lying in <code>w = 0</code>: <code>√((√(x² + y² + z²) − R)² + w²) ≤ r</code>, with <code>r &lt; R</code>. Its boundary is <code>S² × S¹</code> (each point of the sphere carries a little circle, made of the radial and the <code>w</code> direction). <!-- MATH.md §9.3 --></p>
<p>The slice by <code>w = c</code> is the spherical shell <code>R − a ≤ |q| ≤ R + a</code> with <code>a = √(r² − c²)</code>: thickest at <code>c = 0</code> (wall from <code>R − r</code> to <code>R + r</code>), thinning to the bare sphere of radius <code>R</code> as <code>|c| → r</code>, and empty beyond. <!-- MATH.md §9.3 --></p>
<p>Not to be confused with the Torisphere, which is a ball swept round a circle (and the same solid as the Spun ball): the two share a boundary type, <code>S² × S¹</code>, but their slices and their volumes differ. <!-- MATH.md §9.2, §9.3 --></p>`,
  math: `
<p>Field <code>f = √((|q| − R)² + w²) − r</code>, <code>q = (x, y, z)</code>. For <code>w = c</code>: <code>(|q| − R)² ≤ r² − c²</code>, i.e. <code>R − a ≤ |q| ≤ R + a</code>, <code>a = √(r² − c²)</code> for <code>|c| ≤ r</code>. <!-- MATH.md §9.3 --></p>
<p>Slice volume <code>A(c) = (4π/3)((R + a)³ − (R − a)³) = 8π R² a + (8π/3) a³</code>. With <code>∫_{−r}^{r} a dc = π r²/2</code> and <code>∫_{−r}^{r} a³ dc = 3π r⁴/8</code> the Cavalieri integral is <code>4π² R² r² + π² r⁴</code>, the 4-volume: the area <code>4π R²</code> of the sphere times the area <code>π r²</code> of the normal disc, plus the curvature correction <code>π² r⁴</code>. Equivalently <code>∫∫ 4π s² ds dw</code> over the disc <code>(s − R)² + w² ≤ r²</code>. <!-- MATH.md §9.3, §7 --></p>
<p>Topology: points are <code>((R + r cos θ) û, r sin θ)</code> with <code>û ∈ S²</code>, <code>θ ∈ [0, 2π)</code>: the boundary is <code>S² × S¹</code>, and the solid is <code>S² × D²</code>. The Torisphere is <code>S¹ × B³</code>: both have boundary <code>S² × S¹</code>, but the solids are not the same, and the 4-volume above is not <code>2πR · (4/3)π r³</code>, which belongs to the Torisphere. The marching-tetrahedra surface of the slice sharpens with the grid, and the extracted 4D complex converges in hypervolume to the value above. <!-- MATH.md §9.3 --></p>`,
});

const sdfTorisphere = shapeTopic({
  id: SHAPE_IDS.sdfTorisphere,
  title: 'Torisphere (ball swept round a circle)',
  view: 'slice',
  viewNote: 'a doughnut whose ring keeps its size while its tube shrinks to nothing as the offset moves out; the projection view draws the extracted 4D surface.',
  eli5: `
<p>Take a hoop (a circle) in our space and thicken it in all four directions: include every point within a small distance of the hoop. In four dimensions that puts a small ball at every point of the hoop. That is the torisphere: a ball swept round a circle. A solid doughnut is a disc swept round a circle; this is the 4D version, with a ball in place of the disc.</p>
<p>Slice through the middle and you get an ordinary doughnut. Slide the slice sideways in the hidden direction and the ring of the doughnut stays the same size while its dough gets thinner, down to a bare hoop, and then it is gone.</p>
<p>It is the same solid as the Spun ball, only turned so that the hoop lies in a different pair of directions. Tilt the torisphere by a quarter turn in XZ and in YW together and its slices become two mirror-twin balls.</p> <!-- MATH.md §9.2, §9.3 -->`,
  intermediate: `
<p>The set of points within <code>r</code> of the circle of radius <code>R</code> in the <code>xy</code> plane, <code>r &lt; R</code>: <code>(√(x² + y²) − R)² + z² + w² ≤ r²</code>, a 3-ball swept round a circle. Its boundary is <code>S¹ × S²</code>, so like the spun ball it is a 4D analogue of a solid torus. <!-- MATH.md §9.3 --></p>
<p>The slice by <code>w = c</code> is a solid torus of major radius <code>R</code> and minor radius <code>√(r² − c²)</code>: tube radius <code>r</code> at <code>c = 0</code>, shrinking to the bare circle as <code>|c| → r</code>. A quarter turn in <code>XZ</code> together with a quarter turn in <code>YW</code> exchanges the pair <code>(x, y)</code> with the pair <code>(z, w)</code> and carries it onto the Spun ball with <code>z_0 = R</code>. <!-- MATH.md §9.3, §9.2, §2.1 --></p>`,
  math: `
<p>Slice by <code>w = c</code>: <code>(√(x² + y²) − R)² + z² ≤ r² − c²</code>, the solid torus about the <code>z</code> axis with core circle of radius <code>R</code> and tube radius <code>a = √(r² − c²)</code>, volume <code>2π² R a²</code> (Pappus: disc area <code>π a²</code> times <code>2πR</code>). Cavalieri: <code>∫_{−r}^{r} 2π² R (r² − c²) dc = (8/3) π² R r³ = 2πR · (4/3)π r³</code>, the 4-volume of §9.3. <!-- MATH.md §9.3, §7 --></p>
<p>As a spin: the Spun ball of §9.2, <code>{ x² + y² + (√(z² + w²) − z_0)² ≤ r² }</code>, becomes this solid on exchanging <code>(x, y)</code> with <code>(z, w)</code>, which is <code>R_YW(π/2) R_XZ(π/2)</code>: <code>(x, y, z, w) ↦ (−z, −w, x, y)</code> is a rotation (det +1) of the kind §2.1 describes. So the Torisphere is <code>S¹ × B³</code>, the same solid as the spun ball with <code>z_0 = R</code>, and Pappus (<code>2π z_0 · (4/3)π r³</code>) gives the same volume. <!-- MATH.md §9.2, §9.3, §2.1 --></p>
<p>Needs <code>r &lt; R</code> so that the balls swept round the circle do not overlap. <!-- MATH.md §9.3 --></p>`,
});

const sdfTiger = shapeTopic({
  id: SHAPE_IDS.sdfTiger,
  title: 'Tiger (tube around the Clifford torus)',
  view: 'slice',
  viewNote: 'two solid doughnuts, stacked on one axis, that thicken, slide together and fuse into one as the offset moves out; the projection view draws the extracted 4D surface.',
  eli5: `
<p>The Clifford torus is the doughnut skin from the duocylinder: a surface that is round in two independent ways at once. Thicken it by a small distance in all directions and you get the tiger.</p>
<p>Slice it through the middle and you see two solid doughnuts, one above the other on the same axis, mirror images of each other. Why two? The middle slice cuts the Clifford torus in two circles, one above and one below, and thickening a circle gives a doughnut.</p>
<p>Slide the slice sideways in the hidden direction and the two doughnuts thicken and slide toward each other, touch, and fuse into one fat doughnut, which then thins away to a bare hoop and vanishes.</p> <!-- MATH.md §9.3, §8.6 -->`,
  intermediate: `
<p>The points within <code>r</code> of the flat torus <code>{ √(x² + y²) = R_1, √(z² + w²) = R_2 }</code> (the Clifford torus of §8.6 when <code>R_1 = R_2 = 1/√2</code>), with <code>r &lt; min(R_1, R_2)</code>: <code>(√(x² + y²) − R_1)² + (√(z² + w²) − R_2)² ≤ r²</code>. It is also a spun solid: a solid torus about the <code>z</code> axis with core circle of radius <code>R_1</code> at height <code>R_2</code> and tube radius <code>r</code>, spun about the plane <code>z = 0</code> (§9.2). <!-- MATH.md §9.3, §9.2, §8.6 --></p>
<p>Slice by <code>w = c</code>. At <code>c = 0</code> the condition is <code>(ρ − R_1)² + (|z| − R_2)² ≤ r²</code> with <code>ρ = √(x² + y²)</code>: two round solid tori with major radius <code>R_1</code> and tube radius <code>r</code>, coaxial about the <code>z</code> axis and mirror images at heights <code>z = ±R_2</code>. For <code>c ≠ 0</code> they are distorted (stretched along <code>z</code>): they approach each other, touch when <code>|c| = R_2 − r</code>, fuse into one ring-shaped body for <code>R_2 − r ≤ |c| &lt; R_2 + r</code>, and vanish beyond <code>R_2 + r</code>. <!-- MATH.md §9.3, §9.2 --></p>`,
  math: `
<p>Write <code>ρ = √(x² + y²)</code>. At <code>w = c</code> the field is <code>√((ρ − R_1)² + (ζ − R_2)²) − r</code> with <code>ζ = √(z² + c²) ≥ |c|</code>, so the slice is <code>{ (ρ, z) : (ρ − R_1)² + (ζ − R_2)² ≤ r², ζ ≥ |c| }</code> revolved about the <code>z</code> axis, with <code>z = ±√(ζ² − c²)</code>. The disc of radius <code>r</code> about <code>(R_1, R_2)</code> lies in <code>ζ ≥ R_2 − r</code>. If <code>|c| &lt; R_2 − r</code> it lies entirely above <code>ζ = |c|</code> and the slice is two components, one with <code>z &gt; 0</code> and its mirror; at <code>c = 0</code> each is exactly a round solid torus with tube radius <code>r</code> at <code>z = ±R_2</code>. At <code>|c| = R_2 − r</code> the disc just reaches <code>ζ = |c|</code> and the components touch on the circle <code>ρ = R_1, z = 0</code>; for <code>R_2 − r ≤ |c| &lt; R_2 + r</code> the disc is cut by <code>ζ = |c|</code> and the two halves join across <code>z = 0</code> into one body; for <code>|c| &gt; R_2 + r</code> nothing is left. <!-- MATH.md §9.3, §9.2 --></p>
<p>Geometry: the flat torus <code>(R_1 cos α, R_1 sin α, R_2 cos β, R_2 sin β)</code> meets <code>w = 0</code> where <code>sin β = 0</code>, in the two circles <code>β = 0</code> and <code>β = π</code>, at <code>z = ±R_2</code>; the tube around each is a solid torus. The boundary points are <code>((R_1 + r cos θ) cos α, (R_1 + r cos θ) sin α, (R_2 + r sin θ) cos β, (R_2 + r sin θ) sin β)</code>, a product of three circles. <!-- MATH.md §9.3, §8.6 --></p>
<p>Volume: <code>∫∫ (2πρ_1)(2πρ_2) dρ_1 dρ_2</code> over the disc of radius <code>r</code> about <code>(R_1, R_2)</code> is <code>4π² R_1 R_2 · π r² = 4π³ R_1 R_2 r²</code>, the cross terms vanishing by symmetry; this is the area of the flat torus times the area of the normal disc, exact because the torus is flat and <code>r &lt; min(R_1, R_2)</code>. As a spun solid (§9.2): the solid torus at height <code>R_2</code> has volume <code>2π² R_1 r²</code> and centroid height <code>R_2</code>, so Pappus gives <code>2π R_2 · 2π² R_1 r² = 4π³ R_1 R_2 r²</code>. <!-- MATH.md §9.3, §9.2 --></p>`,
});

const sdfDitorus = shapeTopic({
  id: SHAPE_IDS.sdfDitorus,
  title: 'Ditorus (tube around a torus)',
  view: 'slice',
  viewNote: 'a hollow doughnut whose wall thins to nothing as the offset moves out; the projection view draws the extracted 4D surface.',
  eli5: `
<p>Take the skin of an ordinary doughnut in our 3D space and thicken it in all four directions: every point within a small distance of that skin belongs to the ditorus.</p>
<p>Slice through the middle and you get a doughnut-shaped shell with a thick wall and a doughnut-shaped empty space inside. Slide the slice sideways in the hidden direction and the wall gets thinner and thinner, down to the bare doughnut skin, and then there is nothing.</p>
<p>It is sometimes described as a circle swept twice: sweep a small disc round a circle to make a doughnut, then sweep that doughnut round a second, larger circle.</p> <!-- MATH.md §9.3 -->`,
  intermediate: `
<p>The points within <code>r</code> of a torus of major radius <code>R_1</code> and minor radius <code>R_2</code> lying in <code>w = 0</code>. Writing <code>s</code> for the distance of a point's <code>(x, y, z)</code> from the torus's core circle, it is <code>(s − R_2)² + w² ≤ r²</code>. It needs <code>r &lt; R_2</code> (the normal discs of the torus do not overlap) and <code>R_2 + r &lt; R_1</code> (the torus does not reach the axis). <!-- MATH.md §9.3 --></p>
<p>The slice by <code>w = c</code> is the hollow torus <code>R_2 − a ≤ s ≤ R_2 + a</code>, <code>a = √(r² − c²)</code>: a doughnut-shaped shell whose wall is thickest at <code>c = 0</code> and thins to the bare torus surface of tube radius <code>R_2</code> as <code>|c| → r</code>, then vanishes. Its boundary has two nested torus surfaces. <!-- MATH.md §9.3 --></p>`,
  math: `
<p>Field <code>f = √((s − R_2)² + w²) − r</code> with <code>s = √((√(x² + y²) − R_1)² + z²)</code>. At <code>w = c</code>: <code>(s − R_2)² ≤ r² − c²</code>, i.e. <code>R_2 − a ≤ s ≤ R_2 + a</code> with <code>a = √(r² − c²)</code>, <code>|c| ≤ r</code>. <!-- MATH.md §9.3 --></p>
<p>Volume as a circle swept twice: in the three coordinates <code>(ρ, z, w)</code>, <code>ρ = √(x² + y²)</code>, the region <code>(s − R_2)² + w² ≤ r²</code> is a solid torus <code>B</code> (a disc of radius <code>r</code> in the <code>(s, w)</code> plane swept round the circle <code>s = R_2</code> in <code>w = 0</code>, centred on the point <code>(ρ, z) = (R_1, 0)</code>), of volume <code>2πR_2 · π r²</code> and centroid at <code>ρ = R_1</code>. Sweeping <code>B</code> once round the <code>z</code> axis multiplies by <code>2π ρ</code>, so <code>vol_4 = 2π R_1 · 2π R_2 · π r²</code>, valid while <code>R_2 + r &lt; R_1</code> keeps <code>ρ &gt; 0</code> on <code>B</code>. <!-- MATH.md §9.3 --></p>
<p>Slices: <code>{ R_2 − a ≤ s ≤ R_2 + a }</code> is the difference of two solid tori with the same core circle (radius <code>R_1</code>) and tube radii <code>R_2 + a</code> and <code>R_2 − a</code>, so by Pappus <code>A(c) = 2π² R_1 ((R_2 + a)² − (R_2 − a)²) = 8π² R_1 R_2 a</code>, and <code>∫_{−r}^{r} A(c) dc = 8π² R_1 R_2 · π r²/2 = 4π³ R_1 R_2 r²</code>, the volume above. The wall is thin compared with the whole, so the slice needs a fine grid to resolve it; the marching-tetrahedra surface sharpens as the grid is refined. <!-- MATH.md §9.3, §7 --></p>`,
});

const sdfCreature = shapeTopic({
  id: SHAPE_IDS.sdfCreature,
  title: 'Creature (blended capsules)',
  view: 'slice',
  viewNote: 'the arms and head vanish, the body shrinks and a leg appears; the slices at positive and negative offsets are different shapes.',
  eli5: `
<p>A creature made by melting simple blobs together: a round body, a round head, two arms and two legs, each a ball or a sausage-shaped capsule, blended so the joins are smooth, like clay.</p>
<p>The arms lie in our own space, but the legs reach out into the hidden direction, one to each side of our space, and the two legs are different. Pushed through our space, the creature first shows body, head and arms; as the slice moves on, the arms and the head vanish, the body shrinks, and a leg appears. Push it the other way and a different leg appears instead, so the two sides of the middle are not mirror images.</p>
<p>Blending is why this shape is made from a rule instead of from flat pieces: melting two shapes together is a single line of arithmetic on their fields.</p> <!-- MATH.md §9.3 -->`,
  intermediate: `
<p>The creature is a smooth union (§9.3) of capsules, each a ball when its two ends coincide: a body ball, a head ball above it, two arm capsules lying in <code>w = 0</code>, and two leg capsules reaching into <code>+w</code> and <code>−w</code>, deliberately unequal so that the slices at <code>+w</code> and <code>−w</code> differ. A capsule is the set of points within <code>r</code> of a segment <code>ab</code>; the blend width <code>k</code> of the smooth union sets how far the joins melt. <!-- MATH.md §9.3 --></p>
<p>A part contributes to the slice <code>w = c</code> only while <code>c</code> lies between its smallest and largest <code>w</code>, widened by its radius. A ball centred at <code>w = 0</code> slices to a ball of radius <code>√(r² − c²)</code>, so the head and arms vanish first and the body shrinks; a leg running along <code>w</code> appears as an elongated blob, stretched along the leg's direction, mostly on its own side of <code>w = 0</code>. The blend adds a little material where parts meet. <!-- MATH.md §9.3 --></p>`,
  math: `
<p>Capsule field <code>f_i = |p − a − t(b − a)| − r</code>, <code>t = clamp((p − a)·(b − a)/|b − a|², 0, 1)</code>, an exact distance (a ball is <code>a = b</code>). The creature's field is the left fold <code>smin_k(…smin_k(smin_k(f_1, f_2), f_3)…, f_n)</code> with <code>smin_k(f, g) = min(f, g) − h²/(4k)</code>, <code>h = max(k − |f − g|, 0)</code>. Since <code>h²/(4k) ≥ 0</code> the blended solid contains the plain union of the parts; where two fields are equal (<code>h = k</code>) the field is lowered by <code>k/4</code>. The result is a bound, not a distance. <!-- MATH.md §9.3 --></p>
<p>Slice by <code>w = c</code>: a ball of radius <code>r</code> centred at <code>(q_0, w_0)</code> slices to a ball of radius <code>√(r² − (c − w_0)²)</code> about <code>q_0</code>, present for <code>|c − w_0| ≤ r</code>. For a capsule with <code>a_w ≠ b_w</code> the slice is the set of points of <code>H</code> within <code>r</code> of the segment, an elongated blob. The <code>w</code>-range of a part is <code>[min(a_w, b_w) − r, max(a_w, b_w) + r]</code>; outside it the part contributes nothing, so a deliberately asymmetric choice of the two legs' <code>w</code>-ranges makes the slices at <code>+w</code> and <code>−w</code> differ. The blend margin adds a little to each range, which is why the grids cover the parts' box padded by that margin. <!-- MATH.md §9.3 --></p>
<p>Slicing and extraction are as in the signed-distance-field topic: marching tetrahedra on a grid for the slice view, marching pentatopes for the wire; both approximate the smooth surface and sharpen with resolution. <!-- MATH.md §9.3 --></p>`,
});

// ---- Imported models (MATH.md §12) and XR -----------------------------------------------

const importModel = topic({
  id: 'import',
  title: 'Importing a 3D model',
  eli5: `
<p>You can bring your own 3D model, a file made in other software, and watch it become a four-dimensional object. The viewer reads the common model formats: OBJ, and glTF or GLB.</p>
<p>First it tidies the model. Corners that sit at the same place are stitched together, so that neighbouring triangles really share their edges. The model is then centred and resized so that it just fits inside a ball of radius 1: a huge model and a tiny one come out the same size.</p>
<p>Then it checks that the surface is closed, like a balloon with no holes, so that "inside" means something. A closed model can be lifted into 4D by sweeping (extrusion) or by spinning, and its slices are filled solids. An open model, such as a bare sheet or a shell with a gap in it, can still be viewed, but its slices are only thin skins with nothing inside, and the viewer says so.</p>
<p>If a model arrives inside out, with its triangles facing inward, the viewer turns them around.</p> <!-- MATH.md §12, §9.1 -->`,
  intermediate: `
<p>A model arrives as triangles (OBJ or glTF/GLB). It is <em>welded</em> by position, so that vertices at the same place become one; <em>re-centred</em> at the centre of its bounding box; and <em>scaled</em> so that its bounding radius, the distance of its farthest vertex from the centre, is 1. <!-- MATH.md §12 --></p>
<p>It is then validated: every edge must belong to exactly two triangles, running in opposite directions in them. That is the requirement of the lifting of §9.1, a closed, consistently oriented mesh bounding a solid. If the signed volume of a closed model is negative its triangles are reversed, so that outward orientation holds. <!-- MATH.md §12, §9.1 --></p>
<p>A closed model may be lifted by extrusion (§9.1) or by spin (§9.2, after clipping to <code>z ≥ 0</code>, §9.4). The caps of an extrusion, and the cut that closes a clipped solid for spin, are planar sections chained into closed loops; that needs a closed surface. An open model can still be projected (the lateral structure of the extrusion needs no caps) and sliced without caps, and then its slices are open surfaces, not filled solids; the viewer says so. <!-- MATH.md §12, §9.1, §9.2, §9.4 --></p>`,
  math: `
<h3>Normalisation</h3>
<p>Welding identifies vertices of equal position. With <code>c</code> the centre of the axis-aligned bounding box, the model is mapped by <code>v ↦ (v − c)/ρ</code> with <code>ρ = max |v − c|</code>, so that the bounding radius, the largest vertex norm, is 1. <!-- MATH.md §12 --></p>
<h3>Validation</h3>
<p>For each undirected edge <code>{a, b}</code> the directed edges <code>(a, b)</code> and <code>(b, a)</code> must each occur exactly once among the triangle boundaries: every edge belongs to exactly two triangles with opposite directions, the closed, consistently oriented mesh of §9. The signed volume is <code>Σ v_0 · (v_1 × v_2)/6</code> over the triangles; if it is negative every triangle is reversed (two vertices swapped), so that the outward normals are outward. <!-- MATH.md §12, §9 --></p>
<h3>What each lifting needs</h3>
<p>Extrusion (§9.1): the lateral part <code>M × [−h, h]</code> is built per triangle with orientation derived from <code>M</code>, and needs no caps; the caps <code>S × {±h}</code> are sliced by planar sections of <code>S</code>, segments chained into loops by shared mesh edge, which closes only for a closed mesh. Spin (§9.2): the solid must lie in <code>z ≥ 0</code>, so a solid crossing <code>z = 0</code> is first clipped by the plane (§9.4), the cut closed by its planar section. An open model has no solid <code>S</code>, so it keeps the lateral structure only: projection works, slicing yields open surfaces without caps, and the viewer says so. <!-- MATH.md §12, §9.1, §9.2, §9.4 --></p>`,
});

const xr = topic({
  id: 'xr',
  title: 'XR: standing next to the slice',
  eli5: `
<p>On a flat screen a 3D object is only a picture of a solid. With a VR headset, in a browser that supports WebXR, the viewer can place the slice, or the shadow, in the room around you as a real object: you can walk around it, bend down to look underneath, and lean in to look inside.</p>
<p>That suits the slice view especially well. A slice is a genuine 3D shape, the piece of a 4D object that is inside our space at that moment, so it is exactly the kind of thing a room can hold, at the proportions it really has.</p>
<p>You still cannot see the fourth direction itself. What changes is how you explore it: whatever moves the slice, the offset slider, an animation, a tilt in XW, YW or ZW, changes the object in front of you, and you watch it grow, split, merge and vanish while you stand beside it, the way flat creatures would watch a ball pass through their sheet.</p> <!-- MATH.md §4, §6 -->`,
  intermediate: `
<p>The slice view shows the intersection of the rotated object with the hyperplane <code>w = c</code>, and that intersection is a closed, oriented triangle mesh in 3D: a real 3D solid, not a picture of one. The chart that carries the slice into <code>R³</code> is an isometry, so lengths, angles and volumes in the slice are those of the 4D object's section, with no perspective distortion. The projection view is different: perspective scales every point by <code>d/(d − w)</code>, which distorts. <!-- MATH.md §4, §3.2, §6 --></p>
<p>XR puts whatever the viewer is drawing, the slice or the projection, in the room as a real object by a rigid motion and one uniform scale, seen with a separate view for each eye and with your own movement around it. That adds the depth cues and the parallax of ordinary 3D viewing, which a screen can only imitate; it does not add a fourth dimension. The fourth direction is still reached through the slice offset and the <code>XW</code>, <code>YW</code>, <code>ZW</code> rotations, which change which part of the object is in the slice. <!-- MATH.md §4, §6 --></p>
<p>The chart is chosen with <code>det(u_1, u_2, u_3, n) = +1</code>, so the slice is not mirrored, and its signed volume is positive; a handed object appears with its true handedness in the room. <!-- MATH.md §4, §6 --></p>`,
  math: `
<p>A slice vertex is <code>chart(p) = (u_1 · p, u_2 · p, u_3 · p)</code> for the orthonormal basis <code>(u_1, u_2, u_3)</code> of <code>n^⊥</code>, an isometry of <code>H</code> onto <code>R³</code> (§4). The basis has <code>det(u_1, u_2, u_3, n) = +1</code>, so the chart preserves orientation, and the triangles are oriented outward so that the signed volume <code>Σ v_0 · (v_1 × v_2)/6</code> of the slice is positive (§6). These are exactly the properties a mesh needs to be placed in a room as a solid: closed, outward-oriented, true proportions up to one overall scale, which is a choice of presentation. A WebXR session adds no mathematics: the drawn slice or projection is placed in the room by a rigid motion and a uniform scale (§12). <!-- MATH.md §4, §6, §12 --></p>
<p>Each eye sees the same mesh from its own viewpoint by ordinary 3D perspective, a map of <code>R³</code> to an image that depends only on the eye position. This is unlike the 4D perspective <code>P_d(x, y, z, w) = (x, y, z) · d/(d − w)</code> of §3.2, which maps <code>R⁴</code> to <code>R³</code> and so discards a dimension; a slice is already a subset of a 3D space and needs no such map. <!-- MATH.md §3.2, §4 --></p>`,
});

// ---- Flatland mode (MATH.md §11) -------------------------------------------------------

const flatIntro = topic({
  id: 'flat:intro',
  title: 'Flatland: the viewer one dimension down',
  eli5: `
<p>Flatland mode is the same viewer, one dimension down. The world is a flat sheet. The thing being examined is an ordinary 3D solid, such as a cube or a ball, standing in for the 4D object. What you see on the canvas is what a creature living in the sheet could see of it.</p>
<p>A flat creature has the same two honest ways of seeing a 3D solid that we have for a 4D one: a shadow of it (the projection view) and a slice, the part of the solid that is in the sheet right now (the slice view). The overlay view draws both. Colour does the same job as before: it says how far above or below the sheet a point is, the direction the creature cannot see.</p>
<p>The point of it is that here you can check the idea against your own eyes, because you know what a cube or a ball is really like. Then read the same sentence one dimension up, and you know what a 4D object does to us.</p>
<p>Known answers to try: a cube seen under a lamp above it is a square inside a square; a cube pushed corner first through the sheet shows a point, a triangle, a hexagon, a triangle, and a point. The tesseract does the same one dimension up: point, tetrahedron, truncated tetrahedron, octahedron, and back.</p> <!-- MATH.md §11, §8.4 -->`,
  intermediate: `
<p>Flatland repeats the whole construction with <code>R³</code> in place of <code>R⁴</code> and <code>R²</code> in place of <code>R³</code>. A 3D solid plays the higher-dimensional object, its boundary mesh of triangles plays the tetrahedral complex, and Flatland is the plane <code>z = 0</code>. <!-- MATH.md §11 --></p>
<ul>
<li><strong>Rotations.</strong> Three planes instead of six: <code>XY</code>, the only rotation Flatlanders have, and <code>XZ</code> and <code>YZ</code>, which turn the solid partly out of their world, the analogues of <code>XW</code>, <code>YW</code>, <code>ZW</code>. <!-- MATH.md §11, §2.1 --></li>
<li><strong>Projection.</strong> Orthographic <code>(x, y, z) ↦ (x, y)</code>, or perspective from an eye at <code>(0, 0, d)</code>: <code>(x, y) · d/(d − z)</code>. The cube <code>[−1, 1]³</code> from <code>d = 3</code> is the square inside a square, at scales <code>3/2</code> and <code>3/4</code>. <!-- MATH.md §11, §3.2 --></li>
<li><strong>Slicing.</strong> The plane <code>{ q : m · q = k }</code>; its slice is a planar section of the closed mesh, drawn as filled polygons. <!-- MATH.md §11, §9.1 --></li>
<li><strong>Colour</strong> encodes <code>z</code>, exactly as <code>w</code> in the 4D viewer. <!-- MATH.md §10, §11 --></li>
</ul>
<p>Known answers: the cube sliced by <code>z = c</code>, <code>|c| &lt; 1</code>, is a square of area 4; by the plane through the origin with normal <code>(1, 1, 1)/√3</code>, a regular hexagon of area <code>3√3</code>; moving that plane from one corner to the opposite one, point, triangle, hexagon, triangle, point, the analogue of the tesseract's sequence. A ball of radius <code>R</code> gives discs of area <code>π(R² − c²)</code>. The integral of the slice area over the offset is the 3-volume. <!-- MATH.md §11, §8.4 --></p>`,
  math: `
<p>Everything of §2 to §10 with <code>R^3</code> in place of <code>R^4</code> and <code>R^2</code> in place of <code>R^3</code>. A 3D solid is a closed, outward-oriented triangle mesh (§9); the mesh plays the role of the tet complex of §5. Flatland is the plane <code>z = 0</code>. <!-- MATH.md §11, §9 --></p>
<ul>
<li>Rotation planes: <code>XY</code>, <code>XZ</code>, <code>YZ</code>, with the matrices of §2.1 restricted to <code>R³</code>; <code>XZ(θ)</code> turns <code>e_x</code> toward <code>e_z</code>. The composite is <code>M = R_YZ · R_XZ · R_XY</code>, <code>XY</code> first (§2.2 restricted).</li>
<li>Projection: orthographic <code>(x, y, z) ↦ (x, y)</code>; perspective from <code>(0, 0, d)</code>, <code>(x, y) · d/(d − z)</code>.</li>
<li>Slicing: <code>{ q : m · q = k }</code>, <code>|m| = 1</code>, with a chart basis <code>(u_1, u_2)</code> of <code>m^⊥</code> such that <code>det(u_1, u_2, m) = +1</code>, equal to <code>(e_x, e_y)</code> when <code>m = e_z</code>. The slice of a closed mesh is the planar section of §9.1: segments chained by shared mesh edge into loops, holes by nesting parity, drawn as filled polygons oriented counter-clockwise for outer loops.</li>
<li>Colour encodes <code>z</code> exactly as <code>w</code> in §10.</li>
</ul>
<!-- MATH.md §11, §2.1, §2.2, §10 -->
<p>Known answers. Cube <code>[−1, 1]³</code> by <code>z = c</code>, <code>|c| &lt; 1</code>: a square of area 4. By the plane through the origin with normal <code>(1, 1, 1)/√3</code>: a regular hexagon with vertices at the six edge midpoints, side <code>√2</code>, area <code>3√3</code>. Moving that plane from one corner to the opposite one: point, triangle, hexagon, triangle, point (§8.4 one dimension down). Ball of radius <code>R</code>: discs of area <code>π(R² − c²)</code>. Cavalieri one dimension down: <code>∫ A(c) dc</code> is the 3-volume. <!-- MATH.md §11, §7 --></p>`,
});

const flatProjection = topic({
  id: 'flat:projection',
  title: 'Flatland: the shadow',
  eli5: `
<p>Hold a wire cube under a lamp above a sheet of paper and look at its shadow on the sheet. Straight from above, the shadow is a square inside a square: the face nearer the lamp casts a bigger square, the face farther away a smaller one. Both faces are the same size; only the lamp makes the near one look larger.</p>
<p>That is exactly why the tesseract looks like a cube inside a cube in the 4D viewer, one dimension up.</p>
<p>Turn the cube on the sheet, as a flat creature can, and the shadow just turns. Tilt it up out of the sheet and the shadow morphs, because parts of the cube swing toward the lamp and away from it. Colour tells you which parts are higher and which are lower.</p> <!-- MATH.md §11, §3.2 -->`,
  intermediate: `
<p>Orthographic projection forgets the height: <code>(x, y, z) ↦ (x, y)</code>. Perspective puts an eye on the <code>z</code> axis at distance <code>d</code> and draws each point at scale <code>d/(d − z)</code>: <code>(x, y) · d/(d − z)</code>. For the cube <code>[−1, 1]³</code> and <code>d = 3</code> the face at <code>z = +1</code> is drawn at scale <code>3/2</code> and the face at <code>z = −1</code> at scale <code>3/4</code>: the square inside a square. <!-- MATH.md §11, §3.2 --></p>
<p>The <code>XY</code> rotation leaves every <code>z</code> unchanged, so it turns the shadow rigidly. <code>XZ</code> and <code>YZ</code> change the heights, hence which parts are near the eye, so the shadow morphs. Colour is the <code>z</code> of each point after rotation. <!-- MATH.md §11, §2.1, §10 --></p>`,
  math: `
<p>Eye at <code>(0, 0, d)</code>, image plane <code>z = 0</code>. The ray from the eye through <code>p = (x, y, z)</code>, <code>z &lt; d</code>, meets the image plane at <code>(x, y) · d/(d − z)</code>, the analogue of §3.2. The factor depends on <code>z</code> alone, so all points at height <code>z</code> are scaled alike, and straight lines go to straight lines. For the cube <code>[−1, 1]³</code> and <code>d = 3</code>: <code>z = 1</code> gives <code>3 / 2</code>, so the face of half-side 1 is drawn with half-side <code>3/2</code>; <code>z = −1</code> gives <code>3 / 4</code>, half-side <code>3/4</code>. <!-- MATH.md §11, §3.2 --></p>
<p>If <code>R</code> is the rotation in the <code>XY</code> plane then <code>R</code> fixes <code>z</code> and acts on <code>(x, y)</code> as a plane rotation <code>R_2</code>, so the projection of <code>R p</code> is <code>R_2</code> applied to the projection of <code>p</code>. For <code>XZ</code> and <code>YZ</code> the heights change and the image is not a rigid motion of the previous one. Colour: the <code>z</code> of <code>M p</code>, after rotation and before projection, on the gradient of §10 spanned over <code>[−R, R]</code>, <code>R</code> the solid's radius. <!-- MATH.md §11, §2.1, §10 --></p>`,
});

const flatSlice = topic({
  id: 'flat:slice',
  title: 'Flatland: the slice',
  eli5: `
<p>Push a ball slowly through a sheet of paper and a creature living in the paper sees a dot, a growing circle, a shrinking circle, and nothing. The slice view shows exactly that: the part of the solid that is inside the sheet right now.</p>
<p>Try the cube. Pushed straight through, the slice is a square that never changes. Tilt the cube until a corner points at the sheet and push it through: you get a point, then a triangle, then a hexagon, then a triangle, then a point. That is the cube's own version of the tesseract's point, tetrahedron, truncated tetrahedron, octahedron.</p>
<p>The colour of the slice tells you where in the solid's own up direction each bit came from.</p>
<p>The overlay view draws the shadow faintly with the slice inside it, at the size the shadow gives that part of the solid, so the slice sits exactly where the shadow says it should.</p> <!-- MATH.md §11, §8.4, §3.2 -->`,
  intermediate: `
<p>The slice is the cross-section of the rotated solid by the plane <code>z = c</code>, equivalently of the unrotated solid by a tilted plane <code>{ q : m · q = k }</code>. For a closed triangle mesh the slice is its planar section: each triangle is cut by the plane, the segments are chained into closed loops by shared mesh edge, loops are classified as outer boundaries or holes by nesting parity, and the result is drawn as filled polygons. A torus sliced flat is a ring: two loops, the inner one a hole. <!-- MATH.md §11, §9.1 --></p>
<p>Known answers: the cube <code>[−1, 1]³</code> sliced by <code>z = c</code>, <code>|c| &lt; 1</code>, is a square of area 4; through the origin with normal <code>(1, 1, 1)/√3</code> it is a regular hexagon with vertices at the six edge midpoints, of side <code>√2</code> and area <code>3√3</code>; moving that plane from one corner to the opposite one gives point, triangle, hexagon, triangle, point. A ball of radius <code>R</code> gives discs of area <code>π(R² − c²)</code>. The slice area integrates over <code>c</code> to the volume of the solid (Cavalieri one dimension down). <!-- MATH.md §11, §7 --></p>
<p>In the overlay view every point of the slice at <code>z = c</code> has height <code>c</code>, so under perspective from <code>d</code> they are all drawn at the same scale <code>d/(d − c)</code>, and the slice lands where the shadow's outline crosses height <code>c</code>; under orthographic projection the scale is 1. <!-- MATH.md §11, §3.2 --></p>`,
  math: `
<p>A plane <code>{ q : m · q = k }</code>, <code>|m| = 1</code>, with chart <code>chart(q) = (u_1 · q, u_2 · q)</code> for an orthonormal basis <code>(u_1, u_2)</code> of <code>m^⊥</code> with <code>det(u_1, u_2, m) = +1</code>; for <code>m = e_z</code> the basis is <code>(e_x, e_y)</code>, so the slice at <code>z = c</code> shows the solid's own <code>x, y</code>. The viewer slices the rotated solid by <code>m = e_z</code>, equivalent to slicing the unrotated one by <code>m = M^T e_z</code>, as in §4. Slice vertices are coloured by the <code>z</code> of the unrotated source point, as in §10. <!-- MATH.md §11, §4, §10 --></p>
<p>Planar section (§9.1): intersect every triangle with the plane, chain the segments into loops by shared mesh edge, classify loops as outer or hole by nesting parity, output outer loops counter-clockwise. <!-- MATH.md §9.1, §11 --></p>
<p>Cube <code>[−1, 1]³</code>, plane <code>x + y + z = 0</code>: the plane meets the twelve edges at six points, the edge midpoints, which are the six permutations of <code>(1, −1, 0)</code>; neighbouring ones are at distance <code>√2</code>, so the hexagon is regular with side <code>√2</code> and area <code>(3√3/2)(√2)² = 3√3</code>.
<!-- Cavalieri check for the corner-to-corner sequence, plane x + y + z = k, offset c = k/√3. For 1 ≤ k ≤ 3 the slice is a triangle of side √2 (3 − k) and area (√3/2)(3 − k)²; for |k| ≤ 1 a hexagon of area (√3/2)((3 − k)² − 3(1 − k)²), the triangle of side √2 (3 − k) minus three corner triangles of side √2 (1 − k); integrating over k from −3 to 3 and dividing by √3 gives 8. -->
Over the whole sequence the slice area integrates to the volume 8 of the cube. <!-- MATH.md §11, §7 --></p>
<p>Overlay: a slice vertex <code>q = (x, y)</code> of the rotated solid at <code>z = c</code> is the point <code>(x, y, c)</code>, and its perspective image is <code>(x, y) · d/(d − c) = q · d/(d − c)</code>, with the factor independent of <code>q</code>, exactly as in §3.2 one dimension down. Drawing the whole slice at that scale therefore reproduces the projection on it; under orthographic projection the scale is 1. <!-- MATH.md §11, §3.2, §4 --></p>`,
});

const flatRotation = topic({
  id: 'flat:rotation',
  title: 'Flatland: rotating a solid',
  eli5: `
<p>A flat creature knows one way to turn something: spin it round on the sheet. That is the <code>XY</code> slider, and it just turns the picture, shadow and slice alike.</p>
<p>The other two sliders, <code>XZ</code> and <code>YZ</code>, tilt the solid up out of the sheet. A flat creature cannot do that, and for them the solid seems to change shape: the slice of a tilted cube is no longer a square, and the shadow morphs. This is what <code>XW</code>, <code>YW</code> and <code>ZW</code> do to us in the 4D viewer.</p>
<p>The <em>spin</em> preset turns the solid on the sheet; the <em>tumble</em> preset tilts it out of the sheet while the slice sweeps back and forth.</p> <!-- MATH.md §11, §2.1 -->`,
  intermediate: `
<p>In <code>R³</code> there are three coordinate planes of rotation, <code>XY</code>, <code>XZ</code> and <code>YZ</code>, with the matrices of §2.1 restricted to <code>R³</code>; positive <code>θ</code> turns <code>e_x</code> toward <code>e_y</code>, <code>e_x</code> toward <code>e_z</code> and <code>e_y</code> toward <code>e_z</code> respectively. <code>XY</code> is the only rotation that keeps the sheet: it fixes <code>z</code>, so it turns shadow and slice rigidly. <code>XZ</code> and <code>YZ</code> turn the solid partly out of the sheet, the analogues of <code>XW</code>, <code>YW</code>, <code>ZW</code>. The viewer composes them as <code>M = R_YZ · R_XZ · R_XY</code>, <code>XY</code> first. Unlike in 4D no two of the three planes are disjoint (any two planes of <code>R³</code> share a line), so there is no double-rotation analogue. <!-- MATH.md §11, §2.1, §2.2 --></p>
<p>Slicing the rotated solid by <code>z = c</code> equals slicing the unrotated one by a plane whose normal is the <code>z</code> row of <code>M</code>. For <code>R_XZ(θ)</code> alone that normal is <code>(sin θ, 0, cos θ)</code>: tilted by <code>θ</code> from <code>e_z</code> toward <code>e_x</code>. For the cube <code>[−1, 1]³</code> turned by <code>θ = π/4</code> in <code>XZ</code>, the slice at <code>z = 0</code> is a <code>2 × 2√2</code> rectangle of area <code>4√2</code>, the analogue of the <code>2 × 2 × 2√2</code> prism of volume <code>8√2</code> in the tesseract. <!-- MATH.md §11, §4, §8.4 --></p>`,
  math: `
<p>For axes <code>i &lt; j</code>, <code>R_ij(θ)</code> is the identity except <code>R[i][i] = cos θ</code>, <code>R[i][j] = −sin θ</code>, <code>R[j][i] = sin θ</code>, <code>R[j][j] = cos θ</code>, and <code>R_ij(θ) e_i = cos θ e_i + sin θ e_j</code>; for <code>R³</code> the planes are <code>XY (0,1)</code>, <code>XZ (0,2)</code>, <code>YZ (1,2)</code>. Facts as in §2.1: <code>R^T R = I</code>, <code>det R = +1</code>, <code>R_ij(a) R_ij(b) = R_ij(a + b)</code>; <code>R_XZ(θ) = R_y(−θ)</code> in the textbook convention. The composite is <code>M = R_YZ · R_XZ · R_XY</code> (§2.2 with the planes through <code>w</code> removed). Any two planes of <code>R³</code> meet in a line, so these rotations do not commute in general and there is no pair of disjoint planes, hence no double rotation. <!-- MATH.md §11, §2.1, §2.2 --></p>
<p>The viewer slices <code>M p</code> by <code>m = e_z</code>, equivalently <code>p</code> by <code>m = M^T e_z</code>, the <code>z</code> row of <code>M</code> (§4 one dimension down). <code>R_XY</code> has <code>M^T e_z = e_z</code>: the slicing plane does not change and the slice only turns. For <code>R_XZ(θ)</code>, <code>R[2][0] = sin θ</code> and <code>R[2][2] = cos θ</code>, so <code>M^T e_z = (sin θ, 0, cos θ)</code>, and likewise <code>(0, sin θ, cos θ)</code> for <code>R_YZ(θ)</code>. Example, cube <code>[−1, 1]³</code> with <code>θ = π/4</code>: the plane <code>x + z = 0</code> meets the cube in the points <code>(x, y, −x)</code>, <code>|x|, |y| ≤ 1</code>, a rectangle of sides 2 (along <code>y</code>) and <code>2√2</code> (along <code>(1, 0, −1)</code>), area <code>4√2</code>. <!-- MATH.md §11, §4, §8.4 --></p>`,
});

// ---- Flatland shapes ---------------------------------------------------------------------

const flatCube = topic({
  id: 'flat:cube',
  title: 'Flatland cube',
  eli5: `
<p>The cube is the best test case because you know exactly what its shadows and slices should look like. It has 8 corners, 12 edges and 6 square faces.</p>
<p>Seen from straight above under a lamp, it is a square inside a square: the near face drawn big, the far face small, exactly like the tesseract's cube inside a cube.</p>
<p>Pushed straight through the sheet it is a square that appears all at once, stays the same, and vanishes all at once. Tilted onto a corner it comes through as a point, a triangle, a hexagon, a triangle, and a point.</p> <!-- MATH.md §11, §8.4 -->`,
  intermediate: `
<p>The cube <code>[−1, 1]³</code>: 8 vertices, 12 edges, 6 square faces, <code>8 − 12 + 6 = 2</code>, volume <code>2³ = 8</code>. Under perspective from <code>d = 3</code> the face at <code>z = +1</code> is drawn at scale <code>3/2</code> and the face at <code>z = −1</code> at scale <code>3/4</code>: the square inside a square. <!-- MATH.md §11, §3.2 --></p>
<p>Slices: <code>z = c</code> with <code>|c| &lt; 1</code> gives a square of side 2 and area 4. The plane through the origin with normal <code>(1, 1, 1)/√3</code> gives a regular hexagon with vertices at the six edge midpoints, side <code>√2</code>, area <code>3√3</code>. Moving that plane from one corner to the opposite one gives point, triangle, hexagon, triangle, point, the analogue of the tesseract's point, tetrahedron, truncated tetrahedron, octahedron. The slice area integrates to 8. <!-- MATH.md §11, §8.4 --></p>`,
  math: `
<p>Vertices <code>(±1, ±1, ±1)</code>; faces <code>x_i = ±1</code>. The cube is the extrusion of the square <code>[−1, 1]²</code> along <code>z</code>, the exact analogue of <code>extrude(cube) = tesseract</code>. Perspective, <code>d = 3</code>: <code>d/(d − z) = 3/2</code> at <code>z = 1</code> and <code>3/4</code> at <code>z = −1</code>. <!-- MATH.md §11, §9.1, §3.2 --></p>
<p>Slice by <code>z = c</code>, <code>|c| &lt; 1</code>: <code>[−1, 1]²</code>, area 4; <code>∫_{−1}^{1} 4 dc = 8</code>. Slice by <code>x + y + z = k</code> (offset <code>c = k/√3</code>): a triangle for <code>1 ≤ |k| ≤ 3</code> (a point at <code>|k| = 3</code>), a hexagon for <code>|k| &lt; 1</code>, regular at <code>k = 0</code> with vertices the six edge midpoints, side <code>√2</code>, area <code>3√3</code>. <!-- MATH.md §11, §7 --></p>`,
});

const flatTetrahedron = topic({
  id: 'flat:tetrahedron',
  title: 'Flatland tetrahedron',
  eli5: `
<p>A pyramid with a triangular base: 4 corners, 6 edges and 4 triangular faces, and every face looks the same. It is the simplest solid, the way a triangle is the simplest flat shape.</p>
<p>A flat sheet can cut it in only a few ways. If the sheet separates one corner from the other three, the slice is a triangle; if it separates two corners from the other two, the slice is a four-sided shape; and near a corner the triangle shrinks to a point.</p>
<p>The 4D viewer makes exactly this cut on every tetrahedron on the skin of every shape, which is why this little solid is worth knowing.</p> <!-- MATH.md §11, §6 -->`,
  intermediate: `
<p>The regular tetrahedron on four alternate corners of the cube <code>[−1, 1]³</code> (the same tetrahedron as the base cell of the 5-cell): 4 vertices, 6 edges, 4 faces, every edge <code>2√2</code>. <!-- MATH.md §11, §8.1 --></p>
<p>A plane sorts the four vertices by sign, exactly as in §6. One or three on the positive side: the slice is a triangle. Two and two: a quadrilateral. None or four: empty. Moving the plane toward a vertex shrinks the triangle to a point. This is the case table the 4D viewer uses for each tetrahedron of a boundary complex. <!-- MATH.md §6, §11 --></p>`,
  math: `
<p>Vertices <code>(1, 1, 1)</code>, <code>(1, −1, −1)</code>, <code>(−1, 1, −1)</code>, <code>(−1, −1, 1)</code>: any two differ in two coordinates by 2, so every edge is <code>√(2² + 2²) = 2√2</code>.
<!-- Volume: the cube (8) minus four corner pyramids of volume (1/6)·2·2·2 = 4/3 each leaves 8 − 16/3 = 8/3. -->
Volume <code>8/3</code>. <!-- MATH.md §8.1, §11 --></p>
<p>Slice by a plane <code>s(q) = m · q − k</code>: classify each vertex by <code>s ≥ 0</code> (zero counts as positive). With 1 or 3 positive vertices one triangle results, with 2 a quadrilateral, crossings at <code>p + t (q − p)</code>, <code>t = s_p/(s_p − s_q)</code>, exactly the table of §6. Example: the plane <code>x = 0</code> has two vertices on each side and meets the four connecting edges at their midpoints <code>(0, ±1, 0)</code> and <code>(0, 0, ±1)</code>: a square of side <code>√2</code>. <!-- MATH.md §6, §11 --></p>`,
});

const flatOctahedron = topic({
  id: 'flat:octahedron',
  title: 'Flatland octahedron',
  eli5: `
<p>Two square pyramids glued base to base: 6 corners, 12 edges, 8 triangular faces. The corners sit one step along each of the three directions, forwards and backwards.</p>
<p>Pushed straight through the sheet it comes through as a square that swells to full size halfway and then shrinks to a point.</p>
<p>It is the 3D cousin of the 16-cell: both are made by putting a corner one step out along every axis, and both slice into the next shape down, a square here and an octahedron there.</p> <!-- MATH.md §11, §8 -->`,
  intermediate: `
<p>The octahedron with vertices <code>±e_i</code>, that is <code>|x| + |y| + |z| ≤ 1</code>: 6 vertices, 12 edges of length <code>√2</code>, 8 triangular faces, <code>6 − 12 + 8 = 2</code>. <!-- MATH.md §11 --></p>
<p>The slice by <code>z = c</code> is the square <code>|x| + |y| ≤ 1 − |c|</code>, area <code>2(1 − |c|)²</code>: a square at full size at <code>c = 0</code>, shrinking linearly to a point at <code>c = ±1</code>. The 16-cell of §8, <code>|x| + |y| + |z| + |w| ≤ 1</code>, does the same one dimension up: its slices are octahedra of volume <code>(4/3)(1 − |c|)³</code>. The slice area integrates to the volume, <code>4/3</code>. <!-- MATH.md §11, §8, §7 --></p>`,
  math: `
<p>The solid <code>{ |x| + |y| + |z| ≤ 1 }</code>, the unit ball of the 1-norm, with facet normals <code>(±1, ±1, ±1)</code>. Slice by <code>z = c</code>: <code>{ |x| + |y| ≤ 1 − |c| }</code>, a square of side <code>√2 (1 − |c|)</code>, area <code>2(1 − |c|)²</code>.
<!-- The square |x| + |y| ≤ r has area 2 r². Cavalieri: the integral over c from −1 to 1 of 2(1 − |c|)² is 2 · 2 · (1/3) = 4/3, which is also the eight octant tetrahedra {x, y, z ≥ 0, x + y + z ≤ 1}, each of volume 1/6. -->
Cavalieri: <code>∫_{−1}^{1} 2(1 − |c|)² dc = 4/3</code>, the volume. One dimension up the same computation for <code>|x| + |y| + |z| + |w| ≤ 1</code> gives slices <code>(4/3)(1 − |c|)³</code> and <code>∫ = 2/3</code>, the 16-cell's hypervolume of §8. <!-- MATH.md §11, §7, §8 --></p>`,
});

const flatBall = topic({
  id: 'flat:ball',
  title: 'Flatland ball',
  eli5: `
<p>A sphere: round in every direction. Push it through the sheet and a flat creature sees a dot appear, swell into a disc, and shrink away again. That is the best picture there is of what a 4D ball does to us.</p>
<p>It is perfectly round, so turning it with any slider changes nothing about its shape; only the colours move. Its shadow is a disc however you turn it.</p>
<p>The ball in the viewer is built from many flat triangles, so its slices are polygons with many sides, very close to discs.</p> <!-- MATH.md §11, §8.5 -->`,
  intermediate: `
<p>The ball of radius <code>R</code>: the slice at offset <code>c</code> is a disc of radius <code>√(R² − c²)</code> and area <code>π(R² − c²)</code>, full size at <code>c = 0</code> and a point at <code>c = ±R</code>. Every rotation is a symmetry. The slice area integrates to the volume <code>(4/3)π R³</code>. It is the 3D version of the 4-ball of §8.5, whose slices are balls of radius <code>√(R² − c²)</code>. <!-- MATH.md §11, §8.5 --></p>
<p>The viewer's ball is a polyhedron, so its slices are polygons that approach discs, and its volume approaches <code>(4/3)π R³</code>, as the 4-ball's tessellation approaches <code>π² R⁴/2</code>, with refinement. <!-- MATH.md §11, §8.5 --></p>`,
  math: `
<p>A point <code>(x, y, c)</code> is in the ball <code>|p| ≤ R</code> iff <code>x² + y² ≤ R² − c²</code>: a disc of radius <code>√(R² − c²)</code>, area <code>A(c) = π(R² − c²)</code>. Cavalieri: <code>∫_{−R}^{R} π(R² − c²) dc = π(2R³ − 2R³/3) = (4/3)π R³</code>. By rotational symmetry the same holds for every plane at distance <code>|c|</code> from the centre. One dimension up: <code>A(c) = (4/3)π (R² − c²)^{3/2}</code> and <code>∫ A dc = π² R⁴ / 2</code> (§8.5). <!-- MATH.md §11, §7, §8.5 --></p>`,
});

const flatTorus = topic({
  id: 'flat:torus',
  title: 'Flatland torus',
  eli5: `
<p>A doughnut lying flat on the sheet. Cut it flat, parallel to the sheet, and you get a ring with a hole in it. Stand it on its side and cut through the middle and you get two separate discs, one on each side of the hole, exactly as a knife through a doughnut leaves two pieces.</p>
<p>That ring with a hole is the reason the slicer has to tell outer edges from holes; the 4D viewer faces the same problem whenever a slice has a hole.</p>
<p>Its 4D relatives are the torus prism, a doughnut swept along the hidden direction, and the torisphere, whose slices are doughnuts.</p> <!-- MATH.md §11, §9.1 -->`,
  intermediate: `
<p>A torus of major radius <code>R</code> and minor radius <code>r</code>, <code>R &gt; r</code>, lying flat (its axis along <code>z</code>). The slice by <code>z = c</code>, <code>|c| &lt; r</code>, is the ring <code>R − a ≤ √(x² + y²) ≤ R + a</code>, <code>a = √(r² − c²)</code>, of area <code>4π R a</code>: widest at <code>c = 0</code>, thinning to a circle as <code>|c| → r</code>. The ring has a hole, so the planar section has two loops and the inner one is a hole by nesting parity. <!-- MATH.md §11, §9.1 --></p>
<p>A plane containing the axis cuts the solid torus in two discs of radius <code>r</code>, centred at distance <code>R</code> from the axis. The slice area integrates over <code>c</code> to the volume <code>2π² R r²</code>. <!-- MATH.md §11, §7 --></p>`,
  math: `
<p>Boundary <code>((R + r cos v) cos u, (R + r cos v) sin u, r sin v)</code>. The slice by <code>z = c</code> is <code>(√(x² + y²) − R)² ≤ r² − c²</code>, the annulus of area <code>π((R + a)² − (R − a)²) = 4π R a</code>. Cavalieri: <code>∫_{−r}^{r} 4π R √(r² − c²) dc = 4π R · π r²/2 = 2π² R r²</code>, which is Pappus' value (disc area <code>π r²</code> times <code>2π R</code>) for the volume. <!-- MATH.md §11, §7, §9.2 --></p>
<p>Planar section: the annulus has two boundary loops; by nesting parity the outer loop bounds the region and the inner one is a hole, so the slice is drawn with the inner disc left empty. For a plane through the axis, <code>y = 0</code> say, the condition <code>(|x| − R)² + z² ≤ r²</code> gives two discs of radius <code>r</code> centred at <code>x = ±R</code>. <!-- MATH.md §11, §9.1 --></p>`,
});

const flatCylinder = topic({
  id: 'flat:cylinder',
  title: 'Flatland cylinder',
  eli5: `
<p>A can standing on the sheet, with its axis pointing up out of it. Sweep a disc straight up and you get a can, just as sweeping a ball along the hidden direction gives the 4D spherinder.</p>
<p>Pushed straight through the sheet, the can is a disc that appears all at once, stays the same, and vanishes all at once. Tilt it a little and the slice becomes an oval; tilt it enough for the sheet to reach the flat ends of the can and the oval is cut off by two straight edges.</p>
<p>In shadow, under a lamp, you see a disc inside a bigger disc: the two ends of the can, one nearer the lamp than the other.</p> <!-- MATH.md §11, §9.1 -->`,
  intermediate: `
<p>The extrusion of a disc of radius <code>r</code> along <code>z</code>, <code>P = D_r × [−h, h]</code>, volume <code>π r² · 2h</code>: the exact analogue of the spherinder, one dimension down. For the slice by <code>z = c</code>, <code>|c| &lt; h</code>, the result is the disc itself. For a tilted plane (<code>m_z ≠ 0</code>) the slice is a sheared slab: an ellipse (the affine image of the disc) clipped between two parallel straight lines, the places where the plane meets the two flat ends. If the plane is parallel to the axis the slice is a rectangle. <!-- MATH.md §9.1, §11 --></p>
<p>In perspective the two ends are drawn at scales <code>d/(d − h)</code> and <code>d/(d + h)</code>: a disc inside a disc. <!-- MATH.md §3.2, §11 --></p>`,
  math: `
<p>A point <code>(q, z)</code> of <code>P</code> lies in the plane <code>m · (q, z) = k</code> iff, for <code>m_z ≠ 0</code>, <code>z = (k − m_xy · q)/m_z</code>, so the slice is the graph of this affine function over <code>D_r ∩ { k − m_z h ≤ m_xy · q ≤ k + m_z h }</code> (for <code>m_z &gt; 0</code>), an affine image of the disc clipped between two parallel lines, the planar form of §9.1's sheared-slab fact; mapped through the chart (an isometry) it is an ellipse cut by two parallel straight edges. For <code>m = e_z</code> and <code>|c| &lt; h</code> it is <code>D_r</code>, area <code>π r²</code>, and <code>∫ π r² dc = π r² · 2h</code>. A plane <code>x = k</code>, parallel to the axis, gives the rectangle of width <code>2√(r² − k²)</code> and height <code>2h</code>. <!-- MATH.md §9.1, §11 --></p>
<p>Projection: the ends are discs of radius <code>r</code> at <code>z = ±h</code>, drawn at <code>d/(d − h)</code> and <code>d/(d + h)</code>; orthographically they coincide. <!-- MATH.md §3.2, §11 --></p>`,
});

const flatHuman = topic({
  id: 'flat:human',
  title: 'Flatland human',
  eli5: `
<p>An ordinary 3D figure, built from simple parts, standing up and facing you. It is not a flat person, and nothing about it is special; it is here because you know exactly what a person looks like.</p>
<p>The flat creatures in the sheet can never see the whole figure at once. Slices parallel to the sheet show them the figure layer by layer from front to back, like a scan; tilt the figure and the layers change.</p>
<p>This is how a 4D being would look to us: not whole, but as a changing set of 3D slices.</p> <!-- MATH.md §11 -->`,
  intermediate: `
<p>The same humanoid as the 4D viewer's Humanoid and Spun human, made of simple parts (capsules, spheres, boxes) that overlap at the joints and are sliced and drawn together. Each part is a closed, outward-oriented mesh (§9), so each is sliced by planar sections (§11). <!-- MATH.md §9, §11 --></p>
<p>The slice by <code>z = c</code> is a layer of the figure at that depth; in perspective the parts nearer the lamp are drawn larger, by <code>d/(d − z)</code>. A flat creature gets only these layers, one at a time, just as we would get only 3D slices of a 4D being. <!-- MATH.md §11, §3.2 --></p>`,
  math: `
<p>Each part <code>S_j</code> is a closed outward-oriented triangle mesh; the slice of the figure at <code>z = c</code> is the union of the planar sections of the parts (§9.1), each built by segments chained into loops by shared mesh edge and classified by nesting parity. The parts overlap, so the drawn regions overlap. Under the perspective projection a point at height <code>z</code> is scaled by <code>d/(d − z)</code>. <!-- MATH.md §9.1, §11, §3.2 --></p>
<p>Nothing geometric about "a flat human" follows: the construction is a union of 3D parts, and the Flatland view of it is its sections and shadows, as for any solid. <!-- MATH.md §11 --></p>`,
});

// ---- Registry -------------------------------------------------------------------

const EXPLAINERS: readonly Explainer[] = [
  intro,
  viewProjection,
  viewSlice,
  viewOverlay,
  ...rotations,
  liftExtrude,
  liftSpin,
  sdf,
  importModel,
  xr,
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
  spunBall,
  spunHalfBall,
  spunCube,
  spunHuman,
  sdfSpheritorus,
  sdfTorisphere,
  sdfTiger,
  sdfDitorus,
  sdfCreature,
  flatIntro,
  flatProjection,
  flatSlice,
  flatRotation,
  flatCube,
  flatTetrahedron,
  flatOctahedron,
  flatBall,
  flatTorus,
  flatCylinder,
  flatHuman,
];

const byId = new Map<string, Explainer>(EXPLAINERS.map((e) => [e.id, e]));
if (byId.size !== EXPLAINERS.length) throw new Error('explain/content: duplicate topic id');

export const getExplainer = (id: string): Explainer | undefined => byId.get(id);
export const listExplainers = (): Explainer[] => EXPLAINERS.slice();
