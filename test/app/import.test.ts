import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoxGeometry, EventDispatcher, GridHelper, Group, InstancedMesh, Line, Matrix4, Mesh, MeshBasicMaterial, Scene } from 'three';
import type { WebGLRenderer } from 'three';
import {
  closednessText, describeReport, HEAVY_TRIANGLES, ImportSession, isSolid, loadModelFile, normaliseMesh, registerImportedShape,
  sceneToMesh3, slugify,
} from '../../src/app/import';
import type { ImportReport } from '../../src/app/import';
import { parseObj } from '../../src/app/obj';
import { getShape, IMPORT_ID_PREFIX, listShapes, unregisterShape } from '../../src/app/registry';
import { ExtrudedSolid, extrude } from '../../src/geometry/extrude';
import { box, flipMesh3, mesh3Area, mesh3Bounds, mesh3Volume, scaleMesh3, translateMesh3 } from '../../src/geometry/mesh3';
import type { Mesh3 } from '../../src/geometry/mesh3';
import { SpunSolid } from '../../src/geometry/spin';
import { analyseSlice, signedVolume, surfaceArea, triangleCount } from '../../src/geometry/trimesh';
import { hyperplane, hyperplaneW } from '../../src/math/hyperplane';
import { cross3, dot3, sub3 } from '../../src/math/vec';
import { setupXR, XR_TARGET_RADIUS, XR_WORLD_POSITION } from '../../src/render/xr';

// The XR button is a DOM element made by three's VRButton; there is no DOM here.
const fakeButton = vi.hoisted(() => ({
  hidden: false,
  style: {} as Record<string, string>,
  remove: () => undefined,
}));
vi.mock('three/examples/jsm/webxr/VRButton.js', () => ({
  VRButton: { createButton: () => fakeButton },
}));

afterEach(() => {
  for (const e of listShapes()) if (e.id.startsWith(IMPORT_ID_PREFIX)) unregisterShape(e.id);
  vi.unstubAllGlobals();
});

/**
 * Volume of the cube [−1, 1]³ and its bounding radius: 2³ and √3. Volumes of
 * meshes here are Float64 sums of 12 terms of size ≤ 1, so rounding is about
 * 1e-15; `toBeCloseTo(x, 12)` and `(x, 13)` (5e-13 and 5e-14) leave a safe
 * margin. Slice volumes and areas come from Float32 output (relative 6e-8
 * per coordinate) and are compared at 1e-5 or 1e-6 relative.
 */
const CUBE_VOLUME = 8;
const CUBE_RADIUS = Math.sqrt(3);
/** After MATH.md §12 normalisation the cube has half-edge 1/√3 (bounding radius 1), so volume (2/√3)³ = 8/(3√3). */
const UNIT_CUBE_VOLUME = CUBE_VOLUME / CUBE_RADIUS ** 3;

/** A mesh as OBJ text (1-based indices, triangles). */
const toObj = (m: Mesh3): string => [
  ...m.positions.map((p) => `v ${p[0]} ${p[1]} ${p[2]}`),
  ...m.triangles.map((t) => `f ${t[0] + 1} ${t[1] + 1} ${t[2] + 1}`),
].join('\n');

/** The cube [−1, 1]³ without its first triangle (half of the −x face). */
const openCube = (): Mesh3 => {
  const cube = box(2, 2, 2);
  return { positions: cube.positions, triangles: cube.triangles.slice(1) };
};

/** Every triangle of a convex mesh about the origin faces away from it. */
function expectOutward(mesh: Mesh3): void {
  for (const [a, b, c] of mesh.triangles) {
    const n = cross3(sub3(mesh.positions[b], mesh.positions[a]), sub3(mesh.positions[c], mesh.positions[a]));
    expect(dot3(n, mesh.positions[a])).toBeGreaterThan(0);
  }
}

