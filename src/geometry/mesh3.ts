/**
 * Closed triangle meshes in R^3: the 3D solids that the lifting pipeline of
 * MATH.md §9 turns into 4D objects. A Mesh3 bounds a solid S; its triangles
 * are counter-clockwise seen from outside, so the divergence-theorem volume
 * is positive and every edge is traversed once in each direction.
 *
 * Generators: all solids are centred at the origin and, where they have an
 * axis of symmetry, that axis is z (the axis MATH.md §9.2 singles out).
 */
import type { Edge, Vec3 } from '../math/types';
import { add3, cross3, dot3, length3, normalize3, scale3, sub3 } from '../math/vec';

/** Triangle as three vertex indices, counter-clockwise seen from outside. */
export type Triangle = [number, number, number];

/** Triangle mesh in R^3 with shared vertices. MATH.md §9 */
export interface Mesh3 {
  positions: Vec3[];
  triangles: Triangle[];
}

// ---- Measurement -----------------------------------------------------------

/**
 * Signed volume by the divergence theorem, V = Σ v0 · (v1 × v2) / 6 over
 * triangles. Positive for a closed mesh oriented counter-clockwise seen from
 * outside. MATH.md §6
 */
export function mesh3Volume(mesh: Mesh3): number {
  let v = 0;
  for (const [a, b, c] of mesh.triangles) {
    v += dot3(mesh.positions[a], cross3(mesh.positions[b], mesh.positions[c]));
  }
  return v / 6;
}

/** Total triangle area, Σ |(v1 − v0) × (v2 − v0)| / 2. */
export function mesh3Area(mesh: Mesh3): number {
  let s = 0;
  for (const [a, b, c] of mesh.triangles) {
    const p = mesh.positions[a];
    s += length3(cross3(sub3(mesh.positions[b], p), sub3(mesh.positions[c], p))) / 2;
  }
  return s;
}

export interface Mesh3Bounds {
  min: Vec3;
  max: Vec3;
  /** Radius of the smallest origin-centred ball containing every vertex. */
  radius: number;
}

/** Axis-aligned bounds and the radius about the origin (all zero when empty). */
export function mesh3Bounds(mesh: Mesh3): Mesh3Bounds {
  if (mesh.positions.length === 0) return { min: [0, 0, 0], max: [0, 0, 0], radius: 0 };
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  let radius = 0;
  for (const p of mesh.positions) {
    for (let k = 0; k < 3; k++) {
      if (p[k] < min[k]) min[k] = p[k];
      if (p[k] > max[k]) max[k] = p[k];
    }
    radius = Math.max(radius, length3(p));
  }
  return { min, max, radius };
}

// ---- Transformation --------------------------------------------------------

/**
 * Apply `fn` to every vertex; triangles are copied unchanged. If `fn`
 * reverses orientation (a reflection) the caller must flipMesh3 afterwards.
 */
export function transformMesh3(mesh: Mesh3, fn: (p: Vec3) => Vec3): Mesh3 {
  return {
    positions: mesh.positions.map(fn),
    triangles: mesh.triangles.map(([a, b, c]) => [a, b, c]),
  };
}

export const translateMesh3 = (mesh: Mesh3, d: Vec3): Mesh3 => transformMesh3(mesh, (p) => add3(p, d));

/**
 * Scale uniformly or per axis. A scale with an odd number of negative
 * factors is a reflection, so the winding is flipped to stay outward.
 */
export function scaleMesh3(mesh: Mesh3, s: number | Vec3): Mesh3 {
  const f: Vec3 = typeof s === 'number' ? [s, s, s] : s;
  const out = transformMesh3(mesh, (p) => [p[0] * f[0], p[1] * f[1], p[2] * f[2]]);
  return f[0] * f[1] * f[2] < 0 ? flipMesh3(out) : out;
}

/** Reverse every triangle's winding (inside becomes outside). */
export function flipMesh3(mesh: Mesh3): Mesh3 {
  return {
    positions: mesh.positions,
    triangles: mesh.triangles.map(([a, b, c]) => [a, c, b]),
  };
}

