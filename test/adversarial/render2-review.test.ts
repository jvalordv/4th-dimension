/**
 * Adversarial review of the round-2 app shell (src/app/import.ts, obj.ts,
 * state.ts, ui.ts helpers, src/render/xr.ts, viewer helpers) against
 * docs/MATH.md §9.1, §9.3, §12. Pure-function checks only: nothing here
 * creates a WebGLRenderer or touches the DOM. Every expectation is derived in
 * its comment from the specification or an independent hand computation,
 * never read back from the implementation.
 */
import { describe, expect, it } from 'vitest';
import { BoxGeometry, Group, Mesh } from 'three';
import '../../src/app/shapes';
import { getShape, IMPORT_ID_PREFIX, listShapes, unregisterShape } from '../../src/app/registry';
import { ShapeCache } from '../../src/app/state';
import { shapeTopic } from '../../src/app/ui';
import {
  closednessText,
  describeReport,
  IMPORT_EXTRUDE_HALF_HEIGHT,
  ImportSession,
  isSolid,
  loadModelFile,
  normaliseMesh,
  registerImportedShape,
  sceneToMesh3,
  slugify,
} from '../../src/app/import';
import { fromBufferGeometry, parseObj } from '../../src/app/obj';
import { setupXR, XR_TARGET_RADIUS, XR_WORLD_POSITION } from '../../src/render/xr';
import { projectedExtent } from '../../src/render/viewer';
import { ExtrudedSolid, extrude } from '../../src/geometry/extrude';
import { mesh3Volume } from '../../src/geometry/mesh3';
import { creatureScene } from '../../src/geometry/sdf-figures';
import { SdfShape } from '../../src/geometry/sdf-shape';
import { hyperplaneFromRotation, hyperplaneW } from '../../src/math/hyperplane';
import { rotation } from '../../src/math/rotation';
import type { TriMesh3, Vec4 } from '../../src/math/types';
import { getExplainer, FLAT_SHAPE_IDS } from '../../src/explain';
import { flatModeTopic, FLAT_VIEW_MODES } from '../../src/flat/state';

// ---------------------------------------------------------------------------
// Fixtures written by hand (not built with the code under test)
// ---------------------------------------------------------------------------

/**
 * The cube [0, 2]³ as Wavefront quads, every face counter-clockwise seen from
 * outside (checked by hand: for the bottom face 1 4 3 2, (v4 − v1) × (v3 − v1)
 * = (0, 2, 0) × (2, 2, 0) = (0, 0, −4), pointing to −z, outward). Volume 8,
 * bounding-box centre (1, 1, 1), bounding radius √3.
 */
const CUBE_FACES = [
  'f 1 4 3 2', // z = 0, outward −z
  'f 5 6 7 8', // z = 2, outward +z
  'f 1 2 6 5', // y = 0, outward −y
  'f 4 8 7 3', // y = 2, outward +y
  'f 1 5 8 4', // x = 0, outward −x
  'f 2 3 7 6', // x = 2, outward +x
];
const CUBE_VERTICES = [
  'v 0 0 0', 'v 2 0 0', 'v 2 2 0', 'v 0 2 0',
  'v 0 0 2', 'v 2 0 2', 'v 2 2 2', 'v 0 2 2',
];
const cubeObj = (faces: readonly string[] = CUBE_FACES): string => [...CUBE_VERTICES, ...faces, ''].join('\n');
/** The cube without its top: 5 quads, 4 boundary edges (the rim at z = 2). */
const OPEN_CUBE_OBJ = cubeObj(CUBE_FACES.filter((f) => f !== 'f 5 6 7 8'));
/** Every face reversed: a closed cube wound inside out (signed volume −8). */
const INSIDE_OUT_CUBE_OBJ = cubeObj(CUBE_FACES.map((f) => `f ${f.slice(2).split(' ').reverse().join(' ')}`));
/** One face reversed: closed, but not consistently oriented. */
const MIXED_CUBE_OBJ = cubeObj(CUBE_FACES.map((f, i) => (i === 0 ? `f ${f.slice(2).split(' ').reverse().join(' ')}` : f)));

/** Side of the cube after §12 normalisation: the bounding radius √3 becomes 1, so the side 2 becomes 2/√3. */
const NORMALISED_SIDE = 2 / Math.sqrt(3);

const makeFile = (text: string, name: string): File => new File([text], name, { type: 'text/plain' });

