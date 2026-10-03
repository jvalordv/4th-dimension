import { describe, expect, it } from 'vitest';
import { FLAT_SHAPE_IDS, FLAT_TOPICS, getExplainer, listExplainers, mountExplainer, TIERS } from '../../src/explain/index';
import type { Tier } from '../../src/explain/index';
import { SHAPE_IDS } from '../../src/app/registry';
import { apply4, determinant4, mul4 } from '../../src/math/mat4';
import { ROTATION_PLANES, rotation } from '../../src/math/rotation';
import type { Vec3, Vec4 } from '../../src/math/types';
import { capsule, ditorus, smoothMin, spheritorus, tiger, torisphere } from '../../src/geometry/sdf';

// Topic ids required by the comment at the top of src/explain/index.ts:
// SHAPE_IDS ∪ view:* ∪ rotation:* ∪ {lift:extrude, lift:spin, sdf, import, xr, color, intro}
// ∪ flat:FLAT_TOPICS (Flatland mode, MATH.md §11).
const EXPECTED_IDS = [
  ...Object.values(SHAPE_IDS),
  'view:projection', 'view:slice', 'view:overlay',
  ...ROTATION_PLANES.map((p) => `rotation:${p}`),
  'lift:extrude', 'lift:spin', 'sdf', 'import', 'xr', 'color', 'intro',
  ...FLAT_TOPICS.map((t) => `flat:${t}`),
].sort();

/** The topics added for the spin, SDF, import, XR and Flatland material. */
const NEW_IDS = [
  SHAPE_IDS.spunBall, SHAPE_IDS.spunHalfBall, SHAPE_IDS.spunCube, SHAPE_IDS.spunHuman,
  SHAPE_IDS.sdfSpheritorus, SHAPE_IDS.sdfTorisphere, SHAPE_IDS.sdfTiger, SHAPE_IDS.sdfDitorus, SHAPE_IDS.sdfCreature,
  'lift:spin', 'sdf', 'import', 'xr',
  ...FLAT_TOPICS.map((t) => `flat:${t}`),
];

const ALLOWED_TAGS = new Set(['h3', 'p', 'ul', 'li', 'code', 'em', 'strong']);

