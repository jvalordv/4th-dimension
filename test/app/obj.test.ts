import { describe, expect, it } from 'vitest';
import { BoxGeometry, BufferAttribute, BufferGeometry, InterleavedBuffer, InterleavedBufferAttribute } from 'three';
import { boundingSphere, fromBufferGeometry, parseObj } from '../../src/app/obj';
import { box, mesh3Volume, validateMesh3 } from '../../src/geometry/mesh3';
import type { Mesh3 } from '../../src/geometry/mesh3';

/**
 * The cube [−1, 1]³ as an OBJ with quads. Vertex k (1-based) has x = ±1 by
 * bit 0 of k − 1, y by bit 1 pattern below:
 *   1 (−1,−1,−1)  2 (1,−1,−1)  3 (1,1,−1)  4 (−1,1,−1)
 *   5 (−1,−1, 1)  6 (1,−1, 1)  7 (1,1, 1)  8 (−1,1, 1)
 * Each quad is counter-clockwise seen from outside: the normal (b − a) × (c − a)
 * of its first three corners points along the outward axis (e.g. the −z face
 * `1 4 3 2` has (0,2,0) × (2,2,0) = (0,0,−4)).
 */
const CUBE_VERTICES = [
  'v -1 -1 -1', 'v 1 -1 -1', 'v 1 1 -1', 'v -1 1 -1',
  'v -1 -1 1', 'v 1 -1 1', 'v 1 1 1', 'v -1 1 1',
];
const CUBE_QUADS: number[][] = [
  [1, 4, 3, 2], // −z
  [5, 6, 7, 8], // +z
  [1, 2, 6, 5], // −y
  [3, 4, 8, 7], // +y
  [1, 5, 8, 4], // −x
  [2, 3, 7, 6], // +x
];
const CUBE_OBJ = [...CUBE_VERTICES, ...CUBE_QUADS.map((q) => `f ${q.join(' ')}`)].join('\n');

/** Volume 2³ = 8 and the combinatorics of a closed triangulated cube: V = 8, E = 18, F = 12, χ = 2. */
function expectClosedCube(mesh: Mesh3): void {
  expect(mesh.positions.length).toBe(8);
  expect(mesh.triangles.length).toBe(12);
  // All coordinates are ±1, so every term of the divergence-theorem sum is an
  // exact small integer over 6: the volume is 8 up to Float64 rounding of the
  // final division (≈ 1e-15), far below the 1e-12 allowed.
  expect(mesh3Volume(mesh)).toBeCloseTo(8, 12);
  const v = validateMesh3(mesh);
  expect(v.ok).toBe(true);
  expect(v.closed).toBe(true);
  expect(v.consistent).toBe(true);
  expect(v.edgeCount).toBe(18);
  expect(v.euler).toBe(2);
}