describe('normaliseMesh (MATH.md §12)', () => {
  it('moves the bounding-box centre to the origin', () => {
    const moved = translateMesh3(box(2, 4, 6), [10, -20, 5]);
    const { mesh } = normaliseMesh(moved);
    const b = mesh3Bounds(mesh);
    // Exact for these numbers (the centre (10, −20, 5) is representable and the
    // box is symmetric about it); 1e-14 allows the single rounding of the scale.
    for (let k = 0; k < 3; k++) expect((b.min[k] + b.max[k]) / 2).toBeCloseTo(0, 14);
  });

  it('scales so that the bounding radius is 1 and reports the factor', () => {
    // box(2, 4, 6): half extents (1, 2, 3), farthest vertex at √(1 + 4 + 9) = √14.
    const { mesh, report } = normaliseMesh(translateMesh3(box(2, 4, 6), [3, 3, 3]));
    expect(report.scale).toBeCloseTo(1 / Math.sqrt(14), 15);
    expect(mesh3Bounds(mesh).radius).toBeCloseTo(1, 14);
    // Extents are (2, 4, 6)/√14; volume 48/14^{3/2}.
    expect(report.volume).toBeCloseTo(48 / 14 ** 1.5, 13);
    expect(mesh3Volume(mesh)).toBeCloseTo(report.volume, 14);
  });

  it('reports a closed, consistent cube: 12 triangles, no boundary, volume (2/√3)³', () => {
    const { mesh, report } = normaliseMesh(box(2, 2, 2));
    expect(report).toEqual({
      closed: true,
      consistent: true,
      boundaryEdges: 0,
      triangles: 12,
      volume: expect.closeTo(UNIT_CUBE_VOLUME, 13),
      flipped: false,
      scale: expect.closeTo(1 / CUBE_RADIUS, 15),
    });
    expect(isSolid(report)).toBe(true);
    expectOutward(mesh);
  });

  it('reverses an inside-out mesh: flipped, volume positive, orientation outward again', () => {
    const insideOut = flipMesh3(box(2, 2, 2));
    expect(mesh3Volume(insideOut)).toBeCloseTo(-CUBE_VOLUME, 12);
    const { mesh, report } = normaliseMesh(insideOut);
    expect(report.flipped).toBe(true);
    expect(report.volume).toBeCloseTo(UNIT_CUBE_VOLUME, 13);
    expect(mesh3Volume(mesh)).toBeGreaterThan(0);
    expect(report.closed).toBe(true);
    expect(report.consistent).toBe(true);
    expectOutward(mesh);
  });

  it('reports an open mesh: removing one triangle of the cube leaves 3 boundary edges', () => {
    // The removed triangle (0, 4, 6) has 3 edges: the diagonal (0, 6) is shared
    // with the other triangle of its quad, (0, 4) and (4, 6) with the adjacent
    // faces, so each is left with one triangle. 11 triangles remain.
    const { mesh, report } = normaliseMesh(openCube());
    expect(report.closed).toBe(false);
    expect(report.consistent).toBe(true);
    expect(report.boundaryEdges).toBe(3);
    expect(report.triangles).toBe(11);
    expect(isSolid(report)).toBe(false);
    // The flux integral of the cube without that triangle: the triangle has
    // area 2 and lies at distance 1, contributing the cone volume 2·1/3 = 2/3.
    expect(report.volume).toBeCloseTo(((CUBE_VOLUME - 2 / 3) * report.scale ** 3), 13);
    expect(report.flipped).toBe(false);
    expect(mesh.triangles.length).toBe(11);
  });

  it('welds by position: a cube with 36 unshared vertices becomes the closed 8-vertex cube', () => {
    const cube = box(2, 2, 2);
    const positions = cube.triangles.flatMap((t) => t.map((i) => cube.positions[i]));
    const soup: Mesh3 = { positions, triangles: cube.triangles.map((_, i) => [3 * i, 3 * i + 1, 3 * i + 2]) };
    const { mesh, report } = normaliseMesh(soup);
    expect(mesh.positions.length).toBe(8);
    expect(report.triangles).toBe(12);
    expect(report.closed).toBe(true);
    expect(report.consistent).toBe(true);
  });

  it('drops vertices no triangle uses and triangles that collapse, so they do not move the centre or the scale', () => {
    const cube = box(2, 2, 2);
    const stray: Mesh3 = {
      positions: [...cube.positions, [100, 100, 100], [1, 1, 1]],
      // Vertex 7 is (1,1,1); vertex 9 duplicates it, so the triangle (7, 9, 3) collapses in the weld.
      triangles: [...cube.triangles, [7, 9, 3]],
    };
    const { report, mesh } = normaliseMesh(stray);
    expect(report.scale).toBeCloseTo(1 / CUBE_RADIUS, 15);
    expect(report.triangles).toBe(12);
    expect(mesh.positions.length).toBe(8);
    expect(report.closed).toBe(true);
  });

  it('flags non-manifold and inconsistently wound surfaces without repairing them', () => {
    // Two triangles sharing the edge (0, 1) in the same direction: edge traversed twice the same way.
    const inconsistent: Mesh3 = {
      positions: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]],
      triangles: [[0, 1, 2], [0, 1, 3]],
    };
    const r = normaliseMesh(inconsistent).report;
    expect(r.consistent).toBe(false);
    expect(r.closed).toBe(false);
    expect(r.boundaryEdges).toBe(4); // 6 edges, the shared (0, 1) twice in the same direction, the other 4 once
    expect(isSolid(r)).toBe(false);
  });

  it('does not modify its input', () => {
    const input = translateMesh3(box(2, 2, 2), [1, 2, 3]);
    const before = JSON.stringify(input);
    normaliseMesh(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('rejects a model with nothing to normalise', () => {
    expect(() => normaliseMesh({ positions: [], triangles: [] })).toThrow(/no triangles/);
    expect(() => normaliseMesh({ positions: [[0, 0, 0]], triangles: [] })).toThrow(/no triangles/);
    expect(() => normaliseMesh({ positions: [[1, 1, 1], [1, 1, 1], [1, 1, 1]], triangles: [[0, 1, 2]] })).toThrow(/degenerate/);
    expect(() => normaliseMesh({ positions: [[NaN, 0, 0], [1, 0, 0], [0, 1, 0]], triangles: [[0, 1, 2]] })).toThrow(/degenerate/);
    // Two triangles of size 1e-9, 1 apart: the bounding radius is 1/2, the weld
    // tolerance 5e-7 collapses both, and nothing is left.
    expect(() => normaliseMesh({
      positions: [[0, 0, 0], [1e-9, 0, 0], [0, 1e-9, 0], [1, 0, 0], [1 + 1e-9, 0, 0], [1, 1e-9, 0]],
      triangles: [[0, 1, 2], [3, 4, 5]],
    })).toThrow(/no triangles after welding/);
  });
});

describe('extrude(open mesh, h, name, { caps: false }) (MATH.md §9.1, §12)', () => {
  it('slices at w = 0 into the lateral surface: 4 triangles per mesh triangle, area of the mesh', () => {
    const open = openCube();
    const shape = extrude(open, 0.5, 'x', { caps: false });
    expect(shape.caps).toBe(false);
    const slice = shape.slice(hyperplaneW(0));
    // Each prism over a triangle is three tets (a0 b0 c0 c1), (a0 b0 c1 b1),
    // (a0 b1 c1 a1) with bottom vertices at w = −1/2 (negative side) and top
    // vertices at w = +1/2. The first has 3 negative + 1 positive vertices,
    // the third 1 + 3: one triangle each; the second has 2 + 2 and gives a
    // quad, two triangles. 1 + 2 + 1 = 4 per mesh triangle, 11 triangles.
    expect(triangleCount(slice)).toBe(4 * 11);
    // The tets tile the prism, so their slices tile the slice of the prism,
    // T × {0}: the surface area is that of the mesh, 11 triangles of area 2 =
    // 22, up to Float32 coordinates (relative 6e-8).
    expect(mesh3Area(open)).toBe(22);
    expect(Math.abs(surfaceArea(slice) - 22)).toBeLessThan(22 * 1e-6);
    // Open: the boundary of the cube without a triangle is the 3 edges, which stay open.
    const a = analyseSlice(slice);
    expect(a.closed).toBe(false);
  });

  it('leaves the caps out of a tilted slice: a closed cube prism has area 16 without them, 24 with them', () => {
    // [−1, 1]³ × [−1, 1] is the tesseract; the hyperplane x = 0.3 meets the six
    // cells y = ±1, z = ±1, w = ±1 in 2 × 2 squares (area 4 each) and misses
    // the cells x = ±1. The lateral cells are x, y, z = ±1 (four squares
    // after the slice, area 16); the caps are the cells w = ±1 (two squares,
    // area 8). Together they are the surface of a 2 × 2 × 2 cube, area 24.
    const cube = box(2, 2, 2);
    const h = hyperplane([1, 0, 0, 0], 0.3);
    const withCaps = extrude(cube, 1, 'tesseract').slice(h);
    const without = extrude(cube, 1, 'tesseract', { caps: false }).slice(h);
    expect(Math.abs(surfaceArea(withCaps) - 24)).toBeLessThan(24 * 1e-6);
    expect(Math.abs(surfaceArea(without) - 16)).toBeLessThan(16 * 1e-6);
    expect(analyseSlice(withCaps).closed).toBe(true);
    const open = analyseSlice(without);
    expect(open.closed).toBe(false);
    expect(open.boundaryEdges).toBeGreaterThanOrEqual(8); // two square loops, each of at least 4 edges
  });

  it('defaults to caps and does not change the shape otherwise', () => {
    const cube = box(2, 2, 2);
    expect(extrude(cube, 1, 'a').caps).toBe(true);
    expect(extrude(cube, 1, 'a', {}).caps).toBe(true);
    const a = extrude(cube, 1, 'a', { caps: false });
    const b = extrude(cube, 1, 'a');
    expect(a.complex).toEqual(b.complex);
    expect(a.wire()).toEqual(b.wire());
    expect(a.radius()).toBe(b.radius());
    expect(a.wRange()).toEqual(b.wRange());
  });
});

describe('sceneToMesh3 (glTF scene graph, MATH.md §12)', () => {
  const material = new MeshBasicMaterial();
  const cubeMesh = (): Mesh => new Mesh(new BoxGeometry(2, 2, 2), material);

  it('applies the world matrix of every mesh and concatenates them', () => {
    const root = new Group();
    const a = cubeMesh();
    a.position.set(10, 0, 0);
    a.scale.set(1, 2, 3); // edges 2, 4, 6: volume 48
    const b = cubeMesh();
    b.position.set(-10, 0, 0);
    root.add(a, b);
    const parent = new Group();
    parent.position.set(0, 5, 0);
    parent.add(root);
    const mesh = sceneToMesh3(parent);
    expect(mesh.positions.length).toBe(16);
    expect(mesh.triangles.length).toBe(24);
    // Volume of a closed mesh is translation invariant: 48 + 8.
    expect(mesh3Volume(mesh)).toBeCloseTo(56, 10);
    const bounds = mesh3Bounds(mesh);
    // Mesh a spans x ∈ [9, 11], y ∈ 5 ± 2, z ∈ ±3; mesh b spans x ∈ [−11, −9], y ∈ 5 ± 1.
    expect(bounds.min).toEqual([-11, 3, -3]);
    expect(bounds.max).toEqual([11, 7, 3]);
  });

  it('applies rotations: a quarter turn about z swaps the x and y extents', () => {
    const m = new Mesh(new BoxGeometry(2, 4, 6), material);
    m.rotation.z = Math.PI / 2;
    const bounds = mesh3Bounds(sceneToMesh3(m));
    // Extents (2, 4, 6) become (4, 2, 6); cos(π/2) is 6e-17, so 1e-14 absolute.
    expect(bounds.max[0] - bounds.min[0]).toBeCloseTo(4, 14);
    expect(bounds.max[1] - bounds.min[1]).toBeCloseTo(2, 14);
    expect(bounds.max[2] - bounds.min[2]).toBeCloseTo(6, 14);
  });

  it('keeps a mirrored mesh outward: a negative-determinant world matrix reverses the winding back', () => {
    const m = cubeMesh();
    m.scale.set(-1, 1, 1);
    const mesh = sceneToMesh3(m);
    expect(mesh3Volume(mesh)).toBeCloseTo(CUBE_VOLUME, 12);
    expectOutward(mesh);
  });

  it('skips invisible objects and expands every instance of an InstancedMesh', () => {
    const root = new Group();
    const hidden = cubeMesh();
    hidden.visible = false;
    const instanced = new InstancedMesh(new BoxGeometry(2, 2, 2), material, 3);
    for (let i = 0; i < 3; i++) instanced.setMatrixAt(i, new Matrix4().makeTranslation(10 * i, 0, 0));
    instanced.position.set(0, 0, 7);
    root.add(hidden, instanced);
    const mesh = sceneToMesh3(root);
    expect(mesh.triangles.length).toBe(36);
    expect(mesh3Volume(mesh)).toBeCloseTo(3 * CUBE_VOLUME, 11);
    const bounds = mesh3Bounds(mesh);
    expect(bounds.min).toEqual([-1, -1, 6]);
    expect(bounds.max).toEqual([21, 1, 8]);
  });

  it('returns an empty mesh for a scene without meshes', () => {
    expect(sceneToMesh3(new Group())).toEqual({ positions: [], triangles: [] });
    expect(sceneToMesh3(new Line())).toEqual({ positions: [], triangles: [] });
  });
});

/**
 * A binary glTF with one mesh (three's BoxGeometry(2, 2, 2): 24 vertices and
 * 36 uint16 indices, the seam-split layout exporters write) instanced by the
 * given nodes.
 */
function cubeGlb(nodes: object[]): ArrayBuffer {
  const g = new BoxGeometry(2, 2, 2);
  const indices = g.getIndex()?.array as Uint16Array;
  const positions = g.getAttribute('position').array as Float32Array;
  const bin = new Uint8Array(indices.byteLength + positions.byteLength); // 72 + 288, a multiple of 4
  bin.set(new Uint8Array(indices.buffer, indices.byteOffset, indices.byteLength), 0);
  bin.set(new Uint8Array(positions.buffer, positions.byteOffset, positions.byteLength), indices.byteLength);
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes: [{ primitives: [{ attributes: { POSITION: 1 }, indices: 0 }] }],
    accessors: [
      { bufferView: 0, componentType: 5123, count: indices.length, type: 'SCALAR' },
      { bufferView: 1, componentType: 5126, count: 24, type: 'VEC3', min: [-1, -1, -1], max: [1, 1, 1] },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: indices.byteLength },
      { buffer: 0, byteOffset: indices.byteLength, byteLength: positions.byteLength },
    ],
    buffers: [{ byteLength: bin.byteLength }],
  };
  let jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const pad = (4 - (jsonBytes.length % 4)) % 4;
  jsonBytes = new Uint8Array([...jsonBytes, ...new Array<number>(pad).fill(0x20)]);
  const total = 12 + 8 + jsonBytes.length + 8 + bin.length;
  const out = new ArrayBuffer(total);
  const view = new DataView(out);
  const bytes = new Uint8Array(out);
  view.setUint32(0, 0x46546c67, true); // 'glTF'
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonBytes.length, true);
  view.setUint32(16, 0x4e4f534a, true); // 'JSON'
  bytes.set(jsonBytes, 20);
  const binStart = 20 + jsonBytes.length;
  view.setUint32(binStart, bin.length, true);
  view.setUint32(binStart + 4, 0x004e4942, true); // 'BIN\0'
  bytes.set(bin, binStart + 8);
  return out;
}

