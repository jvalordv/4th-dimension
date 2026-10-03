/**
 * Reading triangle meshes into Mesh3 (MATH.md §12): Wavefront OBJ text and
 * three.js BufferGeometry (which is what the glTF loader produces). Both
 * return the raw model: coordinates are not re-centred or scaled here and no
 * orientation is repaired; that is normaliseMesh's job (./import).
 */
import type { BufferGeometry } from 'three';
import type { Vec3 } from '../math/types';
import type { Mesh3, Triangle } from '../geometry/mesh3';
import { weldMesh3 } from '../geometry/mesh3';

/** Weld tolerance relative to the model's bounding radius (MATH.md §12 welds by position). */
export const WELD_TOLERANCE = 1e-6;

/**
 * Centre of the axis-aligned bounding box of all vertices and the radius of
 * the smallest ball about that centre containing them (MATH.md §12: the
 * model is centred at this point and scaled by 1/radius). Both are zero for
 * a mesh without vertices.
 */
export function boundingSphere(mesh: Mesh3): { centre: Vec3; radius: number } {
  if (mesh.positions.length === 0) return { centre: [0, 0, 0], radius: 0 };
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of mesh.positions) {
    for (let k = 0; k < 3; k++) {
      if (p[k] < min[k]) min[k] = p[k];
      if (p[k] > max[k]) max[k] = p[k];
    }
  }
  const centre: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  let r2 = 0;
  for (const p of mesh.positions) {
    r2 = Math.max(r2, (p[0] - centre[0]) ** 2 + (p[1] - centre[1]) ** 2 + (p[2] - centre[2]) ** 2);
  }
  return { centre, radius: Math.sqrt(r2) };
}

/** Text of the line with a `#` comment removed. */
const stripComment = (line: string): string => {
  const hash = line.indexOf('#');
  return hash < 0 ? line : line.slice(0, hash);
};

/**
 * Parse Wavefront OBJ text into a triangle mesh with raw coordinates.
 *
 * - `v x y z [w | r g b]`: a vertex; anything after the third number
 *   (homogeneous weight, vertex colour) is ignored.
 * - `f a b c ...`: a polygon, fan-triangulated about its first corner, so a
 *   quad (a, b, c, d) becomes (a, b, c), (a, c, d) and the winding is kept.
 *   The fan is exact for the convex polygons modelling tools emit; a
 *   non-convex polygon needs a real triangulator and is not supported.
 *   Corners may be `i`, `i/t`, `i//n` or `i/t/n`; only `i` is used. A
 *   positive `i` is 1-based, a negative one counts back from the most
 *   recent vertex (−1 is the last one defined so far).
 * - everything else (comments, `vt`, `vn`, `g`, `o`, `s`, `usemtl`, `mtllib`,
 *   points, lines, blank lines) is ignored; a trailing backslash continues a
 *   line.
 *
 * Vertices no face uses are kept (normaliseMesh drops them).
 *
 * @throws Error naming the line for a malformed vertex, a face with fewer
 *   than three corners, a non-integer or zero index, or an index that refers
 *   to a vertex the file does not define.
 */
export function parseObj(text: string): Mesh3 {
  const positions: Vec3[] = [];
  const triangles: Triangle[] = [];
  /** Source line of each triangle, for the range check at the end. */
  const triangleLine: number[] = [];
  const lines = text.split(/\r\n|\r|\n/);

  for (let ln = 0; ln < lines.length; ln++) {
    const lineNo = ln + 1;
    let line = stripComment(lines[ln]).trimEnd();
    while (line.endsWith('\\') && ln + 1 < lines.length) {
      ln++;
      line = `${line.slice(0, -1)} ${stripComment(lines[ln]).trimEnd()}`.trimEnd();
    }
    const tok = line.trim().split(/\s+/);
    if (tok[0] === 'v') {
      const x = Number(tok[1]);
      const y = Number(tok[2]);
      const z = Number(tok[3]);
      if (tok.length < 4 || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        throw new Error(`OBJ line ${lineNo}: a vertex needs three finite numbers (got '${line.trim()}')`);
      }
      positions.push([x, y, z]);
    } else if (tok[0] === 'f') {
      if (tok.length < 4) throw new Error(`OBJ line ${lineNo}: a face needs at least three vertices (got '${line.trim()}')`);
      const corners: number[] = [];
      for (let k = 1; k < tok.length; k++) {
        const i = Number(tok[k].split('/')[0]);
        if (!Number.isInteger(i) || i === 0) {
          throw new Error(`OBJ line ${lineNo}: '${tok[k]}' is not a vertex index`);
        }
        const idx = i > 0 ? i - 1 : positions.length + i;
        if (idx < 0) {
          throw new Error(`OBJ line ${lineNo}: relative index ${i} reaches before the first vertex (${positions.length} defined so far)`);
        }
        corners.push(idx);
      }
      for (let k = 1; k + 1 < corners.length; k++) {
        triangles.push([corners[0], corners[k], corners[k + 1]]);
        triangleLine.push(lineNo);
      }
    }
  }

  // Positive indices may legitimately name vertices defined later in the
  // file, so the upper bound is checked against the final count.
  for (let t = 0; t < triangles.length; t++) {
    for (const idx of triangles[t]) {
      if (idx >= positions.length) {
        throw new Error(`OBJ line ${triangleLine[t]}: vertex index ${idx + 1} is out of range (the file defines ${positions.length} vertices)`);
      }
    }
  }
  return { positions, triangles };
}

/**
 * Read a three.js BufferGeometry as a triangle mesh: the `position`
 * attribute (interleaved and normalised-integer attributes are read through
 * getX/getY/getZ, so they come out as the floats the loader means), with
 * triples of the index as triangles when the geometry is indexed and
 * consecutive triples of vertices otherwise. Draw ranges and groups are
 * ignored. The result is welded by position with tolerance
 * WELD_TOLERANCE × the bounding radius (MATH.md §12): glTF and three.js
 * primitives duplicate vertices along every normal or UV seam, and welding
 * is what makes a closed model closed again. Triangles that collapse in the
 * weld are dropped.
 *
 * @throws Error if the geometry has no position attribute
 */
export function fromBufferGeometry(geometry: BufferGeometry): Mesh3 {
  const pos = geometry.getAttribute('position');
  if (!pos) throw new Error('fromBufferGeometry: the geometry has no position attribute');
  const positions: Vec3[] = new Array<Vec3>(pos.count);
  for (let i = 0; i < pos.count; i++) positions[i] = [pos.getX(i), pos.getY(i), pos.getZ(i)];

  const index = geometry.getIndex();
  const count = index ? index.count : pos.count;
  const triangles: Triangle[] = [];
  for (let k = 0; k + 2 < count; k += 3) {
    triangles.push(index
      ? [index.getX(k), index.getX(k + 1), index.getX(k + 2)]
      : [k, k + 1, k + 2]);
  }

  const raw: Mesh3 = { positions, triangles };
  const { radius } = boundingSphere(raw);
  // A radius of 0 (or NaN coordinates) leaves nothing to weld by.
  return radius > 0 && Number.isFinite(radius) ? weldMesh3(raw, WELD_TOLERANCE * radius) : raw;
}
