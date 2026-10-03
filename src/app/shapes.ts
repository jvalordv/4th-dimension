/**
 * Shape registrations. Importing this module registers every shape of the
 * catalogue (README table; MATH.md §8 regular polytopes, §8.5–§8.6 curved
 * solids, §9.1 lifted 3D objects, §9.2 spun solids, §9.3 signed distance
 * fields) under its canonical SHAPE_IDS id, so the picker, the state store
 * and the explainer topics all agree on ids. Models the user imports (§12)
 * are registered at run time by src/app/import.ts, not here.
 *
 * Construction is lazy: an entry's `create` builds the shape on first use and
 * the viewer's ShapeCache keeps the instance, so registering is free and the
 * 120-cell (~100 ms) or the duocylinder are only built when selected.
 */
import { getShape, registerShape, SHAPE_IDS } from './registry';
import type { ShapeEntry } from './registry';
import { POLYTOPE_INFO, POLYTOPE_NAMES, polytopeShape } from '../geometry/polytopes';
import type { PolytopeName } from '../geometry/polytopes';
import { duocylinder, hopfShape, hypersphere } from '../geometry/curved';
import { LIFTED_SHAPES, SPUN_SHAPES } from '../geometry/figures';
import { SDF_SHAPES } from '../geometry/sdf-figures';

/** Three-decimal rendering of a derived number for a description. */
const approx = (x: number): string => x.toFixed(3);

/** The closed-form hypervolume recorded in POLYTOPE_INFO (MATH.md §8 table). */
function knownHypervolume(name: PolytopeName): number {
  const v = POLYTOPE_INFO[name].hypervolume;
  if (v === null) throw new Error(`shapes: ${name} has no closed-form hypervolume`);
  return v;
}

// ---- Regular polytopes (MATH.md §8) ----------------------------------------

/**
 * Wording around the generated counts clause of a polytope description. The
 * counts come from POLYTOPE_INFO (the §8 table); the edge lengths and
 * hypervolumes quoted in `tail` are §8 facts or POLYTOPE_INFO values.
 */
interface PolytopeBlurb {
  /** Opening clause, before the counts. */
  lead: string;
  /** Plural noun for the 2-faces. */
  faces: string;
  /** Adjective for the cells. */
  cells: string;
  /** Closing clause, after the counts. */
  tail: string;
}

const POLYTOPE_BLURBS: Readonly<Record<PolytopeName, PolytopeBlurb>> = {
  cell5: {
    // §8.1: every pair of vertices at distance a = 2√2; §8 table: √5/96 · a⁴,
    // and (2√2)⁴ = 64, so the hypervolume is 64√5/96 = 2√5/3 ≈ 1.491.
    lead: 'The 4D simplex, every pair of vertices at distance 2√2',
    faces: 'triangles',
    cells: 'tetrahedral',
    tail: `hypervolume √5/96 · (2√2)⁴ = 2√5/3 ≈ ${approx(knownHypervolume('cell5'))}`,
  },
  tesseract: {
    // §8: [−1, 1]⁴, hypervolume 16; §3.2: at d = 3 the w = ±1 cells are drawn
    // at scales 3/2 and 3/4, the cube inside a cube.
    lead: 'The 4D cube [−1, 1]⁴',
    faces: 'squares',
    cells: 'cubic',
    tail: `hypervolume ${knownHypervolume('tesseract')}, whose perspective projection from eye distance d = 3 is the familiar cube inside a cube`,
  },
  cell16: {
    // §8: vertices ±e_i, so edges join e_i to ±e_j at distance √2; hypervolume 2/3.
    lead: 'The 4D cross-polytope with vertices at ±eᵢ',
    faces: 'triangles',
    cells: 'tetrahedral',
    tail: 'edge length √2 and hypervolume 2/3',
  },
  cell24: {
    // §8: permutations of (±1, ±1, 0, 0), edge √2, hypervolume 8. It is
    // self-dual (24 vertices, 24 cells) and has no Platonic counterpart.
    lead: 'Vertices at the permutations of (±1, ±1, 0, 0)',
    faces: 'triangles',
    cells: 'octahedral',
    tail: 'edge length √2 and hypervolume 8, self-dual and with no counterpart among the Platonic solids',
  },
  cell120: {
    // §8.2: dual of the 600-cell, vertices at the normalised cell centroids
    // (unit 3-sphere). Edge 1/(√2 φ²) ≈ 0.270 is POLYTOPE_INFO's derived value.
    lead: 'The dual of the 600-cell, its vertices at the normalised centroids of the 600-cell’s cells on the unit 3-sphere',
    faces: 'pentagons',
    cells: 'dodecahedral',
    tail: `edge length 1/(√2 φ²) ≈ ${approx(POLYTOPE_INFO.cell120.edgeLength)}`,
  },
  cell600: {
    // §8.2: unit 3-sphere, edge 1/φ ≈ 0.618, 12 neighbours per vertex, so the
    // vertex figure is an icosahedron: 20 cells around a vertex, 5 around an edge.
    lead: 'The largest regular 4-polytope, inscribed in the unit 3-sphere',
    faces: 'triangles',
    cells: 'tetrahedral',
    tail: `edge length 1/φ ≈ ${approx(POLYTOPE_INFO.cell600.edgeLength)}, with 20 tetrahedra around every vertex and 5 around every edge`,
  },
};

function describePolytope(name: PolytopeName): string {
  const { counts } = POLYTOPE_INFO[name];
  const b = POLYTOPE_BLURBS[name];
  return `${b.lead}: ${counts.V} vertices, ${counts.E} edges, ${counts.F} ${b.faces} and ${counts.C} ${b.cells} cells, ${b.tail}.`;
}