// ---------------------------------------------------------------------------
// Independent helpers for TriMesh3 output
// ---------------------------------------------------------------------------

/** Total area of the triangles (shoelace in 3D, half the cross product norm). */
function triMeshArea(m: TriMesh3): number {
  const p = m.positions;
  let area = 0;
  for (let t = 0; t < m.indices.length; t += 3) {
    const [a, b, c] = [m.indices[t] * 3, m.indices[t + 1] * 3, m.indices[t + 2] * 3];
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    area += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  }
  return area;
}

/**
 * Boundary of a triangle soup after welding vertices by rounded position:
 * the undirected edges used by exactly one triangle, as a count and a total
 * length. A closed surface has none.
 */
function boundaryOf(m: TriMesh3, digits = 5): { edges: number; length: number } {
  const ids = new Map<string, number>();
  const pos: number[][] = [];
  const idOf = (i: number): number => {
    const key = [0, 1, 2].map((k) => m.positions[i * 3 + k].toFixed(digits)).join(',');
    let id = ids.get(key);
    if (id === undefined) {
      id = pos.length;
      ids.set(key, id);
      pos.push([m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]]);
    }
    return id;
  };
  const uses = new Map<string, number>();
  for (let t = 0; t < m.indices.length; t += 3) {
    const v = [idOf(m.indices[t]), idOf(m.indices[t + 1]), idOf(m.indices[t + 2])];
    if (v[0] === v[1] || v[1] === v[2] || v[0] === v[2]) continue; // degenerate after welding
    for (let k = 0; k < 3; k++) {
      const a = v[k], b = v[(k + 1) % 3];
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      uses.set(key, (uses.get(key) ?? 0) + 1);
    }
  }
  let edges = 0;
  let length = 0;
  for (const [key, n] of uses) {
    if (n !== 1) continue;
    edges++;
    const [a, b] = key.split('-').map(Number);
    length += Math.hypot(pos[a][0] - pos[b][0], pos[a][1] - pos[b][1], pos[a][2] - pos[b][2]);
  }
  return { edges, length };
}

const importedIds = (): string[] => listShapes().map((e) => e.id).filter((id) => id.startsWith(IMPORT_ID_PREFIX));
const clearImports = (): void => { for (const id of importedIds()) unregisterShape(id); };

// ---------------------------------------------------------------------------
// §12: normalisation and validation of an imported model
// ---------------------------------------------------------------------------

