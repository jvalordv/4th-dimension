import { describe, expect, it } from 'vitest';
import type { BufferAttribute } from 'three';
import { WireRenderable, edgeIndices, fanTriangulate, writeProjectedWire } from '../../src/render/wire';
import { gradient, symmetricWScale } from '../../src/app/colors';
import { tesseractData } from '../../src/app/placeholder-tesseract';
import { identity4 } from '../../src/math/mat4';
import { rotation } from '../../src/math/rotation';

describe('fanTriangulate (MATH.md §5.3 faces as cycles)', () => {
  it('splits an n-gon into n − 2 triangles from its first vertex', () => {
    expect(Array.from(fanTriangulate([[0, 1, 2, 3]]))).toEqual([0, 1, 2, 0, 2, 3]);
    expect(Array.from(fanTriangulate([[4, 5, 6, 7, 8]]))).toEqual([4, 5, 6, 4, 6, 7, 4, 7, 8]);
    expect(fanTriangulate([[0, 1], [2]]).length).toBe(0);
    // Tesseract: 24 squares → 48 triangles → 144 indices.
    expect(fanTriangulate(tesseractData().wire.faces).length).toBe(144);
  });
  it('edgeIndices flattens pairs', () => {
    expect(Array.from(edgeIndices([[0, 1], [5, 2]]))).toEqual([0, 1, 5, 2]);
  });
});

describe('writeProjectedWire (MATH.md §3, §10)', () => {
  const { wire } = tesseractData();
  const n = wire.positions.length;
  const scale = symmetricWScale(2); // wMax = radius = 2

  it('orthographic, identity: positions are xyz and colours follow the vertex w', () => {
    const pos = new Float32Array(3 * n);
    const col = new Float32Array(3 * n);
    writeProjectedWire(wire, identity4(), { kind: 'orthographic' }, scale, pos, col);
    for (let i = 0; i < n; i++) {
      const p = wire.positions[i];
      expect(pos[3 * i]).toBe(p[0]);
      expect(pos[3 * i + 1]).toBe(p[1]);
      expect(pos[3 * i + 2]).toBe(p[2]);
      // w = ±1 over [−2, 2] is t = 0.75 / 0.25.
      const want = gradient(p[3] > 0 ? 0.75 : 0.25);
      expect(col[3 * i]).toBeCloseTo(want.r, 6);
      expect(col[3 * i + 1]).toBeCloseTo(want.g, 6);
      expect(col[3 * i + 2]).toBeCloseTo(want.b, 6);
    }
  });
  it('perspective d = 3: the w = +1 cell at scale 3/2 and the w = −1 cell at 3/4 (§3.2)', () => {
    const pos = new Float32Array(3 * n);
    const col = new Float32Array(3 * n);
    writeProjectedWire(wire, identity4(), { kind: 'perspective', distance: 3 }, scale, pos, col);
    const iPlus = wire.positions.findIndex((p) => p.every((v) => v === 1)); // (1,1,1,1)
    const iMinus = wire.positions.findIndex((p) => p[0] === 1 && p[1] === 1 && p[2] === 1 && p[3] === -1);
    expect([pos[3 * iPlus], pos[3 * iPlus + 1], pos[3 * iPlus + 2]]).toEqual([1.5, 1.5, 1.5]);
    expect([pos[3 * iMinus], pos[3 * iMinus + 1], pos[3 * iMinus + 2]]).toEqual([0.75, 0.75, 0.75]);
  });
  it('colours use w after rotation: R_XW(π/2) sends x to w (§2.1)', () => {
    // R_XW(π/2): x' = −w, w' = x. So (1,1,1,1) → w' = +1, (−1,1,1,1) → w' = −1.
    const pos = new Float32Array(3 * n);
    const col = new Float32Array(3 * n);
    writeProjectedWire(wire, rotation('XW', Math.PI / 2), { kind: 'orthographic' }, scale, pos, col);
    const a = wire.positions.findIndex((p) => p.every((v) => v === 1));
    const b = wire.positions.findIndex((p) => p[0] === -1 && p[1] === 1 && p[2] === 1 && p[3] === 1);
    const warm = gradient(0.75);
    const cool = gradient(0.25);
    expect(col[3 * a]).toBeCloseTo(warm.r, 6);
    expect(col[3 * a + 2]).toBeCloseTo(warm.b, 6);
    expect(col[3 * b]).toBeCloseTo(cool.r, 6);
    expect(col[3 * b + 2]).toBeCloseTo(cool.b, 6);
    // x' = −w = −1 for both.
    expect(pos[3 * a]).toBeCloseTo(-1, 6);
    expect(pos[3 * b]).toBeCloseTo(-1, 6);
  });
});

describe('WireRenderable', () => {
  it('builds shared attributes with the right counts and updates in place', () => {
    const { wire } = tesseractData();
    const w = new WireRenderable(wire);
    expect(w.vertexCount).toBe(16);
    expect(w.edgeCount).toBe(32);
    expect(w.triangleCount).toBe(48);
    expect(w.edges.geometry.getAttribute('position').count).toBe(16);
    expect(w.edges.geometry.getIndex()?.count).toBe(64);
    expect(w.faces.geometry.getIndex()?.count).toBe(144);
    expect(w.points.geometry.getIndex()).toBeNull();
    expect(w.points.geometry.getAttribute('position')).toBe(w.edges.geometry.getAttribute('position'));
    const posAttr = w.edges.geometry.getAttribute('position') as BufferAttribute;
    const v0 = posAttr.version;
    w.update(identity4(), { kind: 'orthographic' }, symmetricWScale(2));
    expect(posAttr.version).toBe(v0 + 1);
    expect(posAttr.getX(15)).toBe(1); // vertex 15 = (1,1,1,1)
    w.setVisible(false, true, false);
    expect(w.faces.visible).toBe(false);
    expect(w.edges.visible).toBe(true);
    expect(w.points.visible).toBe(false);
    w.setOpacity({ edges: 0.3, faces: 0.1, vertices: 0.2 });
    expect(w.edges.material.opacity).toBe(0.3);
    expect(w.faces.material.transparent).toBe(true);
    expect(() => w.dispose()).not.toThrow();
    expect(w.group.children).toHaveLength(0);
  });
});