describe('loadModelFile (MATH.md §12)', () => {
  it('reads an .obj through parseObj and names the model after the file', async () => {
    const cube = box(2, 2, 2);
    const loaded = await loadModelFile(new File([toObj(cube)], 'My Cube.v2.OBJ'));
    expect(loaded.name).toBe('My Cube.v2');
    expect(loaded.mesh).toEqual(parseObj(toObj(cube)));
    expect(mesh3Volume(loaded.mesh)).toBeCloseTo(CUBE_VOLUME, 12);
  });

  it('reads a .glb with three\'s GLTFLoader: node transform applied, seams welded after normalisation', async () => {
    // Node 0 scales the cube [−1,1]³ by (1, 2, 3) (edges 2, 4, 6) and moves it by (5, −1, 2).
    const file = new File([cubeGlb([{ mesh: 0, scale: [1, 2, 3], translation: [5, -1, 2] }])], 'block.glb');
    const { name, mesh } = await loadModelFile(file);
    expect(name).toBe('block');
    expect(mesh.triangles.length).toBe(12);
    expect(mesh3Volume(mesh)).toBeCloseTo(48, 4); // Float32 positions: relative 1e-7
    const b = mesh3Bounds(mesh);
    expect(b.min.map((v) => Math.round(v * 1e5) / 1e5)).toEqual([4, -3, -1]);
    expect(b.max.map((v) => Math.round(v * 1e5) / 1e5)).toEqual([6, 1, 5]);
    // Normalised: the 24 seam-split vertices weld into the 8 corners and the box is closed.
    const { mesh: unit, report } = normaliseMesh(mesh);
    expect(unit.positions.length).toBe(8);
    expect(report.closed).toBe(true);
    expect(report.consistent).toBe(true);
    expect(report.flipped).toBe(false);
    // Half extents (1, 2, 3): radius √14, volume 48 / 14^{3/2}.
    expect(report.scale).toBeCloseTo(1 / Math.sqrt(14), 6);
    expect(report.volume).toBeCloseTo(48 / 14 ** 1.5, 6);
  });

  it('concatenates the meshes of several nodes and keeps a mirrored node outward', async () => {
    const file = new File([cubeGlb([
      { mesh: 0, translation: [-10, 0, 0] },
      { mesh: 0, translation: [10, 0, 0], scale: [-1, 1, 1] },
    ])], 'pair.glb');
    const { mesh } = await loadModelFile(file);
    expect(mesh.triangles.length).toBe(24);
    expect(mesh3Volume(mesh)).toBeCloseTo(2 * CUBE_VOLUME, 5);
    const report = normaliseMesh(mesh).report;
    expect(report.closed).toBe(true);
    expect(report.flipped).toBe(false);
  });

  it('reads a self-contained .gltf the same way', async () => {
    // three's FileLoader reports progress with a ProgressEvent, which browsers have and Node does not.
    vi.stubGlobal('ProgressEvent', class extends Event {
      constructor(type: string, init: object = {}) { super(type); Object.assign(this, init); }
    });
    // The same cube with its buffer embedded as a data URI.
    const glb = new Uint8Array(cubeGlb([{ mesh: 0 }]));
    const jsonLength = new DataView(glb.buffer).getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLength))) as { buffers: { uri?: string }[] };
    const binStart = 20 + jsonLength + 8;
    const payload = glb.subarray(binStart);
    json.buffers[0].uri = `data:application/octet-stream;base64,${btoa(String.fromCharCode(...payload))}`;
    const { mesh } = await loadModelFile(new File([JSON.stringify(json)], 'cube.gltf'));
    expect(mesh.triangles.length).toBe(12);
    expect(mesh3Volume(mesh)).toBeCloseTo(CUBE_VOLUME, 5);
  }, 20_000);

  it('rejects unsupported, empty and malformed files with a message', async () => {
    await expect(loadModelFile(new File(['solid x'], 'part.stl'))).rejects.toThrow(/'\.stl' is not a supported type/);
    await expect(loadModelFile(new File(['v 0 0 0'], 'noextension'))).rejects.toThrow(/no file extension/);
    await expect(loadModelFile(new File(['v 0 0 0'], 'points.obj'))).rejects.toThrow(/points\.obj.*no triangles/);
    await expect(loadModelFile(new File(['v 0 0 0\nf 1 2 3'], 'bad.obj'))).rejects.toThrow(/line 2.*out of range/);
    await expect(loadModelFile(new File([new Uint8Array([1, 2, 3, 4])], 'junk.glb'))).rejects.toThrow();
  });
});

