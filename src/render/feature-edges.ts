/**
 * Feature edges of a non-indexed triangle soup, drawn as thin lines over the
 * slice mesh. An edge is a feature when its two adjacent triangles meet at a
 * dihedral angle above the threshold, or when it belongs to only one triangle
 * (a boundary). This is the rule of Three's EdgesGeometry; the implementation
 * differs in using numeric hashing instead of string keys, which makes a
 * 13 000-triangle slice take a few milliseconds rather than tens, and in
 * ignoring zero-area triangles, which marching tetrahedra emit whenever a
 * vertex lies exactly on the hyperplane (MATH.md §6) and which carry no
 * orientation.
 */

/** Dihedral angle (degrees) above which an edge of the slice mesh is drawn. */
export const FEATURE_EDGE_DEGREES = 20;

/** Vertices closer than this (per coordinate) are merged, as in EdgesGeometry. */
export const WELD_PRECISION = 1e-4;

/**
 * @param positions xyz per corner, 9 floats per triangle.
 * @returns xyz pairs, 6 floats per feature edge.
 */
export function featureEdges(
  positions: ArrayLike<number>,
  thresholdDeg = FEATURE_EDGE_DEGREES,
  precision = WELD_PRECISION,
): Float32Array {
  const triCount = Math.floor(positions.length / 9);
  const thresholdDot = Math.cos((thresholdDeg * Math.PI) / 180);
  const inv = 1 / precision;

  // --- weld corners by quantised position (numeric hash, verified) ---------
  const qx: number[] = [];
  const qy: number[] = [];
  const qz: number[] = [];
  const px: number[] = [];
  const py: number[] = [];
  const pz: number[] = [];
  const buckets = new Map<number, number[]>();
  const corner = new Int32Array(triCount * 3);
  let extent = 0;
  for (let k = 0; k < triCount * 3; k++) {
    const x = positions[3 * k];
    const y = positions[3 * k + 1];
    const z = positions[3 * k + 2];
    extent = Math.max(extent, Math.abs(x), Math.abs(y), Math.abs(z));
    const ax = Math.round(x * inv);
    const ay = Math.round(y * inv);
    const az = Math.round(z * inv);
    const h = Math.imul(ax | 0, 73856093) ^ Math.imul(ay | 0, 19349663) ^ Math.imul(az | 0, 83492791);
    let list = buckets.get(h);
    let id = -1;
    if (list) {
      for (const j of list) if (qx[j] === ax && qy[j] === ay && qz[j] === az) { id = j; break; }
    } else {
      list = [];
      buckets.set(h, list);
    }
    if (id < 0) {
      id = qx.length;
      qx.push(ax); qy.push(ay); qz.push(az);
      px.push(x); py.push(y); pz.push(z);
      list.push(id);
    }
    corner[k] = id;
  }
  const vertexCount = qx.length;

  // --- face normals, skipping degenerate triangles ---------------------------
  const normals = new Float64Array(triCount * 3);
  const valid = new Uint8Array(triCount);
  const areaTol = 1e-10 * extent * extent;
  for (let t = 0; t < triCount; t++) {
    const o = 9 * t;
    const ax = positions[o], ay = positions[o + 1], az = positions[o + 2];
    const ux = positions[o + 3] - ax, uy = positions[o + 4] - ay, uz = positions[o + 5] - az;
    const vx = positions[o + 6] - ax, vy = positions[o + 7] - ay, vz = positions[o + 8] - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    const a = corner[3 * t], b = corner[3 * t + 1], c = corner[3 * t + 2];
    if (len <= areaTol || a === b || b === c || a === c) continue;
    valid[t] = 1;
    normals[3 * t] = nx / len;
    normals[3 * t + 1] = ny / len;
    normals[3 * t + 2] = nz / len;
  }

  // --- pair edges ---------------------------------------------------------
  const out: number[] = [];
  const emit = (i: number, j: number): void => {
    out.push(px[i], py[i], pz[i], px[j], py[j], pz[j]);
  };
  // key -> index of the first triangle seen, or -1 once matched.
  const first = new Map<number, number>();
  for (let t = 0; t < triCount; t++) {
    if (!valid[t]) continue;
    for (let e = 0; e < 3; e++) {
      const i = corner[3 * t + e];
      const j = corner[3 * t + ((e + 1) % 3)];
      const lo = i < j ? i : j;
      const hi = i < j ? j : i;
      const key = lo * vertexCount + hi;
      const prev = first.get(key);
      if (prev === undefined) {
        first.set(key, t);
      } else if (prev >= 0) {
        const dot =
          normals[3 * prev] * normals[3 * t] +
          normals[3 * prev + 1] * normals[3 * t + 1] +
          normals[3 * prev + 2] * normals[3 * t + 2];
        if (dot <= thresholdDot) emit(lo, hi);
        first.set(key, -1);
      } else {
        // Third triangle on one edge (non-manifold): draw it, as EdgesGeometry does.
        emit(lo, hi);
      }
    }
  }
  for (const [key, t] of first) {
    if (t < 0) continue;
    const lo = Math.floor(key / vertexCount);
    emit(lo, key - lo * vertexCount);
  }
  return Float32Array.from(out);
}