describe('parseObj (MATH.md §12)', () => {
  it('reads a cube with quads: 8 vertices, each quad fan-triangulated into 2 (a, b, c), (a, c, d)', () => {
    const mesh = parseObj(CUBE_OBJ);
    expect(mesh.positions[0]).toEqual([-1, -1, -1]);
    expect(mesh.positions[6]).toEqual([1, 1, 1]);
    // Quad (1,4,3,2) → 0-based (0,3,2,1) → (0,3,2), (0,2,1); the winding is kept.
    expect(mesh.triangles.slice(0, 2)).toEqual([[0, 3, 2], [0, 2, 1]]);
    expectClosedCube(mesh);
  });

  it('fan-triangulates an n-gon into n − 2 triangles about its first corner', () => {
    const mesh = parseObj('v 0 0 0\nv 1 0 0\nv 2 1 0\nv 1 2 0\nv 0 1 0\nf 1 2 3 4 5');
    expect(mesh.triangles).toEqual([[0, 1, 2], [0, 2, 3], [0, 3, 4]]);
  });

  it('resolves negative (relative) indices against the vertices defined so far', () => {
    // The same cube, every index written as k − 9 (−1 is the last of the 8 vertices, −8 the first).
    const relative = [...CUBE_VERTICES, ...CUBE_QUADS.map((q) => `f ${q.map((k) => k - 9).join(' ')}`)].join('\n');
    expect(parseObj(relative)).toEqual(parseObj(CUBE_OBJ));
    // Relative to the count at the face's own line: after 3 vertices −1 is index 2, after a 4th it is index 3.
    const mesh = parseObj('v 0 0 0\nv 1 0 0\nv 0 1 0\nf -3 -2 -1\nv 0 0 1\nf -1 -2 -3');
    expect(mesh.triangles).toEqual([[0, 1, 2], [3, 2, 1]]);
  });

  it('accepts the corner forms i, i/t, i//n and i/t/n and uses only i', () => {
    const forms = [
      'f 1 4 3 2',
      'f 5/1 6/2 7/3 8/4',
      'f 1//1 2//1 6//1 5//1',
      'f 3/1/1 4/2/1 8/3/1 7/4/1',
      'f 1//2 5//2 8//2 4//2',
      'f 2/5/9 3/6/9 7/7/9 6/8/9',
    ];
    const text = ['vt 0 0', 'vt 1 0', 'vn 0 0 1', ...CUBE_VERTICES, ...forms].join('\n');
    const mesh = parseObj(text);
    expect(mesh.triangles).toEqual(parseObj(CUBE_OBJ).triangles);
    expectClosedCube(mesh);
  });

  it('ignores comments, blank lines, CRLF endings and every other statement', () => {
    const noisy = [
      '# exported by a modelling tool',
      'mtllib cube.mtl',
      '',
      'o Cube   # trailing comment',
      ...CUBE_VERTICES.map((v) => `${v}   # position`),
      'vn 0 0 1',
      'vt 0.5 0.5',
      'vp 0.1',
      'g front',
      'usemtl red',
      's off',
      'p 1',
      'l 1 2',
      '   ',
      ...CUBE_QUADS.map((q) => `f ${q.join(' ')}`),
      '',
    ].join('\r\n');
    const mesh = parseObj(noisy);
    expect(mesh).toEqual(parseObj(CUBE_OBJ));
    expectClosedCube(mesh);
  });

  it('ignores the homogeneous weight or the colour that may follow a vertex, and reads exponents', () => {
    const mesh = parseObj('v 1e0 -2.5E-1 .5 1.0\nv 1 2 3 0.2 0.4 0.6\nv 0 0 0\nf 1 2 3');
    expect(mesh.positions).toEqual([[1, -0.25, 0.5], [1, 2, 3], [0, 0, 0]]);
  });

  it('joins lines that end with a backslash', () => {
    const mesh = parseObj('v 0 0 0\nv 1 0 0\nv 0 1 0\nv 1 1 0\nf 1 2 \\\n 3 4');
    expect(mesh.triangles).toEqual([[0, 1, 2], [0, 2, 3]]);
  });

  it('keeps vertices that no face uses (normaliseMesh drops them) and returns an empty mesh for no data', () => {
    expect(parseObj('v 1 2 3').positions).toEqual([[1, 2, 3]]);
    expect(parseObj('v 1 2 3').triangles).toEqual([]);
    expect(parseObj('')).toEqual({ positions: [], triangles: [] });
  });

  it('accepts a face that names a vertex defined after it (positive indices are checked at the end)', () => {
    expect(parseObj('f 1 2 3\nv 0 0 0\nv 1 0 0\nv 0 1 0').triangles).toEqual([[0, 1, 2]]);
  });

  it('reports the line of malformed input', () => {
    expect(() => parseObj('v 0 0 0\nv 1 0')).toThrow(/line 2.*vertex/);
    expect(() => parseObj('v 0 0 x')).toThrow(/line 1/);
    expect(() => parseObj('v 0 0 0\nv 1 0 0\nf 1 2')).toThrow(/line 3.*three vertices/);
    expect(() => parseObj('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 0')).toThrow(/line 4.*'0'/);
    expect(() => parseObj('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 a')).toThrow(/line 4/);
    expect(() => parseObj('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 1.5')).toThrow(/line 4/);
    expect(() => parseObj('v 0 0 0\nv 1 0 0\nf -1 -2 -3')).toThrow(/line 3.*before the first vertex/);
    expect(() => parseObj('v 0 0 0\nv 1 0 0\nv 0 1 0\n\nf 1 2 4')).toThrow(/line 5.*out of range.*3 vertices/);
  });
});

