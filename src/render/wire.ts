/**
 * Projection-view drawing of a WireMesh4: edges as LineSegments, faces as a
 * translucent double-sided mesh (fan-triangulated), vertices as Points. One
 * position attribute and one colour attribute are shared by the three
 * geometries, so a frame costs a single pass over the vertices. MATH.md §3,
 * §5.3, §10.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
} from 'three';
import type { Edge, Mat4, WireMesh4 } from '../math/types';
import type { Projection } from '../math/projection';
import { project } from '../math/projection';
import { apply4 } from '../math/mat4';
import type { WColorScale } from '../app/colors';

/**
 * Fan-triangulate each face cycle (v_0, …, v_{n−1}) into (v_0, v_k, v_{k+1}),
 * k = 1 … n−2. A face with n vertices yields n − 2 triangles, so the result
 * has 3 Σ (n_k − 2) entries. Faces with fewer than three vertices are skipped.
 * Exact for convex polygons, which every face of the catalogue shapes is.
 */
export function fanTriangulate(faces: readonly number[][]): Uint32Array {
  let count = 0;
  for (const f of faces) if (f.length >= 3) count += f.length - 2;
  const out = new Uint32Array(count * 3);
  let o = 0;
  for (const f of faces) {
    for (let k = 1; k + 1 < f.length; k++) {
      out[o++] = f[0];
      out[o++] = f[k];
      out[o++] = f[k + 1];
    }
  }
  return out;
}

/** Element counts of the tesseract wire (24 squares → 48 triangles, 32 edges), the reference density. */
const REF_TRIANGLES = 48;
const REF_EDGES = 96;

/** 1 at or below the reference count, then √(ref / count), never below `floor`. */
export function densityFactor(count: number, ref: number, floor: number): number {
  if (count <= ref) return 1;
  return Math.max(floor, Math.sqrt(ref / count));
}

/** Flatten edge pairs into a LineSegments index (2 entries per edge). */
export function edgeIndices(edges: readonly Edge[]): Uint32Array {
  const out = new Uint32Array(edges.length * 2);
  for (let i = 0; i < edges.length; i++) {
    out[2 * i] = edges[i][0];
    out[2 * i + 1] = edges[i][1];
  }
  return out;
}

/** Index attribute, 16-bit when every index fits (no uint32 index extension needed). */
function indexAttribute(indices: Uint32Array, vertexCount: number): BufferAttribute {
  return new BufferAttribute(vertexCount <= 0xffff ? Uint16Array.from(indices) : indices, 1);
}

/**
 * Fill `positions` (xyz per vertex) and `colors` (rgb per vertex) for the
 * wire under rotation m and the given projection: p' = M p, colour from
 * p'_w (w after rotation, before projection, §10), position project(p').
 */
export function writeProjectedWire(
  wire: WireMesh4,
  m: Mat4,
  projection: Projection,
  scale: WColorScale,
  positions: Float32Array,
  colors: Float32Array,
): void {
  const pts = wire.positions;
  for (let i = 0; i < pts.length; i++) {
    const p = apply4(m, pts[i]);
    const c = scale.color(p[3]);
    const q = project(p, projection);
    const o = 3 * i;
    positions[o] = q[0];
    positions[o + 1] = q[1];
    positions[o + 2] = q[2];
    colors[o] = c.r;
    colors[o + 1] = c.g;
    colors[o + 2] = c.b;
  }
}

export interface WireOpacity {
  readonly edges: number;
  readonly faces: number;
  readonly vertices: number;
}

/** Projection view: a glowing wire. */
export const WIRE_OPACITY_FULL: WireOpacity = { edges: 0.95, faces: 0.15, vertices: 0.9 };
/** Overlay view: a faint ghost around the solid slice. */
export const WIRE_OPACITY_GHOST: WireOpacity = { edges: 0.32, faces: 0.05, vertices: 0.35 };

export class WireRenderable {
  readonly group = new Group();
  readonly edges: LineSegments<BufferGeometry, LineBasicMaterial>;
  readonly faces: Mesh<BufferGeometry, MeshBasicMaterial>;
  readonly points: Points<BufferGeometry, PointsMaterial>;
  readonly vertexCount: number;
  readonly edgeCount: number;
  readonly triangleCount: number;
  private readonly position: BufferAttribute;
  private readonly color: BufferAttribute;

  constructor(readonly wire: WireMesh4) {
    const n = wire.positions.length;
    this.vertexCount = n;
    this.edgeCount = wire.edges.length;
    this.position = new BufferAttribute(new Float32Array(3 * n), 3);
    this.color = new BufferAttribute(new Float32Array(3 * n), 3);

    const edgeGeom = new BufferGeometry();
    edgeGeom.setAttribute('position', this.position);
    edgeGeom.setAttribute('color', this.color);
    edgeGeom.setIndex(indexAttribute(edgeIndices(wire.edges), n));
    this.edges = new LineSegments(
      edgeGeom,
      new LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: WIRE_OPACITY_FULL.edges,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.edges.renderOrder = 1;

    const tri = fanTriangulate(wire.faces);
    this.triangleCount = tri.length / 3;
    const faceGeom = new BufferGeometry();
    faceGeom.setAttribute('position', this.position);
    faceGeom.setAttribute('color', this.color);
    faceGeom.setIndex(indexAttribute(tri, n));
    this.faces = new Mesh(
      faceGeom,
      new MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: WIRE_OPACITY_FULL.faces,
        side: DoubleSide,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.faces.renderOrder = 0;

    const pointGeom = new BufferGeometry();
    pointGeom.setAttribute('position', this.position);
    pointGeom.setAttribute('color', this.color);
    this.points = new Points(
      pointGeom,
      new PointsMaterial({
        vertexColors: true,
        size: 5,
        sizeAttenuation: false,
        transparent: true,
        opacity: WIRE_OPACITY_FULL.vertices,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.points.renderOrder = 2;

    // Positions change every frame; skip stale-bounds culling.
    for (const obj of [this.edges, this.faces, this.points]) obj.frustumCulled = false;
    this.group.add(this.faces, this.edges, this.points);
  }

  /** Recompute positions and colours for rotation m. */
  update(m: Mat4, projection: Projection, scale: WColorScale): void {
    writeProjectedWire(
      this.wire, m, projection, scale,
      this.position.array as Float32Array,
      this.color.array as Float32Array,
    );
    this.position.needsUpdate = true;
    this.color.needsUpdate = true;
  }

  /**
   * Additive blending sums overlapping elements, so a dense wire (the 120-cell's
   * 2160 face triangles, an extruded mesh's thousands of quads) saturates to
   * white at the opacity that suits the tesseract. Scale the requested opacity
   * by √(reference / count), floored, so the total light stays comparable.
   */
  setOpacity(o: WireOpacity): void {
    const f = densityFactor(this.triangleCount, REF_TRIANGLES, 0.04);
    const e = densityFactor(this.edgeCount, REF_EDGES, 0.15);
    this.edges.material.opacity = o.edges * e;
    this.faces.material.opacity = o.faces * f;
    this.points.material.opacity = o.vertices * e;
  }

  setVisible(faces: boolean, edges: boolean, vertices: boolean): void {
    this.faces.visible = faces && this.triangleCount > 0;
    this.edges.visible = edges && this.edgeCount > 0;
    this.points.visible = vertices;
  }

  dispose(): void {
    for (const obj of [this.edges, this.faces, this.points]) {
      obj.geometry.dispose();
      obj.material.dispose();
    }
    this.group.clear();
  }
}