describe('MATH.md §12: imported model normalisation', () => {
  it('recentres at the bounding-box centre, scales the bounding radius to 1 and reports a closed cube as a solid', () => {
    const { mesh, report } = normaliseMesh(parseObj(cubeObj()));
    expect(report.closed).toBe(true);
    expect(report.consistent).toBe(true);
    expect(isSolid(report)).toBe(true);
    expect(report.boundaryEdges).toBe(0);
    expect(report.triangles).toBe(12);
    expect(report.flipped).toBe(false);
    // Scale 1/√3; volume of a cube of side 2/√3 is 8/(3√3).
    expect(report.scale).toBeCloseTo(1 / Math.sqrt(3), 12);
    expect(report.volume).toBeCloseTo(NORMALISED_SIDE ** 3, 12);
    // Bounding radius exactly 1 and centre at the origin.
    let r2 = 0;
    const centre = [0, 0, 0];
    for (const p of mesh.positions) {
      r2 = Math.max(r2, p[0] ** 2 + p[1] ** 2 + p[2] ** 2);
      for (let k = 0; k < 3; k++) centre[k] += p[k] / mesh.positions.length;
    }
    expect(Math.sqrt(r2)).toBeCloseTo(1, 12);
    for (const c of centre) expect(Math.abs(c)).toBeLessThan(1e-12);
  });

  it('reverses an inside-out closed model and says so; the signed volume ends positive', () => {
    const { mesh, report } = normaliseMesh(parseObj(INSIDE_OUT_CUBE_OBJ));
    expect(report.flipped).toBe(true);
    expect(report.volume).toBeCloseTo(NORMALISED_SIDE ** 3, 12);
    expect(mesh3Volume(mesh)).toBeCloseTo(NORMALISED_SIDE ** 3, 12);
    expect(describeReport('cube', report)).toContain('winding reversed');
  });

  it('reports an open model (4 boundary edges) and says its slices are open surfaces', () => {
    const { report } = normaliseMesh(parseObj(OPEN_CUBE_OBJ));
    expect(report.closed).toBe(false);
    expect(report.boundaryEdges).toBe(4);
    expect(report.triangles).toBe(10);
    expect(isSolid(report)).toBe(false);
    const text = closednessText(report);
    expect(text).toMatch(/^open \(4 boundary edges/);
    expect(text).toContain('slices are open surfaces');
    // The status line carries the same statement and no volume (it is not a solid's volume).
    const status = describeReport('open', report);
    expect(status).toContain('open surfaces');
    expect(status).not.toContain('volume');
  });

  it('a closed but inconsistently wound model is not a solid, and the text says why', () => {
    const { report } = normaliseMesh(parseObj(MIXED_CUBE_OBJ));
    expect(report.closed).toBe(true);
    expect(report.consistent).toBe(false);
    expect(isSolid(report)).toBe(false);
    expect(closednessText(report)).toContain('inconsistently oriented');
  });

  it('a mirrored node in a glTF scene keeps outward winding (sceneToMesh3 flips it back)', () => {
    for (const mirror of [false, true]) {
      const mesh = new Mesh(new BoxGeometry(2, 2, 2));
      if (mirror) mesh.scale.set(-1, 1, 1);
      const root = new Group();
      root.add(mesh);
      const raw = sceneToMesh3(root);
      // 24 vertices of the three.js box weld to the cube's 8 corners.
      expect(fromBufferGeometry(mesh.geometry).positions.length).toBe(8);
      expect(raw.triangles.length).toBe(12);
      // Outward orientation survives the mirror: signed volume +8, not −8.
      expect(mesh3Volume(raw)).toBeCloseTo(8, 9);
      const { report } = normaliseMesh(raw);
      expect(report.flipped).toBe(false);
      expect(isSolid(report)).toBe(true);
    }
  });

  it('slugify gives a lowercase ASCII id of at most 40 characters', () => {
    expect(slugify('Über Model.v2')).toBe('uber-model-v2');
    expect(slugify('!!!')).toBe('model');
    expect(slugify('a'.repeat(60))).toHaveLength(40);
    expect(slugify('Cube')).toBe(slugify('cube'));
  });

  it.skipIf(typeof File === 'undefined')('loadModelFile names the model after the file and rejects unknown types', async () => {
    const { name, mesh } = await loadModelFile(makeFile(cubeObj(), 'My Cube.obj'));
    expect(name).toBe('My Cube');
    expect(mesh.triangles.length).toBe(12);
    await expect(loadModelFile(makeFile('solid x', 'x.stl'))).rejects.toThrow(/\.stl/);
    await expect(loadModelFile(makeFile('', 'noext'))).rejects.toThrow(/no file extension/);
    await expect(loadModelFile(makeFile('v 0 0 0\n', 'empty.obj'))).rejects.toThrow(/no triangles/);
  });
});

// ---------------------------------------------------------------------------
// §12 + §9.1: registering, replacing, and slicing an open model without caps
// ---------------------------------------------------------------------------

describe('MATH.md §12: registering imported models', () => {
  it('replacing a model with the same name (any case) leaves exactly one entry, rebuilt from the new mesh', () => {
    clearImports();
    const a = normaliseMesh(parseObj(cubeObj()));
    const b = normaliseMesh(parseObj(OPEN_CUBE_OBJ));
    const first = registerImportedShape('Cube', a.mesh, 'extrude', a.report);
    const cache = new ShapeCache();
    const builtA = cache.get(first.id) as ExtrudedSolid;
    expect(builtA.mesh.triangles.length).toBe(12);

    const second = registerImportedShape('cube', b.mesh, 'extrude', b.report);
    expect(second.id).toBe(first.id);
    expect(importedIds().filter((id) => id === first.id)).toHaveLength(1);
    expect(getShape(first.id)).toBe(second);
    expect(second.description).toContain('10 triangles');
    expect(second.description).toContain('open surfaces');

    // The viewer's cache must be told; after evict() the entry's new create() runs.
    expect(cache.get(first.id)).toBe(builtA);
    expect(cache.evict(first.id)).toBe(true);
    const builtB = cache.get(first.id) as ExtrudedSolid;
    expect(builtB).not.toBe(builtA);
    expect(builtB.mesh.triangles.length).toBe(10);
    expect(builtB.caps).toBe(false);
    clearImports();
  });

  it('the extruded prism of a normalised model has radius √(1 + h²), h = 1/2 (§9.1)', () => {
    clearImports();
    const a = normaliseMesh(parseObj(cubeObj()));
    const shape = registerImportedShape('cube', a.mesh, 'extrude', a.report).create();
    expect(shape.radius()).toBeCloseTo(Math.hypot(1, IMPORT_EXTRUDE_HALF_HEIGHT), 12);
    expect(shape.wRange()).toEqual([-IMPORT_EXTRUDE_HALF_HEIGHT, IMPORT_EXTRUDE_HALF_HEIGHT]);
    clearImports();
  });

  it('spin is refused for an open model, and ImportSession demotes it to extrude', async () => {
    clearImports();
    const open = normaliseMesh(parseObj(OPEN_CUBE_OBJ));
    expect(() => registerImportedShape('open', open.mesh, 'spin', open.report)).toThrow(/closed/);
    if (typeof File === 'undefined') return;
    const seen: string[] = [];
    const session = new ImportSession((entry) => seen.push(entry.id));
    session.lifting = 'spin';
    const outcome = await session.load(makeFile(OPEN_CUBE_OBJ, 'open.obj'));
    expect(outcome).not.toBeNull();
    expect(outcome!.lifting).toBe('extrude');
    expect(outcome!.entry.id).toBe(`${IMPORT_ID_PREFIX}open-extrude`);
    expect(outcome!.status).toContain('Spin needs a closed model');
    expect(outcome!.status).toContain('open surfaces');
    expect(session.spinAvailable).toBe(false);
    expect(seen).toEqual([outcome!.entry.id]);
    expect(() => session.setLifting('spin')).toThrow(/closed/);
    clearImports();
  });

  it('an open model is sliced without caps: the lateral surface only, an open surface of the right area', () => {
    clearImports();
    const open = normaliseMesh(parseObj(OPEN_CUBE_OBJ));
    const closed = normaliseMesh(parseObj(cubeObj()));
    const openShape = registerImportedShape('open', open.mesh, 'extrude', open.report).create() as ExtrudedSolid;
    const closedShape = registerImportedShape('closed', closed.mesh, 'extrude', closed.report).create() as ExtrudedSolid;
    expect(openShape.caps).toBe(false);
    expect(closedShape.caps).toBe(true);

    // At w = 0 the slice of S × [−h, h] is S itself: five faces of side s for the
    // open cube (area 5 s², rim length 4 s), six faces and no boundary for the closed one.
    const s = NORMALISED_SIDE;
    const openSlice = openShape.slice(hyperplaneW(0));
    expect(triMeshArea(openSlice)).toBeCloseTo(5 * s * s, 6);
    const rim = boundaryOf(openSlice);
    expect(rim.edges).toBeGreaterThan(0);
    expect(rim.length).toBeCloseTo(4 * s, 6);
    const closedSlice = closedShape.slice(hyperplaneW(0));
    expect(triMeshArea(closedSlice)).toBeCloseTo(6 * s * s, 6);
    expect(boundaryOf(closedSlice).edges).toBe(0);

    // A tilted hyperplane cuts the caps too: with caps the closed cube's slice
    // is closed; the same closed mesh extruded with caps off is open there.
    const h = hyperplaneFromRotation(rotation('XW', 0.6), 0.1);
    expect(boundaryOf(closedShape.slice(h)).edges).toBe(0);
    const noCaps = extrude(closed.mesh, IMPORT_EXTRUDE_HALF_HEIGHT, 'nocaps', { caps: false });
    expect(boundaryOf(noCaps.slice(h)).edges).toBeGreaterThan(0);
    expect(triMeshArea(noCaps.slice(h))).toBeLessThan(triMeshArea(closedShape.slice(h)));
    clearImports();
  });
});

// ---------------------------------------------------------------------------
// Explainer routing: every shape and every Flatland topic has content
// ---------------------------------------------------------------------------

describe('explainer topics follow the active app', () => {
  it('every catalogue shape and the shared import topic have explainer content', () => {
    for (const e of listShapes()) {
      expect(getExplainer(shapeTopic(e.id)), `topic for ${e.id}`).toBeDefined();
    }
    expect(shapeTopic(`${IMPORT_ID_PREFIX}anything-spin`)).toBe('import');
    expect(getExplainer('import')).toBeDefined();
    for (const t of ['intro', 'color', 'view:projection', 'view:slice', 'view:overlay']) {
      expect(getExplainer(t), t).toBeDefined();
    }
  });

  it('every Flatland shape and mode has a flat: topic', () => {
    expect(getExplainer('flat:intro')).toBeDefined();
    expect(getExplainer('flat:rotation')).toBeDefined();
    for (const id of FLAT_SHAPE_IDS) expect(getExplainer(`flat:${id}`), id).toBeDefined();
    for (const mode of FLAT_VIEW_MODES) expect(getExplainer(flatModeTopic(mode)), mode).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// WebXR entry (§12 note): a rigid motion and a uniform scale, nothing else
// ---------------------------------------------------------------------------

describe('WebXR setup without navigator.xr', () => {
  it('touches nothing and returns no button', () => {
    expect(typeof navigator === 'undefined' || !('xr' in navigator) || !navigator.xr).toBe(true);
    const renderer = {
      xr: {
        enabled: false,
        addEventListener: () => { throw new Error('must not subscribe'); },
        getController: () => { throw new Error('must not create controllers'); },
      },
    };
    const scene = { add: () => { throw new Error('must not add to the scene'); } };
    const world = { position: { x: 1 }, scale: { x: 1 } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const xr = setupXR(renderer as any, scene as any, world as any, { getRadius: () => 1 });
    expect(xr.button).toBeNull();
    expect(renderer.xr.enabled).toBe(false);
    expect(() => xr.refit()).not.toThrow();
    expect(() => xr.dispose()).not.toThrow();
    expect(world.position.x).toBe(1);
  });

  it('places the object at arm height in front of the viewer and at 0.7 m across', () => {
    const [x, y, z] = XR_WORLD_POSITION;
    expect(x).toBe(0);
    expect(y).toBeGreaterThan(1);
    expect(y).toBeLessThan(1.8);
    expect(z).toBeLessThan(0); // −z is forward in the XR reference space
    expect(XR_TARGET_RADIUS).toBeGreaterThan(0);
    expect(XR_TARGET_RADIUS).toBeLessThan(1);
  });

  it('projectedExtent (the XR fit radius in projection view) is the analytic perspective maximum', () => {
    // §3.2: a point at |p| = r with fourth coordinate w lands at √(r² − w²) · d/(d − w);
    // d/dw of the log vanishes at w = r²/d, so for r = 2, d = 3: w = 4/3 and the
    // maximum is √(20/9) · 9/5 = 3√20/5 ≈ 2.683, above the orthographic extent r.
    const r = 2, d = 3;
    const exact = Math.sqrt(r * r - (r * r / d) ** 2) * d / (d - r * r / d);
    expect(exact).toBeCloseTo((3 * Math.sqrt(20)) / 5, 12);
    const got = projectedExtent(r, { kind: 'perspective', distance: d });
    expect(got).toBeGreaterThanOrEqual(r);
    expect(Math.abs(got - exact) / exact).toBeLessThan(0.01);
    expect(projectedExtent(r, { kind: 'orthographic' })).toBe(r);
    expect(projectedExtent(r)).toBe(r);
  });
});

// ---------------------------------------------------------------------------
// §9.3: the creature's slice grid, the per-frame cost driver
// ---------------------------------------------------------------------------

describe('MATH.md §9.3: SDF slice cost is a fixed grid of field evaluations', () => {
  it('a slice evaluates the field exactly (n + 1)³ times, and not at all outside the support', () => {
    const scene = creatureScene();
    let calls = 0;
    const counted = (p: Vec4): number => { calls++; return scene.f(p); };
    const n = 40;
    const shape = new SdfShape('counted', { f: counted, radius: scene.radius, wRange: scene.wRange }, { sliceResolution: n });
    shape.slice(hyperplaneW(0));
    expect(calls).toBe((n + 1) ** 3);
    calls = 0;
    shape.slice(hyperplaneW(scene.wRange[1] + 1e-6));
    expect(calls).toBe(0);
  });

  it('the catalogue creature uses the 40-cell slice grid that keeps a slice in the tens of milliseconds', () => {
    const entry = getShape('sdf-creature');
    expect(entry).toBeDefined();
    const catalogue = entry!.create().slice(hyperplaneW(0.1));
    const reference = new SdfShape('ref', creatureScene(), { sliceResolution: 40 }).slice(hyperplaneW(0.1));
    expect(catalogue.indices.length).toBe(reference.indices.length);
    expect(catalogue.positions.length).toBe(reference.positions.length);
    expect(catalogue.indices.length).toBeGreaterThan(0);
  });
});