describe('explainer content', () => {
  it('covers exactly the required topic ids', () => {
    expect(listExplainers().map((e) => e.id).sort()).toEqual(EXPECTED_IDS);
    for (const id of EXPECTED_IDS) expect(getExplainer(id)?.id).toBe(id);
    expect(getExplainer('nope')).toBeUndefined();
  });

  it('has a non-empty title and three non-empty tiers per topic, using only the allowed elements', () => {
    for (const e of listExplainers()) {
      expect(e.title.trim().length).toBeGreaterThan(0);
      for (const tier of TIERS) {
        const html = e.tiers[tier];
        expect(html.trim().length, `${e.id}/${tier}`).toBeGreaterThan(0);
        const tags = Array.from(html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)[\s>]/g), (m) => m[1].toLowerCase());
        const bad = tags.filter((t) => !ALLOWED_TAGS.has(t));
        expect(bad, `${e.id}/${tier} uses ${bad.join(',')}`).toEqual([]);
        // Every tier cites MATH.md by section number in an HTML comment.
        expect(html, `${e.id}/${tier} cites MATH.md`).toMatch(/<!--[^>]*MATH\.md §\d/);
        // Fragment has no unbalanced <p>.
        expect((html.match(/<p[\s>]/g) ?? []).length).toBe((html.match(/<\/p>/g) ?? []).length);
      }
    }
  });

  it('plain-words tiers are 2 to 4 short paragraphs, plus the view note on shapes', () => {
    const shapeIds = new Set<string>(Object.values(SHAPE_IDS));
    for (const e of listExplainers()) {
      const paragraphs = (e.tiers.eli5.match(/<p[\s>]/g) ?? []).length - (shapeIds.has(e.id) ? 1 : 0);
      expect(paragraphs, `${e.id} eli5 paragraphs`).toBeGreaterThanOrEqual(2);
      expect(paragraphs, `${e.id} eli5 paragraphs`).toBeLessThanOrEqual(4);
      // No jargon: hyperplane / tetrahedral complex / matrix / orthonormal.
      expect(e.tiers.eli5, `${e.id} eli5 jargon`).not.toMatch(/hyperplane|orthonormal|matrix|isometry|affine/i);
    }
  });

  it('every shape topic ends each tier with a one-line note naming the best view', () => {
    for (const id of Object.values(SHAPE_IDS)) {
      const e = getExplainer(id);
      expect(e).toBeDefined();
      for (const tier of TIERS) {
        const html = e!.tiers[tier];
        expect(html.trimEnd().endsWith('</p>')).toBe(true);
        const note = html.slice(html.lastIndexOf('<p class="explainer-view-note">'));
        expect(note).toMatch(/Best seen in the <strong>(projection|slice|overlay)<\/strong> view:/);
        expect(note.split('\n').length).toBe(1);
      }
    }
    // Non-shape topics carry no view note.
    expect(getExplainer('intro')!.tiers.eli5).not.toContain('explainer-view-note');
    expect(getExplainer('rotation:XW')!.tiers.math).not.toContain('explainer-view-note');
  });

  it('states the catalogue numbers of MATH.md §8 and the required facts', () => {
    const t = getExplainer(SHAPE_IDS.tesseract)!;
    // §8 table row for the tesseract: V 16, E 32, F 24, C 8, hypervolume 16.
    expect(t.tiers.intermediate).toMatch(/16 vertices, 32 edges, 24 square faces, 8 cubic cells/);
    // §8.4 diagonal sequence and volumes.
    expect(t.tiers.intermediate).toMatch(/point, tetrahedron, truncated tetrahedron, regular octahedron/);
    expect(t.tiers.intermediate).toContain('32/3');
    expect(t.tiers.intermediate).toContain('8√2');
    // §3.2 scales for d = 3.
    expect(t.tiers.intermediate).toContain('3/2');
    expect(t.tiers.intermediate).toContain('3/4');
    // §8.5 ball slice radius.
    expect(getExplainer(SHAPE_IDS.hypersphere)!.tiers.intermediate).toContain('√(R² − c²)');
    expect(getExplainer(SHAPE_IDS.hypersphere)!.tiers.intermediate).toContain('π² R^4 / 2');
    // Overlay scale d/(d − c) (§3.2) in the intermediate and math tiers.
    expect(getExplainer('view:overlay')!.tiers.intermediate).toContain('d/(d − c)');
    expect(getExplainer('view:overlay')!.tiers.math).toContain('d/(d − c)');
    // §2.1 commuting pairs appear in every rotation topic.
    for (const p of ROTATION_PLANES) {
      const r = getExplainer(`rotation:${p}`)!;
      expect(r.tiers.intermediate).toMatch(/XY<\/code> with <code>ZW/);
      expect(r.tiers.math).toContain('cos θ');
      expect(r.tiers.math).toContain('R_ZW · R_YW · R_YZ · R_XW · R_XZ · R_XY');
    }
    // §8.2: no closed-form hypervolume for the 600- and 120-cell.
    for (const id of [SHAPE_IDS.cell600, SHAPE_IDS.cell120]) {
      const e = getExplainer(id)!;
      for (const tier of TIERS) expect(e.tiers[tier]).not.toMatch(/4-volume (is|=) [^<]*[0-9]/);
      expect(e.tiers.intermediate).toMatch(/no closed-form hypervolume/);
    }
    // §9: no canonical 4D version of the human form or the mug.
    expect(getExplainer(SHAPE_IDS.human)!.tiers.intermediate).toMatch(/no canonical 4D version/);
    expect(getExplainer(SHAPE_IDS.mug)!.tiers.intermediate).toMatch(/No canonical 4D mug/);
    // Hopf: circles filling S^3, every pair linked, nested tori.
    const h = getExplainer(SHAPE_IDS.hopf)!;
    expect(h.tiers.eli5).toMatch(/filled completely with circles/);
    expect(h.tiers.eli5).toMatch(/linked/);
    expect(h.tiers.eli5).toMatch(/nested doughnut/);
    expect(h.tiers.intermediate).toMatch(/every two are linked once/);
    expect(h.tiers.intermediate).toMatch(/nested tori/);
  });

  it('quotes numbers that agree with MATH.md', () => {
    // §8: 5-cell hypervolume √5/96 · a^4 with a = 2√2 (§8.1) is 2√5/3.
    expect((Math.sqrt(5) / 96) * (2 * Math.SQRT2) ** 4).toBeCloseTo((2 * Math.sqrt(5)) / 3, 12);
    expect(getExplainer(SHAPE_IDS.cell5)!.tiers.intermediate).toContain('2√5/3');
    // §8.1: apex-to-base distance equals the base edge 2√2.
    expect(Math.sqrt(3 + (5 / Math.sqrt(5)) ** 2)).toBeCloseTo(2 * Math.SQRT2, 12);
    // 16-cell: octahedron slices (4/3)(1 − |c|)^3 integrate to the §8 hypervolume 2/3
    // (exact antiderivative: 2 · (4/3) · 1/4); midpoint rule with 2000 steps has
    // error O(h^2) ≈ 1e-6, hence 5 decimals.
    let v = 0;
    const n = 2000;
    for (let i = 0; i < n; i++) {
      const c = -1 + ((i + 0.5) * 2) / n;
      v += (4 / 3) * (1 - Math.abs(c)) ** 3 * (2 / n);
    }
    expect(v).toBeCloseTo(2 / 3, 5);
    // 24-cell central slice: cube 8 minus eight corner tets of volume 1/6 = 20/3.
    expect(8 - 8 / 6).toBeCloseTo(20 / 3, 12);
    expect(getExplainer(SHAPE_IDS.cell24)!.tiers.intermediate).toContain('20/3');
    // §8.5: ∫ (4/3)π(R²−c²)^{3/2} dc over [−R, R] = π²R⁴/2 (R = 1); midpoint rule,
    // integrand is C^1 with bounded second derivative away from ±1 and the
    // endpoint behaviour (1−c²)^{3/2} is tame, so 2000 steps give 5 decimals.
    let b = 0;
    for (let i = 0; i < n; i++) {
      const c = -1 + ((i + 0.5) * 2) / n;
      b += (4 / 3) * Math.PI * (1 - c * c) ** 1.5 * (2 / n);
    }
    expect(b).toBeCloseTo(Math.PI ** 2 / 2, 5);
  });
});

// ---- Numerical helpers for the checks below ----------------------------------

/** Composite Simpson rule; exact for cubics, error O(h⁴) for smooth integrands. */
function simpson(f: (x: number) => number, a: number, b: number, n = 2000): number {
  const h = (b - a) / n;
  let s = f(a) + f(b);
  for (let i = 1; i < n; i++) s += f(a + i * h) * (i % 2 === 0 ? 2 : 4);
  return (s * h) / 3;
}

/**
 * ∫_{−r}^{r} g(a(c)) dc with a(c) = √(r² − c²). The substitution c = r sin θ
 * (a = r cos θ, dc = r cos θ dθ) removes the square-root endpoint
 * singularity, so Simpson converges at its usual O(h⁴) rate.
 */
const overChord = (r: number, g: (a: number) => number): number =>
  simpson((t) => g(r * Math.cos(t)) * r * Math.cos(t), -Math.PI / 2, Math.PI / 2);

/**
 * ∫∫ g(u, v) du dv over the disc of radius r about the origin, in polar
 * coordinates: periodic trapezoid in the angle (exact for trigonometric
 * polynomials of degree below 64, and g is a polynomial of degree ≤ 4 here)
 * and Simpson in the radius.
 */
function overDisc(r: number, g: (u: number, v: number) => number): number {
  const m = 64;
  const angular = (rho: number): number => {
    let s = 0;
    for (let k = 0; k < m; k++) {
      const phi = (2 * Math.PI * k) / m;
      s += g(rho * Math.cos(phi), rho * Math.sin(phi));
    }
    return (s * 2 * Math.PI) / m;
  };
  return simpson((rho) => rho * angular(rho), 0, r, 200);
}

const text = (id: string, tier: Tier): string => getExplainer(id)!.tiers[tier];

