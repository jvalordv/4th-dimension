/**
 * Per-frame projection of a Flatland solid (MATH.md §11). The solid is
 * rotated by M (§2.2 restricted), every vertex is projected to the plane
 * (orthographic or perspective from an eye at (0, 0, d)), and the pieces the
 * painter needs are derived:
 *
 * - faces ordered back to front by mean rotated z (the eye is on the +z
 *   side, so smaller z is farther), for painter's-algorithm translucency;
 * - the edges to draw: every crease, plus the silhouette, the edges whose
 *   two faces are one front-facing and one back-facing as seen from the eye
 *   (an edge-on face counting as either). That is the outline of the solid's
 *   shadow.
 */
import type { Vec3 } from '../math/types';
import { cross3, dot3, sub3 } from '../math/vec';
import { apply3, project2, type Mat3, type Projection2 } from './math';
import type { FlatModel } from './model';

/** |n · (eye − p)| below this counts as edge-on: neither front- nor back-facing. */
const EDGE_ON = 1e-9;

export interface ProjectedFrame {
  /** Projected position per vertex, in model units with y up. */
  readonly x: Float64Array;
  readonly y: Float64Array;
  /** Rotated z per vertex (the colour variable, before projection). */
  readonly z: Float64Array;
  /** Face indices, far to near (ascending mean z). */
  readonly faceOrder: Uint32Array;
  /** Mean rotated z of each face. */
  readonly faceZ: Float64Array;
  /** Indices into model.edges of the edges to draw. */
  readonly edges: Uint32Array;
}

/**
 * Whether each face looks toward the eye: +1 front, −1 back, 0 edge-on.
 * With n the (unnormalised) outward normal of the rotated face through p, the
 * eye e sees the front when n · (e − p) > 0, with e = (0, 0, d) under
 * perspective and the direction toward the viewer (0, 0, 1) under
 * orthographic projection, where the test reduces to n_z > 0.
 */
export function faceFacing(rotated: readonly Vec3[], model: FlatModel, proj: Projection2): Int8Array {
  const out = new Int8Array(model.faces.length);
  const eye: Vec3 = [0, 0, proj.kind === 'perspective' ? proj.distance : 0];
  model.faces.forEach(([a, b, c], f) => {
    const pa = rotated[a];
    const n = cross3(sub3(rotated[b], pa), sub3(rotated[c], pa));
    const side = proj.kind === 'perspective' ? dot3(n, sub3(eye, pa)) : n[2];
    out[f] = side > EDGE_ON ? 1 : side < -EDGE_ON ? -1 : 0;
  });
  return out;
}

export function projectModel(model: FlatModel, m: Mat3, proj: Projection2): ProjectedFrame {
  const nv = model.vertices.length;
  const x = new Float64Array(nv);
  const y = new Float64Array(nv);
  const z = new Float64Array(nv);
  const rotated: Vec3[] = new Array<Vec3>(nv);
  for (let i = 0; i < nv; i++) {
    const p = apply3(m, model.vertices[i]);
    rotated[i] = p;
    const q = project2(p, proj);
    x[i] = q[0];
    y[i] = q[1];
    z[i] = p[2];
  }

  const nf = model.faces.length;
  const faceZ = new Float64Array(nf);
  for (let f = 0; f < nf; f++) {
    const [a, b, c] = model.faces[f];
    faceZ[f] = (z[a] + z[b] + z[c]) / 3;
  }
  const faceOrder = Uint32Array.from({ length: nf }, (_, i) => i).sort((p, q) => faceZ[p] - faceZ[q] || p - q);

  const facing = faceFacing(rotated, model, proj);
  const drawn: number[] = [];
  model.edges.forEach((e, i) => {
    if (e.crease) drawn.push(i);
    else {
      // A silhouette edge has a front face on one side and a back face on the other. An edge-on face
      // (facing 0: it projects to a segment, as the equatorial facets of a ball do in a symmetric
      // view) counts as either, so the border of a strip of edge-on faces is part of the outline and
      // the outline has no gaps; an edge between two edge-on faces is interior to the strip.
      const f = facing[e.f1];
      const g = facing[e.f2];
      if (f * g < 0 || (f === 0) !== (g === 0)) drawn.push(i);
    }
  });
  return { x, y, z, faceOrder, faceZ, edges: Uint32Array.from(drawn) };
}

/**
 * Largest distance from the axis at which the projected image of any point
 * of the ball of radius r can lie: max over z ∈ [−r, r] of
 * √(r² − z²) · d / (d − z) under perspective (§11, the 2D counterpart of
 * projectedExtent in src/render/viewer), r orthographic.
 */
export function projectedExtent2(r: number, proj: Projection2): number {
  if (proj.kind === 'orthographic') return r;
  let best = r;
  for (let i = 0; i <= 64; i++) {
    const z = -r + (2 * r * i) / 64;
    const denom = Math.max(proj.distance - z, 1e-3);
    best = Math.max(best, (Math.sqrt(Math.max(r * r - z * z, 0)) * proj.distance) / denom);
  }
  return best;
}