describe('registerImportedShape (MATH.md §12, §9)', () => {
  const closed = normaliseMesh(box(2, 2, 2));
  const open = normaliseMesh(openCube());

  it('slugifies the name into the id', () => {
    expect(slugify('My Cube.v2')).toBe('my-cube-v2');
    expect(slugify('  --Ünïcode__Name!! ')).toBe('unicode-name');
    expect(slugify('日本語')).toBe('model');
    expect(slugify('')).toBe('model');
    expect(slugify('a'.repeat(100)).length).toBe(40);
    expect(slugify(`${'a'.repeat(39)}-b`)).toBe('a'.repeat(39));
  });

  it('registers a closed model extruded: id, group, description, and a prism with caps', () => {
    const entry = registerImportedShape('Cube', closed.mesh, 'extrude', closed.report);
    expect(entry.id).toBe(`${IMPORT_ID_PREFIX}cube-extrude`);
    expect(entry.group).toBe('Imported');
    expect(entry.label).toContain('Cube');
    expect(entry.description).toMatch(/extruded/);
    expect(entry.description).toContain('12 triangles');
    expect(entry.description).toContain('closed');
    expect(getShape(entry.id)).toBe(entry);
    const shape = entry.create();
    expect(shape).toBeInstanceOf(ExtrudedSolid);
    expect(shape.name).toBe('Cube');
    const solid = shape as ExtrudedSolid;
    expect(solid.caps).toBe(true);
    expect(solid.halfHeight).toBe(0.5);
    // The normalised model has bounding radius 1: |p|² = 1 + (1/2)² at the farthest vertices.
    expect(solid.radius()).toBeCloseTo(Math.sqrt(1.25), 14);
    expect(solid.wRange()).toEqual([-0.5, 0.5]);
  });

  it('the slice of the extruded model at w = 0 is the model itself', () => {
    const shape = registerImportedShape('Cube', closed.mesh, 'extrude', closed.report).create();
    const slice = shape.slice(hyperplaneW(0));
    expect(signedVolume(slice)).toBeCloseTo(UNIT_CUBE_VOLUME, 5);
    expect(Math.abs(surfaceArea(slice) - mesh3Area(closed.mesh))).toBeLessThan(1e-5);
  });

  it('registers an open model extruded without caps and says that its slices are open surfaces', () => {
    const entry = registerImportedShape('Cut Cube', open.mesh, 'extrude', open.report);
    expect(entry.id).toBe(`${IMPORT_ID_PREFIX}cut-cube-extrude`);
    expect(entry.description).toContain('11 triangles');
    expect(entry.description).toContain('open (3 boundary edges; slices are open surfaces)');
    expect((entry.create() as ExtrudedSolid).caps).toBe(false);
  });

  it('registers a closed model spun about z = 0 in 48 steps', () => {
    const entry = registerImportedShape('Cube', closed.mesh, 'spin', closed.report);
    expect(entry.id).toBe(`${IMPORT_ID_PREFIX}cube-spin`);
    expect(entry.description).toMatch(/spun/);
    const shape = entry.create();
    expect(shape).toBeInstanceOf(SpunSolid);
    const spun = shape as SpunSolid;
    expect(spun.steps).toBe(48);
    // The normalised cube crosses z = 0, so it is clipped to z ≥ 0 (§9.4); its
    // height is the half edge 1/√3 and the 4D figure spans w ∈ [−1/√3, 1/√3] (§9.2).
    expect(spun.clipped).toBe(true);
    const [lo, hi] = spun.wRange();
    expect(hi).toBeCloseTo(1 / Math.sqrt(3), 12);
    expect(lo).toBeCloseTo(-1 / Math.sqrt(3), 12);
  });

  it('refuses to spin a model that is not closed', () => {
    expect(() => registerImportedShape('Cut Cube', open.mesh, 'spin', open.report)).toThrow(/closed.*open \(3 boundary edges/);
    expect(getShape(`${IMPORT_ID_PREFIX}cut-cube-spin`)).toBeUndefined();
  });

  it('replaces an earlier import of the same name and lifting and keeps the two liftings apart', () => {
    const first = registerImportedShape('Thing', closed.mesh, 'extrude', closed.report);
    const spun = registerImportedShape('Thing', closed.mesh, 'spin', closed.report);
    const again = registerImportedShape('Thing', open.mesh, 'extrude', open.report);
    expect(again.id).toBe(first.id);
    expect(again).not.toBe(first);
    expect(getShape(first.id)).toBe(again);
    expect(getShape(spun.id)).toBe(spun);
    expect(listShapes().filter((e) => e.id.startsWith(IMPORT_ID_PREFIX)).length).toBe(2);
  });
});

describe('report text', () => {
  const report = (over: Partial<ImportReport>): ImportReport => ({
    closed: true, consistent: true, boundaryEdges: 0, triangles: 12, volume: 1.5396, flipped: false, scale: 0.57735, ...over,
  });

  it('closednessText names the defect', () => {
    expect(closednessText(report({}))).toBe('closed');
    expect(closednessText(report({ closed: false, boundaryEdges: 3 }))).toBe('open (3 boundary edges; slices are open surfaces)');
    expect(closednessText(report({ closed: false, boundaryEdges: 0 }))).toMatch(/more than two triangles/);
    expect(closednessText(report({ consistent: false }))).toMatch(/inconsistently oriented/);
  });

  it('describeReport gives size, closedness, volume, flip and scale on one line', () => {
    expect(describeReport('cube', report({}))).toBe(
      'cube: 12 triangles, closed, volume 1.54 (bounding radius 1), scaled by 0.577.',
    );
    const text = describeReport('cube', report({ flipped: true }));
    expect(text).toContain('winding reversed');
    const openText = describeReport('cube', report({ closed: false, boundaryEdges: 3, triangles: 11 }));
    expect(openText).toContain('11 triangles, open (3 boundary edges; slices are open surfaces)');
    expect(openText).not.toContain('volume');
  });
});

describe('ImportSession (the state behind the panel)', () => {
  const cubeFile = (name = 'cube.obj'): File => new File([toObj(box(2, 2, 2))], name);
  const openFile = (name = 'cut.obj'): File => new File([toObj(openCube())], name);

  it('loads, registers with the chosen lifting, announces and describes a closed model', async () => {
    const announced: string[] = [];
    const session = new ImportSession((entry, report) => announced.push(`${entry.id} ${report.triangles}`));
    const outcome = await session.load(cubeFile());
    expect(outcome?.lifting).toBe('extrude');
    expect(outcome?.entry.id).toBe(`${IMPORT_ID_PREFIX}cube-extrude`);
    expect(outcome?.status).toBe('cube: 12 triangles, closed, volume 1.54 (bounding radius 1), scaled by 0.577.');
    expect(announced).toEqual([`${IMPORT_ID_PREFIX}cube-extrude 12`]);
    expect(session.spinAvailable).toBe(true);
  });

  it('re-registers the loaded model when the lifting changes, without reading the file again', async () => {
    const announced: string[] = [];
    const session = new ImportSession((entry) => announced.push(entry.id));
    expect(session.setLifting('spin')).toBeNull(); // nothing loaded yet; the choice is kept
    expect(session.lifting).toBe('spin');
    const loaded = await session.load(cubeFile('ball.obj'));
    expect(loaded?.lifting).toBe('spin');
    expect(session.setLifting('extrude')?.entry.id).toBe(`${IMPORT_ID_PREFIX}ball-extrude`);
    expect(announced).toEqual([`${IMPORT_ID_PREFIX}ball-spin`, `${IMPORT_ID_PREFIX}ball-extrude`]);
  });

  it('extrudes an open model even when spin was chosen, says so, and then refuses spin', async () => {
    const session = new ImportSession(() => undefined);
    session.setLifting('spin');
    const outcome = await session.load(openFile());
    expect(outcome?.lifting).toBe('extrude');
    expect(outcome?.status).toContain('open (3 boundary edges; slices are open surfaces)');
    expect(outcome?.status).toContain('Spin needs a closed model, so it is extruded.');
    expect(session.lifting).toBe('extrude');
    expect(session.spinAvailable).toBe(false);
    expect(() => session.setLifting('spin')).toThrow(/Spin needs a closed model/);
  });

  it('warns that slices will be slow above HEAVY_TRIANGLES triangles', async () => {
    const session = new ImportSession(() => undefined);
    const small = await session.load(cubeFile());
    expect(small?.status).not.toContain('slow');
    // A flat fan of 40 001 thin triangles about a hub (a degenerate-free open surface is enough: only the count matters).
    const n = HEAVY_TRIANGLES + 1;
    const positions: number[][] = [[0, 0, 0]];
    const triangles: number[][] = [];
    for (let i = 0; i <= n; i++) positions.push([Math.cos((2 * Math.PI * i) / n), Math.sin((2 * Math.PI * i) / n), 0]);
    for (let i = 1; i <= n; i++) triangles.push([0, i, i + 1]);
    const text = toObj({ positions: positions as Mesh3['positions'], triangles: triangles as Mesh3['triangles'] });
    const big = await session.load(new File([text], 'fan.obj'));
    expect(big?.report.triangles).toBe(n);
    expect(big?.status).toContain('Large model: slices will be slow.');
  });

  it('rejects unusable files with the message to show', async () => {
    const session = new ImportSession(() => { throw new Error('must not be announced'); });
    await expect(session.load(new File([''], 'empty.obj'))).rejects.toThrow(/empty\.obj.*no triangles/);
    await expect(session.load(new File(['x'], 'model.stl'))).rejects.toThrow(/not a supported type/);
    await expect(session.load(new File(['v 1 1 1\nv 1 1 1\nv 1 1 1\nf 1 2 3'], 'dot.obj'))).rejects.toThrow(/degenerate/);
  });

  it('drops the result, and the error, of a load that a later load superseded', async () => {
    const announced: string[] = [];
    const session = new ImportSession((entry) => announced.push(entry.id));
    const stale = session.load(new File(['x'], 'broken.stl')); // would reject
    const staleOk = session.load(cubeFile('first.obj')); // would resolve
    const latest = session.load(cubeFile('second.obj'));
    expect(await stale).toBeNull();
    expect(await staleOk).toBeNull();
    expect((await latest)?.entry.id).toBe(`${IMPORT_ID_PREFIX}second-extrude`);
    expect(announced).toEqual([`${IMPORT_ID_PREFIX}second-extrude`]);
  });

  it('cancel() drops a load in flight', async () => {
    const announced: string[] = [];
    const session = new ImportSession((entry) => announced.push(entry.id));
    const pending = session.load(cubeFile());
    session.cancel();
    expect(await pending).toBeNull();
    expect(announced).toEqual([]);
  });

  it('an imported OBJ lifts end to end: the extruded slice at w = 0 is the normalised model', async () => {
    const session = new ImportSession(() => undefined);
    const outcome = await session.load(new File([toObj(translateMesh3(scaleMesh3(box(2, 2, 2), 5), [7, 7, 7]))], 'big.obj'));
    const slice = outcome?.entry.create().slice(hyperplaneW(0));
    if (!slice) throw new Error('no outcome');
    // Scaling by 5 and translating do not change the normalised model.
    expect(signedVolume(slice)).toBeCloseTo(UNIT_CUBE_VOLUME, 5);
    expect(analyseSlice(slice).closed).toBe(true);
  });
});

// ---- WebXR -----------------------------------------------------------------------

/** What the XR tests need of WebGLRenderer.xr: events, the enabled flag, two controllers and a session. */
class FakeXRManager extends EventDispatcher<{ sessionstart: object; sessionend: object }> {
  enabled = false;
  readonly controllers = [new Group(), new Group()];
  session: { end: () => Promise<void> } | null = null;
  getController(i: number): Group { return this.controllers[i]; }
  getSession(): { end: () => Promise<void> } | null { return this.session; }
}

function xrFixture(radius = 2) {
  const xr = new FakeXRManager();
  const renderer = { xr } as unknown as WebGLRenderer;
  const scene = new Scene();
  const grid = new GridHelper(8, 16);
  scene.add(grid);
  const world = new Group();
  scene.add(world);
  world.position.set(1, 2, 3);
  world.scale.setScalar(1.5);
  const state = { radius, selects: 0 };
  const onSelect = (): void => { state.selects++; };
  return { xr, renderer, scene, grid, world, state, onSelect, opts: { getRadius: () => state.radius, onSelect } };
}

describe('setupXR (WebXR session placement)', () => {
  it('does nothing and gives no button when the browser has no WebXR', () => {
    vi.stubGlobal('navigator', {});
    const f = xrFixture();
    const setup = setupXR(f.renderer, f.scene, f.world, f.opts);
    expect(setup.button).toBeNull();
    expect(f.xr.enabled).toBe(false);
    expect(f.scene.children.length).toBe(2); // grid and world only: no controllers
    setup.refit();
    setup.dispose();
  });

  const withXR = (supported = true): void => {
    vi.stubGlobal('navigator', { xr: { isSessionSupported: () => Promise.resolve(supported) } });
    fakeButton.hidden = false;
    fakeButton.style = {};
  };

  it('enables XR and returns the VR button without attaching it', () => {
    withXR();
    const f = xrFixture();
    const setup = setupXR(f.renderer, f.scene, f.world, f.opts);
    expect(setup.button).toBe(fakeButton);
    expect(f.xr.enabled).toBe(true);
  });

  it('places the world at (0, 1.3, −1.1) scaled so the radius is 0.35 m for a session, then restores it', () => {
    withXR();
    const f = xrFixture(2);
    setupXR(f.renderer, f.scene, f.world, f.opts);
    expect(XR_WORLD_POSITION).toEqual([0, 1.3, -1.1]);
    expect(XR_TARGET_RADIUS).toBe(0.35);
    f.xr.dispatchEvent({ type: 'sessionstart' });
    expect(f.world.position.toArray()).toEqual([0, 1.3, -1.1]);
    // Radius 2 maps to 0.35 m: scale 0.35 / 2 = 0.175.
    expect(f.world.scale.toArray()).toEqual([0.175, 0.175, 0.175]);
    expect(f.grid.visible).toBe(false); // sized for the desktop camera, not for a room
    f.xr.dispatchEvent({ type: 'sessionend' });
    expect(f.world.position.toArray()).toEqual([1, 2, 3]);
    expect(f.world.scale.toArray()).toEqual([1.5, 1.5, 1.5]);
    expect(f.grid.visible).toBe(true);
    // A second session starts from the restored transform again.
    f.state.radius = 0.7;
    f.xr.dispatchEvent({ type: 'sessionstart' });
    expect(f.world.scale.x).toBeCloseTo(0.5, 15);
    f.xr.dispatchEvent({ type: 'sessionend' });
    expect(f.world.scale.x).toBe(1.5);
  });

  it('refit() follows a change of the radius during a session and does nothing outside one', () => {
    withXR();
    const f = xrFixture(2);
    const setup = setupXR(f.renderer, f.scene, f.world, f.opts);
    f.state.radius = 4;
    setup.refit();
    expect(f.world.scale.x).toBe(1.5); // not in a session
    f.xr.dispatchEvent({ type: 'sessionstart' });
    expect(f.world.scale.x).toBe(0.0875);
    f.state.radius = 0.35;
    setup.refit();
    expect(f.world.scale.x).toBeCloseTo(1, 15);
  });

  it('falls back to scale 1 for a radius that is zero or not finite', () => {
    withXR();
    for (const radius of [0, -1, NaN, Infinity]) {
      const f = xrFixture(radius);
      setupXR(f.renderer, f.scene, f.world, f.opts);
      f.xr.dispatchEvent({ type: 'sessionstart' });
      expect(f.world.scale.x).toBe(1);
    }
  });

  it('adds a ray to each controller in the scene and calls onSelect on select', () => {
    withXR();
    const f = xrFixture();
    setupXR(f.renderer, f.scene, f.world, f.opts);
    for (const c of f.xr.controllers) {
      expect(c.parent).toBe(f.scene);
      expect(c.children.some((o) => o instanceof Line)).toBe(true);
    }
    f.xr.controllers[0].dispatchEvent({ type: 'select' } as never);
    f.xr.controllers[1].dispatchEvent({ type: 'select' } as never);
    expect(f.state.selects).toBe(2);
  });

  it('hides the button unless an immersive VR session is supported', async () => {
    withXR(false);
    const f = xrFixture();
    setupXR(f.renderer, f.scene, f.world, f.opts);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fakeButton.hidden).toBe(true);
    expect(fakeButton.style.visibility).toBe('hidden');
    withXR(true);
    setupXR(xrFixture().renderer, new Scene(), new Group(), { getRadius: () => 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fakeButton.hidden).toBe(false);
  });

  it('dispose() restores a running session, ends it, removes the controllers and stops listening', () => {
    withXR();
    const f = xrFixture(2);
    const end = vi.fn(() => Promise.resolve());
    const remove = vi.spyOn(fakeButton, 'remove');
    const setup = setupXR(f.renderer, f.scene, f.world, f.opts);
    f.xr.dispatchEvent({ type: 'sessionstart' });
    f.xr.session = { end };
    setup.dispose();
    expect(f.world.position.toArray()).toEqual([1, 2, 3]);
    expect(f.world.scale.x).toBe(1.5);
    expect(f.grid.visible).toBe(true);
    expect(end).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(f.xr.enabled).toBe(false);
    expect(f.scene.children.filter((c) => f.xr.controllers.includes(c as Group)).length).toBe(0);
    f.xr.controllers[0].dispatchEvent({ type: 'select' } as never);
    expect(f.state.selects).toBe(0);
    f.xr.dispatchEvent({ type: 'sessionstart' });
    expect(f.world.position.toArray()).toEqual([1, 2, 3]); // no longer listening
    setup.dispose(); // idempotent
    expect(end).toHaveBeenCalledTimes(1);
  });
});