describe('explainers for spin, signed distance fields, imports, XR and Flatland', () => {
  it('every new topic exists with three tiers and quotes no parameter that MATH.md does not state', () => {
    expect(NEW_IDS.length).toBe(9 + 4 + FLAT_TOPICS.length);
    expect(FLAT_TOPICS.map((t) => `flat:${t}`)).toEqual([
      'flat:intro', 'flat:projection', 'flat:slice', 'flat:rotation',
      ...FLAT_SHAPE_IDS.map((s) => `flat:${s}`),
    ]);
    for (const id of NEW_IDS) {
      const e = getExplainer(id);
      expect(e, id).toBeDefined();
      for (const tier of TIERS) {
        // The radii and heights of the catalogue figures (0.3, 1.1, ...) are
        // implementation choices, not MATH.md facts, so no decimal literal may
        // appear; section numbers such as §9.2 are the only decimals allowed.
        expect(e!.tiers[tier], `${id}/${tier}`).not.toMatch(/(?<!§)\b\d+\.\d+\b/);
      }
    }
  });

  it('no topic still claims that spin or signed distance fields are missing from the build', () => {
    for (const e of listExplainers()) {
      for (const tier of TIERS) expect(e.tiers[tier], `${e.id}/${tier}`).not.toMatch(/not in this build|not yet/i);
    }
    expect(text('lift:extrude', 'math')).toMatch(/spinning <code>S<\/code> about a plane \(§9\.2\)/);
    expect(text('lift:extrude', 'math')).toMatch(/signed distance fields \(§9\.3\)/);
    expect(text('lift:extrude', 'eli5')).toMatch(/spinning/);
    expect(text(SHAPE_IDS.human, 'intermediate')).toMatch(/Spun human/);
    expect(text(SHAPE_IDS.human, 'intermediate')).toMatch(/no canonical 4D version/);
    // The introduction points at every new family.
    const intro = text('intro', 'intermediate');
    for (const word of ['spin', 'signed distance field', 'import', 'Flatland', 'XR']) expect(intro).toMatch(new RegExp(word, 'i'));
    expect(text('intro', 'eli5')).toMatch(/Flatland/);
  });

  it('the spin topics state the facts of §9.2: mirror twins, 4-ball, Pappus, polygon factor', () => {
    expect(text('lift:spin', 'eli5')).toMatch(/mirror twins/);
    expect(text('lift:spin', 'eli5')).toMatch(/half-ball/);
    expect(text('lift:spin', 'intermediate')).toMatch(/mirror twins/);
    expect(text('lift:spin', 'intermediate')).toMatch(/Pappus/);
    expect(text('lift:spin', 'intermediate')).toContain('π² R⁴ / 2');
    expect(text('lift:spin', 'math')).toContain('(N/(2π)) sin(2π/N)');
    expect(text('lift:spin', 'math')).toContain('√(z² + c²)');
    expect(text('lift:spin', 'intermediate')).toMatch(/first clipped to <code>z ≥ 0<\/code>/);
    expect(text('lift:spin', 'eli5')).toMatch(/cuts away the part below it/);
    expect(text(SHAPE_IDS.spunHalfBall, 'intermediate')).toContain('x² + y² + z² + w² ≤ R²');
    expect(text(SHAPE_IDS.spunHalfBall, 'intermediate')).toContain('3R/8');
    expect(text(SHAPE_IDS.spunBall, 'intermediate')).toContain('2π z_0 · (4/3)π r³');
    expect(text(SHAPE_IDS.spunCube, 'intermediate')).toContain('2π z_0 s³');
  });

  it('Pappus (§9.2) for the half-ball: 2π ∫ z dV over the half-ball is π² R⁴/2, the 4-ball of §8.5', () => {
    // §9.2: vol_4 = 2π ∫_S z dV. The half-ball {|p| ≤ R, z ≥ 0} has horizontal
    // slices of area π (R² − z²), so ∫ z dV = ∫_0^R z π (R² − z²) dz = π R⁴/4;
    // the integrand is a cubic in z, which Simpson integrates exactly (round-off only).
    for (const R of [0.5, 1, 2]) {
      const moment = simpson((z) => z * Math.PI * (R * R - z * z), 0, R, 10);
      expect(moment).toBeCloseTo((Math.PI * R ** 4) / 4, 12);
      expect(2 * Math.PI * moment).toBeCloseTo((Math.PI ** 2 * R ** 4) / 2, 12);
      // Centroid height 3R/8 times the volume (2/3)π R³, as quoted.
      expect(2 * Math.PI * ((3 * R) / 8) * ((2 / 3) * Math.PI * R ** 3)).toBeCloseTo((Math.PI ** 2 * R ** 4) / 2, 12);
      // Cavalieri over the slice balls of radius √(R² − c²) (§8.5); chord substitution, Simpson.
      const cav = overChord(R, (a) => (4 / 3) * Math.PI * a ** 3);
      expect(cav).toBeCloseTo((Math.PI ** 2 * R ** 4) / 2, 9);
    }
  });

  it('the discretisation factor (N/(2π)) sin(2π/N) is the ratio of the regular N-gon area to the disc area', () => {
    // A regular N-gon of circumradius z has area (N/2) z² sin(2π/N) (N triangles
    // with apex angle 2π/N), computed here independently by the shoelace formula;
    // the disc has π z². Round-off tolerance only.
    for (const N of [3, 8, 36, 48]) {
      let twiceArea = 0;
      for (let k = 0; k < N; k++) {
        const a = (2 * Math.PI * k) / N;
        const b = (2 * Math.PI * (k + 1)) / N;
        twiceArea += Math.cos(a) * Math.sin(b) - Math.cos(b) * Math.sin(a);
      }
      expect(twiceArea / 2 / Math.PI).toBeCloseTo(((N / (2 * Math.PI)) * Math.sin((2 * Math.PI) / N)), 12);
    }
    const f48 = (48 / (2 * Math.PI)) * Math.sin((2 * Math.PI) / 48);
    expect(f48).toBeGreaterThan(0.99);
    expect(f48).toBeLessThan(1);
  });

  it('spun ball and spun cube: twins stretch, touch and vanish where the explainers say', () => {
    // Ball of radius r at height z0 > r (§9.2). With ζ = √(z² + c²) the slice
    // x² + y² + (ζ − z0)² ≤ r² spans depth z ∈ [a, b], a = √((z0 − r)² − c²),
    // b = √((z0 + r)² − c²). Identity: b − a = (b² − a²)/(a + b) = 4 z0 r/(a + b),
    // and a + b ≤ 2 z0, so b − a ≥ 2r with equality only at c = 0.
    const z0 = 2;
    const r = 0.5;
    for (const c of [0, 0.3, 1, 1.4, 1.49]) {
      const a = Math.sqrt((z0 - r) ** 2 - c * c);
      const b = Math.sqrt((z0 + r) ** 2 - c * c);
      expect(b - a).toBeCloseTo((4 * z0 * r) / (a + b), 12);
      expect(b - a).toBeGreaterThanOrEqual(2 * r - 1e-12);
      if (c === 0) expect(b - a).toBeCloseTo(2 * r, 12);
      else expect(b - a).toBeGreaterThan(2 * r);
    }
    // The twins meet in the plane z = 0 where the slice contains the origin: its ball condition is
    // (√(0 + c²) − z0)² ≤ r², i.e. |c − z0| ≤ r. So they touch at |c| = z0 − r (boundary), are joined
    // for z0 − r ≤ |c| ≤ z0 + r, and have vanished beyond z0 + r.
    const originIn = (cc: number): number => Math.abs(Math.abs(cc) - z0) - r; // ≤ 0 iff the origin is in the slice
    expect(originIn(z0 - r)).toBeCloseTo(0, 12);
    expect(originIn(z0 - r - 0.01)).toBeGreaterThan(0);
    expect(originIn(z0 - r + 0.01)).toBeLessThan(0);
    expect(originIn(z0 + r + 0.01)).toBeGreaterThan(0);

    // Cube of side s at height z0 > s/2: the slice is exactly two boxes, because the
    // cube's faces at ζ = z0 ± s/2 are the planes z = ±√(ζ² − c²). Membership of
    // (x, y, z) in the slice is |√(z² + c²) − z0| ≤ s/2, which must equal a ≤ |z| ≤ b.
    const s = 1;
    const zc = 1.2;
    const c = 0.4;
    const a = Math.sqrt((zc - s / 2) ** 2 - c * c);
    const b = Math.sqrt((zc + s / 2) ** 2 - c * c);
    let mismatches = 0;
    for (let i = 0; i < 4000; i++) {
      const z = -2.5 + (5 * (i + 0.5)) / 4000;
      const inSlice = Math.abs(Math.sqrt(z * z + c * c) - zc) <= s / 2;
      const inBoxes = Math.abs(z) >= a && Math.abs(z) <= b;
      if (inSlice !== inBoxes) mismatches++;
    }
    expect(mismatches).toBe(0);
    expect(b - a).toBeCloseTo((2 * zc * s) / (a + b), 12);
    expect(b - a).toBeGreaterThan(s);
    // Hypervolume: square (s²) times annulus (π((z0 + s/2)² − (z0 − s/2)²)) equals Pappus 2π z0 s³.
    expect(s * s * Math.PI * ((zc + s / 2) ** 2 - (zc - s / 2) ** 2)).toBeCloseTo(2 * Math.PI * zc * s ** 3, 12);
    // Cavalieri: the chord of the annulus Ri ≤ √(z² + w²) ≤ Ro at w = c has length
    // 2√(Ro² − c²) − 2√(Ri² − c²) (|c| < Ri, the two boxes) or 2√(Ro² − c²) (the slab), and its
    // integral over c is the annulus area π(Ro² − Ri²). Midpoint rule from the definition; the
    // square-root endpoints cost O(h^{3/2}) ≈ 1e-8 at 400000 steps, so 6 decimals is safe.
    const Ro = zc + s / 2;
    const Ri = zc - s / 2;
    const steps = 400000;
    let area = 0;
    for (let i = 0; i < steps; i++) {
      const cc = -Ro + ((i + 0.5) * 2 * Ro) / steps;
      const chord = 2 * Math.sqrt(Ro * Ro - cc * cc) - (Math.abs(cc) < Ri ? 2 * Math.sqrt(Ri * Ri - cc * cc) : 0);
      area += (chord * 2 * Ro) / steps;
    }
    expect(area).toBeCloseTo(Math.PI * (Ro * Ro - Ri * Ri), 6);
  });

  it('the Torisphere is the Spun ball turned by a quarter turn in XZ and in YW (§2.1, §9.2, §9.3)', () => {
    // T = R_YW(π/2) R_XZ(π/2) acts as (x, y, z, w) ↦ (−z, −w, x, y) (§2.1: R_ij e_i = cos θ e_i + sin θ e_j).
    const T = mul4(rotation('YW', Math.PI / 2), rotation('XZ', Math.PI / 2));
    expect(determinant4(T)).toBeCloseTo(1, 12);
    const p: Vec4 = [0.3, -0.7, 0.2, 0.5];
    const q = apply4(T, p);
    expect(q[0]).toBeCloseTo(-p[2], 12);
    expect(q[1]).toBeCloseTo(-p[3], 12);
    expect(q[2]).toBeCloseTo(p[0], 12);
    expect(q[3]).toBeCloseTo(p[1], 12);
    // The torisphere field (circle in xy) at p equals the spun-ball field (circle in zw)
    // at T p: (√(x²+y²) − R)² + z² + w² − r² is exchanged with
    // x² + y² + (√(z²+w²) − z0)² − r² for z0 = R. Compare the library field with the
    // closed form of the spun ball.
    const R = 0.7;
    const r = 0.3;
    const spunBallField = (v: Vec4): number => Math.sqrt(v[0] ** 2 + v[1] ** 2 + (Math.hypot(v[2], v[3]) - R) ** 2) - r;
    for (const pt of [p, [0.6, 0.1, 0.1, 0.1], [0.1, 0.2, 0.7, 0.0], [0, 0, 0, 0]] as Vec4[]) {
      expect(spunBallField(apply4(T, pt))).toBeCloseTo(torisphere(R, r)(pt), 12);
    }
  });

  it('spheritorus (tube around a sphere): slice shell, volume 4π²R²r² + π²r⁴, and it is not the torisphere value', () => {
    const R = 0.7;
    const r = 0.3;
    const f = spheritorus(R, r);
    for (const c of [0, 0.1, 0.25]) {
      const a = Math.sqrt(r * r - c * c);
      // The slice is the shell R − a ≤ |q| ≤ R + a: both radii lie on f = 0, the mid-radius R is inside.
      expect(f([R + a, 0, 0, c])).toBeCloseTo(0, 12);
      expect(f([0, 0, R - a, c])).toBeCloseTo(0, 12);
      expect(f([R, 0, 0, c])).toBeLessThan(0);
      expect(f([R + a + 0.01, 0, 0, c])).toBeGreaterThan(0);
    }
    // Beyond |c| = r no point of the slice is inside: min over q of f is |c| − r > 0 (at |q| = R).
    expect(f([R, 0, 0, r + 0.05])).toBeGreaterThan(0);
    // Slice volume (4π/3)((R + a)³ − (R − a)³) = 8πR²a + (8π/3)a³; Cavalieri.
    const exact = 4 * Math.PI ** 2 * R * R * r * r + Math.PI ** 2 * r ** 4;
    const shell = overChord(r, (a) => (4 * Math.PI / 3) * ((R + a) ** 3 - (R - a) ** 3));
    expect(shell).toBeCloseTo(exact, 9);
    // Independent route: ∫∫ 4π s² ds dw over the disc (s − R)² + w² ≤ r² (§9.3 text, Pappus-type argument).
    expect(overDisc(r, (u) => 4 * Math.PI * (R + u) ** 2)).toBeCloseTo(exact, 9);
    // The table of §9.3 prints 2πR · (4/3)π r³ on this row; that is the torisphere's value and differs here.
    const swept = 2 * Math.PI * R * (4 / 3) * Math.PI * r ** 3;
    expect(exact / swept).toBeGreaterThan(3);
    expect(text(SHAPE_IDS.sdfSpheritorus, 'math')).toContain('4π² R² r² + π² r⁴');
    expect(text(SHAPE_IDS.sdfSpheritorus, 'math')).toContain('8π R² a + (8π/3) a³');
    expect(text(SHAPE_IDS.sdfSpheritorus, 'math')).not.toContain('2πR · (4/3)π r³</code>, the 4-volume');
    expect(text(SHAPE_IDS.sdfSpheritorus, 'intermediate')).toMatch(/Not to be confused with the Torisphere/);
    expect(text('sdf', 'math')).toContain('4π² R² r² + π² r⁴');
  });

  it('torisphere (tube around a circle): slice solid torus and the volume 2πR · (4/3)π r³', () => {
    const R = 0.7;
    const r = 0.3;
    const f = torisphere(R, r);
    for (const c of [0, 0.1, 0.25]) {
      const a = Math.sqrt(r * r - c * c);
      // Solid torus with core radius R and tube radius a: boundary points (R ± a, 0, 0) and (R, 0, ±a).
      expect(f([R + a, 0, 0, c])).toBeCloseTo(0, 12);
      expect(f([R - a, 0, 0, c])).toBeCloseTo(0, 12);
      expect(f([R, 0, a, c])).toBeCloseTo(0, 12);
      expect(f([R, 0, 0, c])).toBeLessThan(0);
    }
    // Slice volume 2π² R a² (Pappus), Cavalieri equals 2πR · (4/3)π r³.
    const vol = overChord(r, (a) => 2 * Math.PI ** 2 * R * a * a);
    expect(vol).toBeCloseTo(2 * Math.PI * R * (4 / 3) * Math.PI * r ** 3, 9);
    expect(text(SHAPE_IDS.sdfTorisphere, 'math')).toContain('2πR · (4/3)π r³');
    expect(text(SHAPE_IDS.sdfTorisphere, 'eli5')).toMatch(/same solid as the Spun ball/);
  });

  it('tiger: two round solid tori at w = 0, touching at |c| = R₂ − r, vanishing at |c| = R₂ + r; volume 4π³R₁R₂r²', () => {
    const R1 = 0.6;
    const R2 = 0.7;
    const r = 0.25;
    const f = tiger(R1, R2, r);
    // At c = 0 the field is √((ρ − R1)² + (|z| − R2)²) − r: the core circles (ρ, z) = (R1, ±R2) are
    // inside (f = −r) and the tube circles about them, e.g. at (R1 + r, ±R2) and (R1, ±(R2 + r)), lie
    // on f = 0: two coaxial solid tori at z = ±R2, mirror images.
    for (const sign of [1, -1]) {
      expect(f([R1, 0, sign * R2, 0])).toBeCloseTo(-r, 12);
      expect(f([R1 + r, 0, sign * R2, 0])).toBeCloseTo(0, 12);
      expect(f([R1, 0, sign * (R2 + r), 0])).toBeCloseTo(0, 12);
    }
    // Between them, at (ρ, z) = (R1, 0) and c = 0, √(z² + w²) = 0 so f = √(0 + (0 − R2)²) − r = R2 − r > 0:
    // outside, so at c = 0 the two tori are separate.
    expect(f([R1, 0, 0, 0])).toBeCloseTo(R2 - r, 12);
    // At offset c the same point (R1, 0, 0, c) has √(z² + w²) = |c|, so f = |R2 − |c|| − r: inside (< 0)
    // exactly when R2 − r < |c| < R2 + r, zero at the two ends. That is where the twins touch and vanish.
    expect(f([R1, 0, 0, R2 - r - 0.01])).toBeGreaterThan(0);
    expect(f([R1, 0, 0, R2 - r])).toBeCloseTo(0, 12);
    expect(f([R1, 0, 0, R2 - r + 0.01])).toBeLessThan(0);
    expect(f([R1, 0, 0, R2 + r])).toBeCloseTo(0, 12);
    expect(f([R1, 0, 0, R2 + r + 0.01])).toBeGreaterThan(0);
    // Volume: ∫∫ (2πρ1)(2πρ2) over the disc of radius r about (R1, R2) = 4π³ R1 R2 r².
    const vol = overDisc(r, (u, v) => 4 * Math.PI ** 2 * (R1 + u) * (R2 + v));
    expect(vol).toBeCloseTo(4 * Math.PI ** 3 * R1 * R2 * r * r, 9);
    // As a spun solid (§9.2): solid torus volume 2π² R1 r² at centroid height R2 → Pappus.
    expect(2 * Math.PI * R2 * (2 * Math.PI ** 2 * R1 * r * r)).toBeCloseTo(4 * Math.PI ** 3 * R1 * R2 * r * r, 12);
    const t = text(SHAPE_IDS.sdfTiger, 'math');
    expect(t).toContain('4π³ R_1 R_2 r²');
    expect(t).toMatch(/two components/);
    expect(text(SHAPE_IDS.sdfTiger, 'intermediate')).toMatch(/coaxial about the <code>z<\/code> axis and mirror images/);
  });

  it('ditorus: slice is a hollow torus with wall R₂ ± a; Cavalieri gives 2πR₁ · 2πR₂ · πr²', () => {
    const R1 = 0.6;
    const R2 = 0.25;
    const r = 0.1;
    const f = ditorus(R1, R2, r);
    for (const c of [0, 0.05, 0.09]) {
      const a = Math.sqrt(r * r - c * c);
      // Points at distance s = R2 ± a from the core circle (here along the xy plane, z = 0) are on f = 0.
      expect(f([R1 + R2 + a, 0, 0, c])).toBeCloseTo(0, 12);
      expect(f([R1 + R2 - a, 0, 0, c])).toBeCloseTo(0, 12);
      expect(f([R1 + R2, 0, 0, c])).toBeLessThan(0);
      expect(f([R1, 0, 0, c])).toBeGreaterThan(0); // the hollow: the core circle is outside the wall
    }
    // A(c) = 2π² R1 ((R2 + a)² − (R2 − a)²) = 8π² R1 R2 a (difference of two solid tori, Pappus).
    for (const a of [0.02, 0.1]) {
      expect(2 * Math.PI ** 2 * R1 * ((R2 + a) ** 2 - (R2 - a) ** 2)).toBeCloseTo(8 * Math.PI ** 2 * R1 * R2 * a, 12);
    }
    expect(overChord(r, (a) => 8 * Math.PI ** 2 * R1 * R2 * a)).toBeCloseTo(2 * Math.PI * R1 * 2 * Math.PI * R2 * Math.PI * r * r, 9);
    expect(text(SHAPE_IDS.sdfDitorus, 'math')).toContain('2π R_1 · 2π R_2 · π r²');
  });

  it('capsule volume π²r⁴/2 + (4/3)π r³ |b − a| and the smooth minimum quoted in §9.3', () => {
    // Capsule from the origin to (0, 0, 0, L): the slice w = c is a ball of radius r for 0 ≤ c ≤ L,
    // and balls of radius √(r² − c²) on the two end caps: (4/3)π r³ L + ∫_{−r}^{r} (4/3)π (r² − c²)^{3/2} dc.
    const r = 0.4;
    const L = 1.3;
    const caps = overChord(r, (a) => (4 / 3) * Math.PI * a ** 3);
    expect(caps).toBeCloseTo((Math.PI ** 2 * r ** 4) / 2, 9);
    expect((4 / 3) * Math.PI * r ** 3 * L + caps).toBeCloseTo((Math.PI ** 2 * r ** 4) / 2 + (4 / 3) * Math.PI * r ** 3 * L, 12);
    // The library capsule is a distance: on the axis the field is −r at the segment and the end cap at distance r is 0.
    const cap = capsule([0, 0, 0, 0], [0, 0, 0, L], r);
    expect(cap([0, 0, 0, L / 2])).toBeCloseTo(-r, 12);
    expect(cap([0, 0, 0, L + r])).toBeCloseTo(0, 12);
    expect(cap([r, 0, 0, L / 2])).toBeCloseTo(0, 12);
    // smin_k(f, g) = min(f, g) − h²/(4k), h = max(k − |f − g|, 0): never above the minimum,
    // k/4 below it where f = g, equal to it once |f − g| ≥ k.
    const k = 0.2;
    expect(smoothMin(0.5, 0.5, k)).toBeCloseTo(0.5 - k / 4, 12);
    expect(smoothMin(0.1, 0.1 + k, k)).toBeCloseTo(0.1, 12);
    for (const [f, g] of [[0.3, 0.35], [-0.1, 0.05], [0.2, 0.9]]) expect(smoothMin(f, g, k)).toBeLessThanOrEqual(Math.min(f, g));
    expect(text('sdf', 'math')).toContain('π² r⁴/2 + (4/3)π r³ |b − a|');
    expect(text('sdf', 'math')).toContain('min(f, g) − h²/(4k)');
    expect(text('sdf', 'math')).toContain('4! = 24');
    expect(text('sdf', 'eli5')).toMatch(/approximation/);
    expect(text('sdf', 'intermediate')).toMatch(/marching tetrahedra on a grid/);
    expect(text('sdf', 'intermediate')).toMatch(/closed 3-manifold in <code>R⁴<\/code>/);
    expect(text('sdf', 'math')).toMatch(/\(ac, ad, ae\)/);
  });

  it('Flatland cube: perspective scales, the regular hexagon, and the corner-to-corner sequence (§11)', () => {
    // §11: the cube from d = 3 has scales d/(d − z) = 3/2 at z = 1 and 3/4 at z = −1.
    expect(3 / (3 - 1)).toBe(1.5);
    expect(3 / (3 + 1)).toBe(0.75);
    // Plane x + y + z = 0 meets the cube's edges (two coordinates ±1) at the six permutations of (1, −1, 0).
    const pts: Vec3[] = [[1, -1, 0], [1, 0, -1], [0, 1, -1], [-1, 1, 0], [-1, 0, 1], [0, -1, 1]];
    const u1: Vec3 = [1 / Math.SQRT2, -1 / Math.SQRT2, 0];
    const u2: Vec3 = [1 / Math.sqrt(6), 1 / Math.sqrt(6), -2 / Math.sqrt(6)];
    const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    for (const p of pts) expect(p[0] + p[1] + p[2]).toBe(0);
    const chart = pts.map((p) => [dot(p, u1), dot(p, u2)] as const).sort((a, b) => Math.atan2(a[1], a[0]) - Math.atan2(b[1], b[0]));
    let twiceArea = 0;
    for (let i = 0; i < 6; i++) {
      const [x0, y0] = chart[i];
      const [x1, y1] = chart[(i + 1) % 6];
      expect(Math.hypot(x1 - x0, y1 - y0)).toBeCloseTo(Math.SQRT2, 12); // side √2
      twiceArea += x0 * y1 - x1 * y0;
    }
    expect(twiceArea / 2).toBeCloseTo(3 * Math.sqrt(3), 12); // area 3√3 = (3√3/2)(√2)²
    // A(k) of the plane x + y + z = k: √3 times the area of {(x, y) ∈ [−1, 1]² : −1 ≤ k − x − y ≤ 1}
    // (the area element of a plane with normal (1,1,1) over the xy plane is √3 dx dy).
    const bruteArea = (k: number): number =>
      Math.sqrt(3) * simpson((x) => Math.max(0, Math.min(1, k - x + 1) - Math.max(-1, k - x - 1)), -1, 1, 40000);
    // The closed form quoted in the explainer's derivation: triangles (√3/2)(3 − |k|)² for 1 ≤ |k| ≤ 3,
    // hexagon (√3/2)((3 − |k|)² − 3(1 − |k|)²) = (√3/2)(6 − 2k²) for |k| ≤ 1.
    const A = (k: number): number => {
      const a = Math.abs(k);
      if (a >= 3) return 0;
      return a >= 1 ? (Math.sqrt(3) / 2) * (3 - a) ** 2 : (Math.sqrt(3) / 2) * ((3 - a) ** 2 - 3 * (1 - a) ** 2);
    };
    // Kinks of the piecewise-linear integrand cost Simpson O(h²) = O(1e-9) here; 6 decimals is safe.
    for (const k of [0, 0.5, -0.8, 1.5, -2.5, 2.9]) expect(bruteArea(k)).toBeCloseTo(A(k), 6);
    expect(A(0)).toBeCloseTo(3 * Math.sqrt(3), 12);
    // Cavalieri (§11): ∫ A dk/√3 = 8 = 2³, the three polynomial pieces integrated exactly by Simpson.
    const vol = (simpson(A, -3, -1, 2) + simpson(A, -1, 1, 2) + simpson(A, 1, 3, 2)) / Math.sqrt(3);
    expect(vol).toBeCloseTo(8, 12);
    // The explainers state these facts.
    for (const tier of ['intermediate', 'math'] as const) {
      expect(text('flat:cube', tier)).toContain('3√3');
      expect(text('flat:cube', tier)).toContain('3/2');
      expect(text('flat:cube', tier)).toContain('3/4');
      expect(text('flat:cube', tier)).toContain('√2');
    }
    expect(text('flat:intro', 'intermediate')).toContain('point, triangle, hexagon, triangle, point');
    expect(text('flat:intro', 'intermediate')).toContain('π(R² − c²)');
    expect(text('flat:slice', 'math')).toContain('3√3');
    // The Flatland overlay view shows the slice topic, so it explains the overlay scale d/(d − c).
    for (const tier of ['intermediate', 'math'] as const) expect(text('flat:slice', tier)).toContain('d/(d − c)');
    expect(text('flat:slice', 'eli5')).toMatch(/overlay view/);
  });

  it('Flatland tetrahedron, octahedron, ball, torus, cylinder, rotation: the quoted numbers', () => {
    // Tetrahedron on alternate corners of [−1, 1]³ (§8.1 base cell): edge 2√2, volume 8/3.
    const v: Vec3[] = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]];
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
      expect(Math.hypot(v[i][0] - v[j][0], v[i][1] - v[j][1], v[i][2] - v[j][2])).toBeCloseTo(2 * Math.SQRT2, 12);
    }
    const e = (p: Vec3, q: Vec3): Vec3 => [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
    const [a, b, c] = [e(v[0], v[1]), e(v[0], v[2]), e(v[0], v[3])];
    const det = a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
    expect(Math.abs(det) / 6).toBeCloseTo(8 / 3, 12);
    // Plane x = 0: two vertices on each side; the crossings of the four mixed edges (t = s_p/(s_p − s_q) = 1/2).
    const pos = v.filter((p) => p[0] >= 0);
    const neg = v.filter((p) => p[0] < 0);
    expect([pos.length, neg.length]).toEqual([2, 2]);
    const cross: Vec3[] = [];
    for (const p of pos) for (const q of neg) {
      const t = p[0] / (p[0] - q[0]);
      expect(t).toBe(0.5);
      cross.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1]), p[2] + t * (q[2] - p[2])]);
    }
    const key = (p: Vec3): string => p.map((x) => Math.round(x)).join(',');
    expect(cross.map(key).sort()).toEqual(['0,-1,0', '0,0,-1', '0,0,1', '0,1,0'].sort());
    // Octahedron |x| + |y| + |z| ≤ 1: slice square |x| + |y| ≤ 1 − |c| of area 2(1 − |c|)²; ∫ = 4/3 = 8 · (1/6).
    const octVol = simpson((cc) => 2 * (1 - Math.abs(cc)) ** 2, -1, 0, 2) + simpson((cc) => 2 * (1 - Math.abs(cc)) ** 2, 0, 1, 2);
    expect(octVol).toBeCloseTo(4 / 3, 12);
    // Ball: ∫ π(R² − c²) dc = (4/3)π R³.
    for (const R of [1, 2.5]) expect(simpson((cc) => Math.PI * (R * R - cc * cc), -R, R, 4)).toBeCloseTo((4 / 3) * Math.PI * R ** 3, 10);
    // Torus: ring area 4πR a, ∫ over c = 2π² R r² (Pappus).
    const Rt = 1;
    const rt = 0.4;
    expect(overChord(rt, (aa) => 4 * Math.PI * Rt * aa)).toBeCloseTo(2 * Math.PI ** 2 * Rt * rt * rt, 9);
    expect(Math.PI * ((Rt + 0.3) ** 2 - (Rt - 0.3) ** 2)).toBeCloseTo(4 * Math.PI * Rt * 0.3, 12);
    // Rotation: R_XZ(θ) has z row (sin θ, 0, cos θ) (§2.1 restricted); the cube tilted by π/4 and
    // cut at z = 0 is the section by x + z = 0: the rectangle with corners (±1, ±1, ∓1), 2 × 2√2.
    const th = Math.PI / 4;
    const Rxz = rotation('XZ', th);
    expect(Rxz[2 * 4 + 0]).toBeCloseTo(Math.sin(th), 12);
    expect(Rxz[2 * 4 + 2]).toBeCloseTo(Math.cos(th), 12);
    const corners: Vec3[] = [[-1, 1, 1], [-1, -1, 1], [1, -1, -1], [1, 1, -1]];
    for (const p of corners) expect(p[0] + p[2]).toBe(0);
    expect(Math.hypot(...e(corners[0], corners[1]))).toBeCloseTo(2, 12);
    expect(Math.hypot(...e(corners[1], corners[2]))).toBeCloseTo(2 * Math.SQRT2, 12);
    expect(2 * 2 * Math.SQRT2).toBeCloseTo(4 * Math.SQRT2, 12);
    // The explainers carry them.
    expect(text('flat:tetrahedron', 'math')).toContain('8/3');
    expect(text('flat:tetrahedron', 'math')).toContain('2√2');
    expect(text('flat:octahedron', 'intermediate')).toContain('2(1 − |c|)²');
    expect(text('flat:octahedron', 'math')).toContain('4/3');
    expect(text('flat:ball', 'math')).toContain('(4/3)π R³');
    expect(text('flat:torus', 'math')).toContain('2π² R r²');
    expect(text('flat:rotation', 'intermediate')).toContain('4√2');
    expect(text('flat:rotation', 'math')).toContain('(sin θ, 0, cos θ)');
    expect(text('flat:cylinder', 'intermediate')).toMatch(/sheared slab/);
  });

  it('imports and XR: the facts of §12 and §4/§6', () => {
    const i = text('import', 'intermediate');
    expect(i).toMatch(/welded/);
    expect(i).toMatch(/bounding radius/);
    expect(i).toMatch(/is 1\./);
    expect(i).toMatch(/exactly two triangles/);
    expect(i).toMatch(/signed volume of a closed model is negative its triangles are reversed/);
    expect(i).toMatch(/open surfaces/);
    expect(text('import', 'eli5')).toMatch(/radius 1/);
    expect(text('import', 'eli5')).toMatch(/closed/);
    expect(text('import', 'math')).toMatch(/max \|v − c\|/);
    expect(text('import', 'math')).toMatch(/\(a, b\)<\/code> and <code>\(b, a\)/);
    // §12 normalisation: v ↦ (v − c)/ρ with ρ = max |v − c| gives bounding radius 1 (re-centred at the box centre).
    const verts: Vec3[] = [[0, 0, 0], [4, 0, 0], [0, 2, 0], [1, 1, 6]];
    const lo = [0, 1, 2].map((k) => Math.min(...verts.map((p) => p[k])));
    const hi = [0, 1, 2].map((k) => Math.max(...verts.map((p) => p[k])));
    const ctr = lo.map((l, k) => (l + hi[k]) / 2);
    const rho = Math.max(...verts.map((p) => Math.hypot(p[0] - ctr[0], p[1] - ctr[1], p[2] - ctr[2])));
    const radius = Math.max(...verts.map((p) => Math.hypot((p[0] - ctr[0]) / rho, (p[1] - ctr[1]) / rho, (p[2] - ctr[2]) / rho)));
    expect(radius).toBeCloseTo(1, 12);
    // XR places the slice in the room; the chart is an isometry with det(u1, u2, u3, n) = +1 (§4).
    expect(text('xr', 'eli5')).toMatch(/WebXR/);
    expect(text('xr', 'eli5')).toMatch(/in the room around you as a real object/);
    expect(text('xr', 'eli5')).toMatch(/walk around it/);
    expect(text('xr', 'intermediate')).toMatch(/isometry/);
    expect(text('xr', 'intermediate')).toContain('det(u_1, u_2, u_3, n) = +1');
    expect(text('xr', 'math')).toMatch(/orientation/);
  });
});