describe('fromBufferGeometry (MATH.md §12)', () => {
  it('reads three.js BoxGeometry(2, 2, 2): the 24 seam-split vertices weld to the 8 cube corners, closed, volume 8', () => {
    const geometry = new BoxGeometry(2, 2, 2);
    expect(geometry.getAttribute('position').count).toBe(24); // 4 per face, not shared between faces
    const mesh = fromBufferGeometry(geometry);
    // Three's faces are counter-clockwise seen from outside, so the volume is +8.
    expectClosedCube(mesh);
  });

  it('reads a non-indexed geometry as consecutive triples of vertices', () => {
    const mesh = fromBufferGeometry(new BoxGeometry(2, 2, 2).toNonIndexed());
    expectClosedCube(mesh);
  });

  it('welds by position with tolerance 1e-6 × the bounding radius, whatever the scale', () => {
    // The square [0, s]² as the triangles (A, B, C) and (A', C', D) with
    // A = (0,0), B = (s,0), C = (s,s), D = (0,s) and A', C' the corners A, C
    // moved by `eps` along x. Its bounding radius is s/√2, so the tolerance
    // is 1e-6 s/√2 ≈ 7.1e-7 s: offsets of 1e-8 s weld, offsets of 1e-3 s do not.
    const square = (s: number, eps: number): BufferGeometry => {
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(new Float64Array([
        0, 0, 0, s, 0, 0, s, s, 0,
        eps, 0, 0, s + eps, s, 0, 0, s, 0,
      ]), 3));
      return g;
    };
    for (const s of [1, 1e3, 1e-3]) {
      const welded = fromBufferGeometry(square(s, 1e-8 * s));
      expect(welded.positions.length).toBe(4);
      expect(welded.triangles.length).toBe(2);
      const apart = fromBufferGeometry(square(s, 1e-3 * s));
      expect(apart.positions.length).toBe(6);
    }
  });

  it('drops triangles that collapse in the weld and ignores a trailing partial triangle', () => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0]), 3));
    g.setIndex([0, 1, 2, 1, 3, 4, 0, 1]); // second triangle: vertices 1, 3, 4 are the same point; third is partial
    const mesh = fromBufferGeometry(g);
    expect(mesh.triangles.length).toBe(1);
    expect(mesh.positions.length).toBe(3);
  });

  it('reads interleaved position attributes', () => {
    // Position and a dummy normal interleaved (stride 6): the box corners 8 vertices, 12 triangles.
    const source = box(2, 2, 2);
    const data = new Float32Array(source.positions.length * 6);
    source.positions.forEach((p, i) => data.set([p[0], p[1], p[2], 9, 9, 9], 6 * i));
    const g = new BufferGeometry();
    g.setAttribute('position', new InterleavedBufferAttribute(new InterleavedBuffer(data, 6), 3, 0));
    g.setIndex(source.triangles.flat());
    expectClosedCube(fromBufferGeometry(g));
  });

  it('throws without a position attribute and returns coincident points unwelded (radius 0)', () => {
    expect(() => fromBufferGeometry(new BufferGeometry())).toThrow(/position/);
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array([1, 1, 1, 1, 1, 1, 1, 1, 1]), 3));
    expect(fromBufferGeometry(g).positions.length).toBe(3);
  });
});

describe('boundingSphere', () => {
  it('is the bounding-box centre and the largest distance from it (not from the origin)', () => {
    // Box [0, 4] × [0, 2] × [0, 0]: centre (2, 1, 0); the farthest corner is at √(4 + 1) = √5.
    const { centre, radius } = boundingSphere({
      positions: [[0, 0, 0], [4, 0, 0], [4, 2, 0], [0, 2, 0], [1, 1, 0]],
      triangles: [],
    });
    expect(centre).toEqual([2, 1, 0]);
    expect(radius).toBeCloseTo(Math.sqrt(5), 14);
    expect(boundingSphere({ positions: [], triangles: [] })).toEqual({ centre: [0, 0, 0], radius: 0 });
  });
});