const POLYTOPE_ENTRIES: readonly ShapeEntry[] = POLYTOPE_NAMES.map((name): ShapeEntry => {
  const entry: ShapeEntry = {
    id: SHAPE_IDS[name],
    label: POLYTOPE_INFO[name].label,
    group: 'Regular polytopes',
    description: describePolytope(name),
    create: () => polytopeShape(name),
  };
  // Textbook eye distance of MATH.md §3.2 (cells at scale 3/2 and 3/4); the
  // other polytopes take the state default max(3, 2.5 R).
  if (name === 'tesseract') entry.projectionDistance = 3;
  return entry;
});

// ---- Curved solids (MATH.md §8.5, §8.6, §3.3) ------------------------------

/**
 * Midpoint-subdivision level of the 4-ball (§8.5): 16 · 8⁴ = 65 536 tets,
 * built in ≈ 90 ms, sliced in ≈ 9 ms. The chordal mesh is inscribed in S³,
 * so its hypervolume is 1.4 % below π²/2 (level 3 would be 5.3 % at a sixth
 * of the slicing cost).
 */
const HYPERSPHERE_LEVEL = 4;
const HYPERSPHERE_TETS = 16 * 8 ** HYPERSPHERE_LEVEL;

/**
 * Duocylinder tessellation (§8.6): both circles as 48-gons, matching the
 * Clifford-torus wire. `rings` only subdivides the solid discs inside the two
 * boundary tori, so it changes the tet count (6·48²·(2·rings − 1)) and the
 * per-slice cost but not the boundary point set, hence not a single slice:
 * measured slice volumes agree to all printed digits for rings 1, 2, 3 and 6,
 * every variant validates with no degenerate tets, and rings = 1 (13 824
 * tets) slices in 3–9 ms against 17–30 ms for the module default of 6
 * (152 064 tets), which stuttered the slice animation.
 */
const DUOCYLINDER_SEGMENTS = 48;
const DUOCYLINDER_RINGS = 1;

/** Hopf fibration sampling: fibres and points per fibre (§3.3). */
const HOPF_FIBERS = 24;
const HOPF_POINTS_PER_FIBER = 64;

const CURVED_ENTRIES: readonly ShapeEntry[] = [
  {
    id: SHAPE_IDS.hypersphere,
    label: 'Hypersphere',
    group: 'Curved solids',
    // §8.5: vol_4 = π²R⁴/2 and the slice at offset c is a ball of radius √(R² − c²).
    description: `The 4-ball of radius 1, hypervolume π²/2 ≈ ${approx(Math.PI ** 2 / 2)}, whose slice at offset c is a ball of radius √(1 − c²), drawn as the 16-cell subdivided ${HYPERSPHERE_LEVEL} times into ${HYPERSPHERE_TETS} tets inscribed in the 3-sphere (an inscribed approximation about 1.4 % below the true hypervolume).`,
    create: () => hypersphere(1, HYPERSPHERE_LEVEL),
  },
  {
    id: SHAPE_IDS.duocylinder,
    label: 'Duocylinder',
    group: 'Curved solids',
    // §8.6 with r₁ = r₂ = 1: hypervolume π² r₁² r₂² = π², slice at w = c a
    // cylinder of radius r₁ and height 2√(r₂² − c²). Stereographic projection
    // normalises to the unit sphere first (§3.3), so the Clifford torus of any
    // r₁ = r₂ projects to a round torus.
    description: 'The product of two unit discs {x² + y² ≤ 1} × {z² + w² ≤ 1}, hypervolume π², bounded by two solid tori glued along the Clifford torus (a round torus under stereographic projection); the slice at w = c is a cylinder of radius 1 and height 2√(1 − c²).',
    create: () => duocylinder(1, 1, DUOCYLINDER_SEGMENTS, DUOCYLINDER_RINGS),
  },
  {
    id: SHAPE_IDS.hopf,
    label: 'Hopf fibration',
    group: 'Curved solids',
    // §3.3: the fibres lie on the unit S³; stereographic projection is
    // conformal and sends circles to circles or lines.
    description: `${HOPF_FIBERS} fibres of the Hopf map S³ → S², each a great circle of the unit 3-sphere and any two of them linked once, drawn as a wire only (there is no solid to slice); stereographic projection turns them into circles on nested tori.`,
    defaultProjection: 'stereographic',
    create: () => hopfShape(HOPF_FIBERS, HOPF_POINTS_PER_FIBER),
  },
];

// ---- Catalogue ---------------------------------------------------------------

/**
 * Every entry in picker order: the six regular polytopes, the curved solids,
 * then the lifted 3D objects and figures (§9.1), the spun solids (§9.2) and
 * the smooth SDF forms (§9.3). The entries of the last three families,
 * including groups and descriptions, are defined next to their geometry in
 * src/geometry/figures.ts and src/geometry/sdf-figures.ts.
 */
export const SHAPE_ENTRIES: readonly ShapeEntry[] = [
  ...POLYTOPE_ENTRIES,
  ...CURVED_ENTRIES,
  ...LIFTED_SHAPES,
  ...SPUN_SHAPES,
  ...SDF_SHAPES,
];

/** Register every catalogue entry. Idempotent, so repeated imports are harmless. */
export function registerAllShapes(): void {
  if (getShape(SHAPE_IDS.tesseract)) return;
  for (const entry of SHAPE_ENTRIES) registerShape(entry);
}

registerAllShapes();