describe('explainer panel', () => {
  // Minimal stand-in for an HTMLElement: the panel uses innerHTML, classList and scrollTop only.
  function fakeContainer(): HTMLElement & { classes: Set<string> } {
    const classes = new Set<string>();
    const el = {
      innerHTML: '',
      scrollTop: 7,
      classes,
      classList: { add: (c: string) => { classes.add(c); } },
    };
    return el as unknown as HTMLElement & { classes: Set<string> };
  }

  it('shows intro by default and on show(null), switches tiers, and falls back for unknown ids', () => {
    const el = fakeContainer();
    const panel = mountExplainer(el);
    expect(el.classes.has('explainer-content')).toBe(true);
    expect(panel.getTier()).toBe('eli5');
    expect(el.innerHTML).toContain('Seeing the fourth dimension');
    expect(el.innerHTML).toContain('explainer-tier-eli5');
    expect(el.scrollTop).toBe(0);

    panel.show('tesseract');
    expect(el.innerHTML).toContain('<h2 class="explainer-title">Tesseract</h2>');
    expect(el.innerHTML).toContain('explainer-view-note');

    panel.setTier('math');
    expect(panel.getTier()).toBe('math');
    expect(el.innerHTML).toContain('explainer-tier-math');
    expect(el.innerHTML).toContain('[−1, 1]^4');

    panel.show(null);
    expect(el.innerHTML).toContain('Seeing the fourth dimension');
    expect(el.innerHTML).toContain('explainer-tier-math');

    panel.show('no:such-topic');
    expect(el.innerHTML).toContain('No explainer has been written');
    expect(el.innerHTML).toContain('no:such-topic');
  });

  it('shows the spin, SDF, import, XR and Flatland topics with their titles in every tier', () => {
    const el = fakeContainer();
    const panel = mountExplainer(el);
    for (const id of NEW_IDS) {
      for (const tier of TIERS) {
        panel.setTier(tier);
        panel.show(id);
        expect(el.innerHTML, `${id}/${tier}`).toContain(`<h2 class="explainer-title">${getExplainer(id)!.title.replace(/&/g, '&amp;')}</h2>`);
        expect(el.innerHTML, `${id}/${tier}`).toContain(`explainer-tier-${tier}`);
        expect(el.innerHTML, `${id}/${tier}`).not.toContain('No explainer has been written');
      }
    }
  });

  it('does not re-render when topic and tier are unchanged', () => {
    const el = fakeContainer();
    const panel = mountExplainer(el);
    panel.show('rotation:XW');
    el.scrollTop = 42;
    panel.show('rotation:XW');
    expect(el.scrollTop).toBe(42);
    panel.setTier('eli5');
    expect(el.scrollTop).toBe(42);
    panel.setTier('intermediate');
    expect(el.scrollTop).toBe(0);
  });
});