/** Undirected edges as sorted index pairs, each listed once. */
export function mesh3Edges(mesh: Mesh3): Edge[] {
  const seen = new Set<string>();
  const edges: Edge[] = [];
  const add = (i: number, j: number): void => {
    const lo = Math.min(i, j);
    const hi = Math.max(i, j);
    const key = `${lo},${hi}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push([lo, hi]);
  };
  for (const [a, b, c] of mesh.triangles) { add(a, b); add(b, c); add(c, a); }
  return edges;
}

/**
 * Merge vertices closer than `tol` (checked against the 27 neighbouring grid
 * cells, so points straddling a cell boundary still merge) and drop triangles
 * that collapse to a repeated index.
 */
export function weldMesh3(mesh: Mesh3, tol = 1e-9): Mesh3 {
  const buckets = new Map<string, number[]>();
  const remap = new Array<number>(mesh.positions.length);
  const positions: Vec3[] = [];
  const inv = 1 / tol;
  const tol2 = tol * tol;
  mesh.positions.forEach((p, i) => {
    const cx = Math.floor(p[0] * inv);
    const cy = Math.floor(p[1] * inv);
    const cz = Math.floor(p[2] * inv);
    let found = -1;
    search: for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const list = buckets.get(`${cx + dx},${cy + dy},${cz + dz}`);
          if (!list) continue;
          for (const j of list) {
            const d = sub3(positions[j], p);
            if (dot3(d, d) <= tol2) { found = j; break search; }
          }
        }
      }
    }
    if (found < 0) {
      found = positions.length;
      positions.push([p[0], p[1], p[2]]);
      const key = `${cx},${cy},${cz}`;
      const list = buckets.get(key);
      if (list) list.push(found); else buckets.set(key, [found]);
    }
    remap[i] = found;
  });
  const triangles: Triangle[] = [];
  for (const [a, b, c] of mesh.triangles) {
    const i = remap[a];
    const j = remap[b];
    const k = remap[c];
    if (i === j || j === k || k === i) continue;
    triangles.push([i, j, k]);
  }
  return { positions, triangles };
}

// ---- Validation ------------------------------------------------------------

export interface Mesh3Validation {
  /** No errors at all. */
  ok: boolean;
  /** Every edge belongs to exactly two triangles. */
  closed: boolean;
  /** Every shared edge is traversed in opposite directions by its two triangles. */
  consistent: boolean;
  /** V − E + F over vertices referenced by triangles: 2 for a sphere, 0 for a torus. */
  euler: number;
  vertexCount: number;
  edgeCount: number;
  triangleCount: number;
  boundaryEdges: number;
  inconsistentEdges: number;
  nonManifoldEdges: number;
  degenerateTriangles: number;
  errors: string[];
}

/**
 * Check that the mesh is a closed, consistently oriented surface: each
 * undirected edge in exactly two triangles traversed in opposite directions
 * (the 3D counterpart of MATH.md §5.2). Zero-area triangles (doubled area at
 * most `areaTol` × radius²) are reported, and are errors unless
 * `allowDegenerate` is set, as MATH.md §6 permits for slice output.
 */
export function validateMesh3(
  mesh: Mesh3,
  opts: { allowDegenerate?: boolean; areaTol?: number } = {},
): Mesh3Validation {
  const errors: string[] = [];
  const directed = new Map<string, number>();
  const used = new Set<number>();
  const { radius } = mesh3Bounds(mesh);
  const tol = (opts.areaTol ?? 1e-12) * Math.max(radius, 1) ** 2;
  let degenerateTriangles = 0;

  mesh.triangles.forEach((t, ti) => {
    let valid = true;
    for (const idx of t) {
      if (!Number.isInteger(idx) || idx < 0 || idx >= mesh.positions.length) {
        errors.push(`triangle ${ti} has out-of-range vertex ${idx}`);
        valid = false;
      }
    }
    if (!valid) return;
    const [a, b, c] = t;
    if (a === b || b === c || c === a) {
      errors.push(`triangle ${ti} repeats a vertex`);
      return;
    }
    const p = mesh.positions[a];
    if (length3(cross3(sub3(mesh.positions[b], p), sub3(mesh.positions[c], p))) <= tol) degenerateTriangles++;
    used.add(a); used.add(b); used.add(c);
    for (const [i, j] of [[a, b], [b, c], [c, a]]) {
      const key = `${i},${j}`;
      directed.set(key, (directed.get(key) ?? 0) + 1);
    }
  });

  const undirected = new Set<string>();
  let boundaryEdges = 0;
  let nonManifoldEdges = 0;
  let inconsistentEdges = 0;
  for (const [key, count] of directed) {
    const [a, b] = key.split(',').map(Number);
    const ukey = a < b ? key : `${b},${a}`;
    if (undirected.has(ukey)) continue;
    undirected.add(ukey);
    const rev = directed.get(`${b},${a}`) ?? 0;
    const total = count + rev;
    if (total === 1) boundaryEdges++;
    else if (total > 2) nonManifoldEdges++;
    else if (count !== 1 || rev !== 1) inconsistentEdges++;
  }
  if (boundaryEdges) errors.push(`${boundaryEdges} edges belong to only one triangle (surface not closed)`);
  if (nonManifoldEdges) errors.push(`${nonManifoldEdges} edges belong to more than two triangles`);
  if (inconsistentEdges) errors.push(`${inconsistentEdges} edges are traversed twice in the same direction`);
  if (degenerateTriangles && !opts.allowDegenerate) errors.push(`${degenerateTriangles} degenerate triangles`);

  const F = mesh.triangles.length;
  const E = undirected.size;
  const V = used.size;
  return {
    ok: errors.length === 0,
    closed: boundaryEdges === 0 && nonManifoldEdges === 0,
    consistent: inconsistentEdges === 0,
    euler: V - E + F,
    vertexCount: V,
    edgeCount: E,
    triangleCount: F,
    boundaryEdges,
    inconsistentEdges,
    nonManifoldEdges,
    degenerateTriangles,
    errors,
  };
}

// ---- Generators ------------------------------------------------------------

const requireAtLeast = (name: string, value: number, min: number): void => {
  if (!Number.isInteger(value) || value < min) throw new Error(`${name} must be an integer ≥ ${min}, got ${value}`);
};

/** Quad (a, b, c, d) counter-clockwise from outside → two triangles. */
const pushQuad = (tris: Triangle[], a: number, b: number, c: number, d: number): void => {
  tris.push([a, b, c], [a, c, d]);
};

/**
 * Axis-aligned box [-sx/2, sx/2] × [-sy/2, sy/2] × [-sz/2, sz/2]. Vertex i
 * has x = ±sx/2 by bit 0, y by bit 1, z by bit 2. Volume sx·sy·sz.
 */
export function box(sx: number, sy: number, sz: number): Mesh3 {
  const h: Vec3 = [sx / 2, sy / 2, sz / 2];
  const positions: Vec3[] = [];
  for (let i = 0; i < 8; i++) positions.push([i & 1 ? h[0] : -h[0], i & 2 ? h[1] : -h[1], i & 4 ? h[2] : -h[2]]);
  const triangles: Triangle[] = [];
  pushQuad(triangles, 0, 4, 6, 2); // −x
  pushQuad(triangles, 1, 3, 7, 5); // +x
  pushQuad(triangles, 0, 1, 5, 4); // −y
  pushQuad(triangles, 2, 6, 7, 3); // +y
  pushQuad(triangles, 0, 2, 3, 1); // −z
  pushQuad(triangles, 4, 5, 7, 6); // +z
  return { positions, triangles };
}

/**
 * Latitude–longitude sphere about the z axis: a single vertex at each pole,
 * `heightSegments − 1` rings of `widthSegments` vertices at polar angles
 * kπ/heightSegments, triangle fans at the poles and split quads between
 * rings, so no triangle is degenerate. Vertices: 2 + (H−1)W; triangles
 * 2W(H−1); Euler characteristic 2.
 *
 * It is a surface of revolution of the meridian polygon with W equal angular
 * steps, so its exact volume is W·sin(2π/W) · ∫∫ ρ dρ dz over that polygon
 * = (4/3)π r³ · [(W/2π) sin(2π/W)] · cos²(π/2H)  (see test/geometry/mesh3.test.ts).
 */
export function uvSphere(r: number, widthSegments: number, heightSegments: number): Mesh3 {
  requireAtLeast('uvSphere widthSegments', widthSegments, 3);
  requireAtLeast('uvSphere heightSegments', heightSegments, 2);
  const W = widthSegments;
  const H = heightSegments;
  const positions: Vec3[] = [[0, 0, r]];
  for (let k = 1; k < H; k++) {
    const theta = (Math.PI * k) / H;
    const rho = r * Math.sin(theta);
    const z = r * Math.cos(theta);
    for (let i = 0; i < W; i++) {
      const phi = (2 * Math.PI * i) / W;
      positions.push([rho * Math.cos(phi), rho * Math.sin(phi), z]);
    }
  }
  const south = positions.length;
  positions.push([0, 0, -r]);
  const ring = (k: number, i: number): number => 1 + (k - 1) * W + (i % W);
  const triangles: Triangle[] = [];
  for (let i = 0; i < W; i++) {
    triangles.push([0, ring(1, i), ring(1, i + 1)]);
    for (let k = 1; k + 1 < H; k++) {
      // Ring k is above ring k+1; going down then along the lower ring in
      // +φ then back up is counter-clockwise seen from outside.
      pushQuad(triangles, ring(k, i), ring(k + 1, i), ring(k + 1, i + 1), ring(k, i + 1));
    }
    triangles.push([south, ring(H - 1, i + 1), ring(H - 1, i)]);
  }
  return { positions, triangles };
}

/**
 * Icosahedron subdivided `level` times (each triangle into four by edge
 * midpoints projected onto the sphere). Faces 20·4^level, all vertices at
 * distance r; convex, so the solid lies between the ball of radius
 * min(face-plane distance) and the ball of radius r.
 */
export function icosphere(r: number, level: number): Mesh3 {
  requireAtLeast('icosphere level', level, 0);
  const t = (1 + Math.sqrt(5)) / 2;
  const raw: Vec3[] = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ];
  const positions: Vec3[] = raw.map((p) => scale3(normalize3(p), r));
  let triangles: Triangle[] = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  // The icosahedron is convex about the origin: a face is outward iff its
  // normal points away from the origin (as orientTetsOutward does in 4D).
  triangles = triangles.map(([a, b, c]) => {
    const n = cross3(sub3(positions[b], positions[a]), sub3(positions[c], positions[a]));
    return dot3(n, positions[a]) < 0 ? [a, c, b] : [a, b, c];
  });
  for (let l = 0; l < level; l++) {
    const mid = new Map<string, number>();
    const midpoint = (i: number, j: number): number => {
      const key = i < j ? `${i},${j}` : `${j},${i}`;
      const found = mid.get(key);
      if (found !== undefined) return found;
      const idx = positions.length;
      positions.push(scale3(normalize3(add3(positions[i], positions[j])), r));
      mid.set(key, idx);
      return idx;
    };
    const next: Triangle[] = [];
    for (const [a, b, c] of triangles) {
      const ab = midpoint(a, b);
      const bc = midpoint(b, c);
      const ca = midpoint(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    triangles = next;
  }
  return { positions, triangles };
}

/**
 * Cylinder of radius r about the z axis, z ∈ [−h/2, h/2], with a regular
 * `segments`-gon cross-section and fan caps about a centre vertex. Exact
 * volume: polygon area × h = π r² h · (n/2π) sin(2π/n).
 */
export function cylinder(r: number, h: number, segments: number): Mesh3 {
  requireAtLeast('cylinder segments', segments, 3);
  const n = segments;
  const positions: Vec3[] = [];
  for (const z of [-h / 2, h / 2]) {
    for (let i = 0; i < n; i++) {
      const phi = (2 * Math.PI * i) / n;
      positions.push([r * Math.cos(phi), r * Math.sin(phi), z]);
    }
  }
  const bottomCentre = positions.length;
  positions.push([0, 0, -h / 2]);
  const topCentre = positions.length;
  positions.push([0, 0, h / 2]);
  const bot = (i: number): number => i % n;
  const top = (i: number): number => n + (i % n);
  const triangles: Triangle[] = [];
  for (let i = 0; i < n; i++) {
    pushQuad(triangles, bot(i), bot(i + 1), top(i + 1), top(i));
    triangles.push([topCentre, top(i), top(i + 1)]);
    triangles.push([bottomCentre, bot(i + 1), bot(i)]);
  }
  return { positions, triangles };
}

/**
 * Capsule about the z axis: a cylinder of radius r and height h (the straight
 * part) capped by two hemispheres, each with `rings` latitude rings from the
 * pole to the equator, i.e. polar angle steps of π/(2·rings). The equator
 * rings sit at z = ±h/2. Vertices 2 + 2·rings·W; triangles 4·rings·W.
 *
 * Exact volume = cylinder(r, h, W) + uvSphere(r, W, 2·rings) volumes, since
 * ∫∫ ρ dρ dz is additive and the two caps together form the meridian polygon
 * of that sphere.
 */
export function capsule(r: number, h: number, segments: number, rings: number): Mesh3 {
  requireAtLeast('capsule segments', segments, 3);
  requireAtLeast('capsule rings', rings, 1);
  const W = segments;
  const Q = rings;
  const positions: Vec3[] = [[0, 0, h / 2 + r]];
  // North rings k = 1..Q (k = Q is the equator at z = h/2).
  for (let k = 1; k <= Q; k++) {
    const theta = (Math.PI * k) / (2 * Q);
    const rho = r * Math.sin(theta);
    const z = h / 2 + r * Math.cos(theta);
    for (let i = 0; i < W; i++) {
      const phi = (2 * Math.PI * i) / W;
      positions.push([rho * Math.cos(phi), rho * Math.sin(phi), z]);
    }
  }
  // South rings k = 1..Q mirror the north ones (k = Q is the equator at z = −h/2).
  for (let k = 1; k <= Q; k++) {
    const theta = (Math.PI * k) / (2 * Q);
    const rho = r * Math.sin(theta);
    const z = -h / 2 - r * Math.cos(theta);
    for (let i = 0; i < W; i++) {
      const phi = (2 * Math.PI * i) / W;
      positions.push([rho * Math.cos(phi), rho * Math.sin(phi), z]);
    }
  }
  const south = positions.length;
  positions.push([0, 0, -h / 2 - r]);
  const north = (k: number, i: number): number => 1 + (k - 1) * W + (i % W);
  const southRing = (k: number, i: number): number => 1 + Q * W + (k - 1) * W + (i % W);
  const triangles: Triangle[] = [];
  for (let i = 0; i < W; i++) {
    triangles.push([0, north(1, i), north(1, i + 1)]);
    for (let k = 1; k < Q; k++) {
      pushQuad(triangles, north(k, i), north(k + 1, i), north(k + 1, i + 1), north(k, i + 1));
    }
    // Straight part: north equator above the south equator.
    pushQuad(triangles, north(Q, i), southRing(Q, i), southRing(Q, i + 1), north(Q, i + 1));
    for (let k = Q; k > 1; k--) {
      pushQuad(triangles, southRing(k, i), southRing(k - 1, i), southRing(k - 1, i + 1), southRing(k, i + 1));
    }
    triangles.push([south, southRing(1, i + 1), southRing(1, i)]);
  }
  return { positions, triangles };
}

/**
 * Torus about the z axis with major radius R and minor radius r,
 * P(u, v) = ((R + r cos v) cos u, (R + r cos v) sin u, r sin v), sampled at
 * `tubularSegments` values of u and `radialSegments` of v. Vertex (i, j) is
 * index i·radialSegments + j. ∂P/∂u × ∂P/∂v = r(R + r cos v)(cos u cos v,
 * sin u cos v, sin v) points outward, so quads are emitted in (u, v) order.
 * Vertices mn, triangles 2mn, Euler characteristic 0.
 *
 * Exact volume: by the same surface-of-revolution argument as uvSphere, with
 * the cross-section a regular n-gon of circumradius r centred at distance R,
 * V = 2π² R r² · [(m/2π) sin(2π/m)] · [(n/2π) sin(2π/n)].
 */
export function torus(R: number, r: number, tubularSegments: number, radialSegments: number): Mesh3 {
  requireAtLeast('torus tubularSegments', tubularSegments, 3);
  requireAtLeast('torus radialSegments', radialSegments, 3);
  const m = tubularSegments;
  const n = radialSegments;
  const positions: Vec3[] = [];
  for (let i = 0; i < m; i++) {
    const u = (2 * Math.PI * i) / m;
    for (let j = 0; j < n; j++) {
      const v = (2 * Math.PI * j) / n;
      const rho = R + r * Math.cos(v);
      positions.push([rho * Math.cos(u), rho * Math.sin(u), r * Math.sin(v)]);
    }
  }
  const at = (i: number, j: number): number => (i % m) * n + (j % n);
  const triangles: Triangle[] = [];
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      pushQuad(triangles, at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1));
    }
  }
  return { positions, triangles };
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/**
 * Point and tangent of the (p, q) torus knot on the carrier torus of major
 * radius R and minor radius R/2 (the three.js convention), t ∈ [0, 2π):
 * c(t) = ((R + ρ cos qt) cos pt, (R + ρ cos qt) sin pt, ρ sin qt), ρ = R/2.
 * The curve winds p times around the z axis and q times through the hole.
 */
export function torusKnotCurve(R: number, p: number, q: number, t: number): { point: Vec3; tangent: Vec3 } {
  const rho = R / 2;
  const a = p * t;
  const b = q * t;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const cb = Math.cos(b);
  const sb = Math.sin(b);
  const w = R + rho * cb;
  const point: Vec3 = [w * ca, w * sa, rho * sb];
  const dw = -rho * q * sb;
  const tangent: Vec3 = [dw * ca - w * p * sa, dw * sa + w * p * ca, rho * q * cb];
  return { point, tangent };
}

/** Rotate `v` about the unit axis `k` by the angle with the given cosine and sine (Rodrigues). */
const rotateAbout = (v: Vec3, k: Vec3, cos: number, sin: number): Vec3 =>
  add3(add3(scale3(v, cos), scale3(cross3(k, v), sin)), scale3(k, dot3(k, v) * (1 - cos)));

/**
 * Closed tube of radius r around the (p, q) torus knot (see torusKnotCurve),
 * with `tubularSegments` rings of `radialSegments` vertices. Vertex (i, j) is
 * index i·radialSegments + j.
 *
 * Frames are rotation-minimising (parallel transport of a normal along the
 * sampled tangents, Frenet-free so inflection-free knots and straight runs
 * pose no problem). Transporting once around the closed curve returns the
 * normal rotated by a holonomy angle φ about the tangent. The ring at the
 * seam must coincide with ring 0 vertex for vertex, so the closing shift
 * k = round(φ·M/2π) ring positions is absorbed by re-indexing the last
 * quads, and the residual φ − 2πk/M is spread evenly as an extra twist
 * −(residual)·i/N on ring i. The mesh is then closed and consistent with
 * V = N·M, F = 2·N·M and Euler characteristic 0.
 *
 * Orientation: with B = T × N, the tube point is c + r(cos α N + sin α B)
 * and ∂/∂α × ∂/∂t points outward, so quads are emitted in (α, t) order.
 */
export function torusKnot(
  R: number, r: number, p: number, q: number, tubularSegments: number, radialSegments: number,
): Mesh3 {
  requireAtLeast('torusKnot p', p, 1);
  requireAtLeast('torusKnot q', q, 1);
  requireAtLeast('torusKnot tubularSegments', tubularSegments, 3);
  requireAtLeast('torusKnot radialSegments', radialSegments, 3);
  if (gcd(p, q) !== 1) throw new Error(`torusKnot: p = ${p} and q = ${q} must be coprime (otherwise the curve retraces itself)`);
  const N = tubularSegments;
  const M = radialSegments;

  const centres: Vec3[] = [];
  const tangents: Vec3[] = [];
  for (let i = 0; i < N; i++) {
    const { point, tangent } = torusKnotCurve(R, p, q, (2 * Math.PI * i) / N);
    centres.push(point);
    tangents.push(normalize3(tangent));
  }

  const transport = (normal: Vec3, t0: Vec3, t1: Vec3): Vec3 => {
    const axis = cross3(t0, t1);
    const sin = length3(axis);
    let out = normal;
    if (sin > 1e-14) out = rotateAbout(normal, scale3(axis, 1 / sin), dot3(t0, t1), sin);
    return normalize3(sub3(out, scale3(t1, dot3(out, t1))));
  };

  // Seed normal: reject the coordinate axis least aligned with T_0.
  const t0 = tangents[0];
  const seedAxis = [0, 1, 2].reduce((best, k) => (Math.abs(t0[k]) < Math.abs(t0[best]) ? k : best), 0);
  const seed: Vec3 = [0, 0, 0];
  seed[seedAxis] = 1;
  const normals: Vec3[] = [normalize3(sub3(seed, scale3(t0, dot3(seed, t0))))];
  for (let i = 1; i < N; i++) normals.push(transport(normals[i - 1], tangents[i - 1], tangents[i]));
  const closing = transport(normals[N - 1], tangents[N - 1], t0);
  const b0 = cross3(t0, normals[0]);
  const phi = Math.atan2(dot3(closing, b0), dot3(closing, normals[0]));
  const shift = Math.round((phi * M) / (2 * Math.PI));
  const residual = phi - (2 * Math.PI * shift) / M;

  const positions: Vec3[] = [];
  for (let i = 0; i < N; i++) {
    const n = normals[i];
    const b = cross3(tangents[i], n);
    const twist = (-residual * i) / N;
    for (let j = 0; j < M; j++) {
      const alpha = (2 * Math.PI * j) / M + twist;
      positions.push(add3(centres[i], add3(scale3(n, r * Math.cos(alpha)), scale3(b, r * Math.sin(alpha)))));
    }
  }
  const at = (i: number, j: number): number => {
    if (i < N) return i * M + (j % M);
    // Ring N is ring 0 rotated by the closing shift.
    return (((j + shift) % M) + M) % M;
  };
  const triangles: Triangle[] = [];
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < M; j++) {
      pushQuad(triangles, at(i, j), at(i, j + 1), at(i + 1, j + 1), at(i + 1, j));
    }
  }
  return { positions, triangles };
}
