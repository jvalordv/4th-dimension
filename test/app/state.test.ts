import { describe, expect, it } from 'vitest';
import '../../src/app/shapes';
import {
  ShapeCache,
  StateStore,
  clampSliceOffset,
  createState,
  defaultProjectionDistance,
  defaultShapeId,
  type StateChange,
} from '../../src/app/state';
import { getShape } from '../../src/app/registry';

describe('defaults', () => {
  it('perspective distance is max(3, 2.5 R)', () => {
    expect(defaultProjectionDistance(1)).toBe(3);
    expect(defaultProjectionDistance(1.2)).toBeCloseTo(3, 12); // 2.5 · 1.2 = 3 exactly
    expect(defaultProjectionDistance(2)).toBe(5);
    expect(defaultProjectionDistance(0.5)).toBe(3);
  });
  it('slice offset is clamped to [−R, R]', () => {
    expect(clampSliceOffset(0.5, 2)).toBe(0.5);
    expect(clampSliceOffset(3, 2)).toBe(2);
    expect(clampSliceOffset(-3, 2)).toBe(-2);
  });
  it('createState starts at zero angles, offset 0, perspective view', () => {
    const s = createState('tesseract', 2);
    expect(s.angles).toEqual({ XY: 0, XZ: 0, XW: 0, YZ: 0, YW: 0, ZW: 0 });
    expect(s.sliceOffset).toBe(0);
    expect(s.viewMode).toBe('projection');
    expect(s.projection).toEqual({ kind: 'perspective', distance: 5 });
    expect(s.showFaces && s.showEdges && s.showVertices).toBe(true);
  });
  it('the placeholder registration makes tesseract the default shape', () => {
    expect(defaultShapeId()).toBe('tesseract');
    expect(getShape('tesseract')?.group).toBe('Regular polytopes');
  });
});

describe('ShapeCache', () => {
  it('creates each shape once and rejects unknown ids', () => {
    const cache = new ShapeCache();
    const a = cache.get('tesseract');
    expect(cache.get('tesseract')).toBe(a);
    expect(cache.has('tesseract')).toBe(true);
    expect(() => cache.get('no-such-shape')).toThrow(/unknown shape id/);
  });
});

describe('StateStore', () => {
  it('initialises from the registry entry: tesseract radius 2, textbook eye distance 3 (MATH.md §3.2)', () => {
    const store = new StateStore('tesseract');
    // |(1,1,1,1)| = 2 (§8: vertices (±1, ±1, ±1, ±1)).
    expect(store.radius).toBe(2);
    expect(store.entry.projectionDistance).toBe(3);
    expect(store.state.projection).toEqual({ kind: 'perspective', distance: 3 });
    expect(store.perspectiveDistance).toBe(3);
  });
  it('clamps the slice offset to the radius', () => {
    const store = new StateStore('tesseract');
    store.setSliceOffset(5);
    expect(store.state.sliceOffset).toBe(2);
    store.setSliceOffset(-0.5);
    expect(store.state.sliceOffset).toBe(-0.5);
  });
  it('remembers the perspective distance across projection kinds', () => {
    const store = new StateStore('tesseract');
    store.setPerspectiveDistance(4.5);
    expect(store.state.projection).toEqual({ kind: 'perspective', distance: 4.5 });
    store.setProjectionKind('orthographic');
    expect(store.state.projection).toEqual({ kind: 'orthographic' });
    expect(store.perspectiveDistance).toBe(4.5);
    store.setProjectionKind('perspective');
    expect(store.state.projection).toEqual({ kind: 'perspective', distance: 4.5 });
    expect(() => store.setPerspectiveDistance(0)).toThrow();
  });
  it('reset zeroes angles, offset and phase and notifies', () => {
    const store = new StateStore('tesseract');
    const seen: StateChange[] = [];
    const off = store.subscribe((c) => seen.push(c));
    store.setAngle('XW', 1.1);
    store.setSliceOffset(0.7);
    store.state.animation.phase = 3;
    store.reset();
    expect(store.state.angles.XW).toBe(0);
    expect(store.state.sliceOffset).toBe(0);
    expect(store.state.animation.phase).toBe(0);
    expect(seen).toEqual(['angles', 'sliceOffset', 'reset']);
    off();
    store.setViewMode('slice');
    expect(seen).toHaveLength(3);
    expect(store.state.viewMode).toBe('slice');
  });
  it('setShape keeps angles, clamps the offset and reuses the cached instance', () => {
    const store = new StateStore('tesseract');
    const before = store.shape;
    store.setAngle('XY', 0.3);
    store.state.sliceOffset = 10;
    store.setShape('tesseract');
    expect(store.shape).toBe(before);
    expect(store.state.angles.XY).toBe(0.3);
    expect(store.state.sliceOffset).toBe(2);
    expect(() => store.setShape('nope')).toThrow();
  });
  it('play / pause toggles and animation setters notify', () => {
    const store = new StateStore('tesseract');
    const seen: StateChange[] = [];
    store.subscribe((c) => seen.push(c));
    const was = store.state.animation.playing;
    store.togglePlaying();
    expect(store.state.animation.playing).toBe(!was);
    store.setPreset('tumble');
    store.setSpeed(-1);
    expect(store.state.animation.speed).toBe(0);
    store.setDisplay('showFaces', false);
    expect(store.state.showFaces).toBe(false);
    expect(seen).toEqual(['animation', 'animation', 'animation', 'display']);
  });
});
