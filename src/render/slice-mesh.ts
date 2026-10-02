/**
 * Slice-view drawing of a TriMesh3: a solid, lit, flat-shaded mesh coloured
 * by source w (MATH.md §10) with feature edges (dihedral angle above
 * FEATURE_EDGE_DEGREES, see ./feature-edges) drawn as thin lines, plus the
 * scale the overlay view applies so the slice sits inside the perspective
 * wire (MATH.md §3.2).
 */
import {
  BufferAttribute,
  BufferGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
} from 'three';
import type { TriMesh3 } from '../math/types';
import type { Projection } from '../math/projection';
import type { WColorScale } from '../app/colors';
import { FEATURE_EDGE_DEGREES, featureEdges } from './feature-edges';

export { FEATURE_EDGE_DEGREES } from './feature-edges';

/**
 * Non-indexed BufferGeometry for a slice: vertices are expanded per triangle
 * so computeVertexNormals yields one normal per face (flat shading), and the
 * colour attribute is sourceW through `scale`. The mesh's orientation (§6,
 * counter-clockwise from outside) is kept as is, so computed normals point
 * outward.
 */
export function buildSliceGeometry(mesh: TriMesh3, scale: WColorScale): BufferGeometry {
  const n = mesh.indices.length;
  const positions = new Float32Array(3 * n);
  const colors = new Float32Array(3 * n);
  for (let k = 0; k < n; k++) {
    const v = mesh.indices[k];
    positions[3 * k] = mesh.positions[3 * v];
    positions[3 * k + 1] = mesh.positions[3 * v + 1];
    positions[3 * k + 2] = mesh.positions[3 * v + 2];
    const c = scale.color(mesh.sourceW[v]);
    colors[3 * k] = c.r;
    colors[3 * k + 1] = c.g;
    colors[3 * k + 2] = c.b;
  }
  const geom = new BufferGeometry();
  geom.setAttribute('position', new BufferAttribute(positions, 3));
  geom.setAttribute('color', new BufferAttribute(colors, 3));
  geom.computeVertexNormals();
  return geom;
}

/**
 * Uniform scale of the slice in the overlay view. The slice is the part of
 * the object in the hyperplane w = c; under perspective from the eye at
 * w = d that hyperplane is drawn at scale d / (d − c) (§3.2, same clamp of
 * the denominator as projectPerspective), under orthographic projection at
 * scale 1 (§3.1). Under stereographic projection the points of the unit
 * 3-sphere with w = c map to (x, y, z) / (1 − c) (§3.3), so the factor is
 * 1 / (1 − c); this is exact for shapes lying on S^3 and a convention for
 * others.
 */
export function sliceScale(projection: Projection, offset: number, minDenom = 1e-3): number {
  switch (projection.kind) {
    case 'orthographic':
      return 1;
    case 'perspective':
      return projection.distance / Math.max(projection.distance - offset, minDenom);
    case 'stereographic':
      return 1 / Math.max(1 - offset, minDenom);
  }
}

export class SliceRenderable {
  readonly group = new Group();
  readonly mesh: Mesh<BufferGeometry, MeshStandardMaterial>;
  readonly edges: LineSegments<BufferGeometry, LineBasicMaterial>;
  private triangles = 0;

  constructor() {
    this.mesh = new Mesh(
      new BufferGeometry(),
      new MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.5,
        metalness: 0.05,
        // Push the surface back a hair so the feature lines win the depth test.
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      }),
    );
    this.edges = new LineSegments(
      new BufferGeometry(),
      new LineBasicMaterial({ color: 0xf2f5ff, transparent: true, opacity: 0.45 }),
    );
    this.mesh.frustumCulled = false;
    this.edges.frustumCulled = false;
    this.mesh.visible = false;
    this.edges.visible = false;
    this.group.add(this.mesh, this.edges);
  }

  get triangleCount(): number { return this.triangles; }

  /** Replace the drawn slice; the previous geometries are disposed. */
  setMesh(tri: TriMesh3, scale: WColorScale): void {
    this.mesh.geometry.dispose();
    this.edges.geometry.dispose();
    this.triangles = tri.indices.length / 3;
    if (this.triangles === 0) {
      this.mesh.geometry = new BufferGeometry();
      this.edges.geometry = new BufferGeometry();
      this.mesh.visible = false;
      this.edges.visible = false;
      return;
    }
    const geom = buildSliceGeometry(tri, scale);
    this.mesh.geometry = geom;
    const lines = featureEdges(geom.getAttribute('position').array, FEATURE_EDGE_DEGREES);
    const edgeGeom = new BufferGeometry();
    edgeGeom.setAttribute('position', new BufferAttribute(lines, 3));
    this.edges.geometry = edgeGeom;
    this.mesh.visible = true;
    this.edges.visible = lines.length > 0;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.edges.geometry.dispose();
    this.edges.material.dispose();
    this.group.clear();
  }
}
