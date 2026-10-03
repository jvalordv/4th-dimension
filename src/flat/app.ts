/**
 * Flatland mode (MATH.md §11): a 3D solid seen the way 2D creatures would
 * see it, drawn on an HTML canvas. The same two honest views as the 4D
 * viewer, one dimension down:
 *
 * - projection: the solid rotated by M = R_YZ R_XZ R_XY (§2.2 restricted)
 *   and projected to the plane, edges and vertices coloured by z after
 *   rotation over [−R, R] (§10), translucent faces back to front;
 * - slice: the part of the solid in the plane z = c, drawn as filled
 *   polygons (holes by the even–odd rule), coloured by the z of the source
 *   point over the solid's own z extent;
 * - overlay: both, the slice scaled by d / (d − c) under perspective and 1
 *   under orthographic projection.
 *
 * The app owns everything it puts in `root` (one wrapper element, removed by
 * dispose and hidden by hide), its own lil-gui panel and its own animation
 * frame loop, which runs only while shown. Keyboard input is routed in by
 * the host through handleKey.
 */
import './flat.css';
import GUI, { type Controller } from 'lil-gui';
import { FLAT_SHAPE_IDS, type ExplainerPanel, type FlatShapeId } from '../explain';
import { gradientCSS, symmetricWScale, wColorScale } from '../app/colors';
import { drawProjection, drawSheet, drawSlice, planeZField, type Viewport } from './draw';
import {
  compositeRotation3,
  FLAT_PLANES,
  isOutOfPlane,
  planeFromRotation,
  sliceScale2,
  type Vec2,
} from './math';
import { buildModel, type FlatModel } from './model';
import { FLAT_SHAPES } from './shapes';
import { sliceSection } from './slice2';
import {
  advanceFlat,
  clampOffset,
  createFlatState,
  defaultEyeDistance,
  FLAT_PRESETS,
  FLAT_PROJECTION_KINDS,
  FLAT_VIEW_MODES,
  flatModeTopic,
  resetFlat,
  type FlatProjectionKind,
  type FlatState,
  type FlatViewMode,
} from './state';
import { projectedExtent2, projectModel } from './view';

export interface FlatlandApp {
  /** Make the app visible, start its frame loop and show the 'flat:intro' explainer. */
  show(): void;
  /** Hide the app (display: none) and stop its frame loop; state is kept. */
  hide(): void;
  /** Stop, remove everything the app put in `root` and release its listeners. */
  dispose(): void;
  /** Space play/pause, 1/2/3 modes, R reset. True when the key was handled. */
  handleKey(e: KeyboardEvent): boolean;
  /** The live state (read-only view, for the host and for debugging). */
  readonly state: Readonly<FlatState>;
}

const DEFAULT_SHAPE: FlatShapeId = 'cube';

/** The shape's suggested eye distance, or the default for its radius. */
const eyeDistanceOf = (id: FlatShapeId, radius: number): number => FLAT_SHAPES[id].eyeDistance ?? defaultEyeDistance(radius);

const degrees = (rad: number): string => {
  const d = (rad * 180) / Math.PI;
  return `${Math.abs(d) < 0.5 ? '0' : d.toFixed(0)}°`;
};

const signed = (x: number, digits: number): string => `${x < 0 ? '−' : '+'}${Math.abs(x).toFixed(digits)}`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Grid spacing of the Flatland sheet for a scene of the given extent. */
const sheetStep = (extent: number): number => (extent <= 2.5 ? 0.5 : extent <= 6 ? 1 : 2);

interface SliceCache {
  key: string;
  loops: Vec2[][];
  area: number;
}

export function mountFlatland(root: HTMLElement, panel: ExplainerPanel): FlatlandApp {
  const state: FlatState = createFlatState(DEFAULT_SHAPE, 1);
  const models = new Map<FlatShapeId, FlatModel>();
  const modelOf = (id: FlatShapeId): FlatModel => {
    let m = models.get(id);
    if (!m) {
      m = buildModel(FLAT_SHAPES[id].create());
      models.set(id, m);
    }
    return m;
  };
  let model = modelOf(state.shapeId);
  /** Perspective distance of the current shape; kept while orthographic is active. */
  let eyeDistance = eyeDistanceOf(state.shapeId, model.radius);
  state.projection = { kind: 'perspective', distance: eyeDistance };

  // ---- DOM ------------------------------------------------------------------
  const previousPosition = root.style.position;
  if (getComputedStyle(root).position === 'static') root.style.position = 'relative';

  const wrapper = el('div', 'flat-root');
  wrapper.style.display = 'none';
  const stage = el('div', 'flat-stage');
  const canvas = el('canvas', 'flat-canvas');
  const title = el('div', 'flat-title overlay');
  const caption = el('div', 'flat-caption overlay', 'Flatland: a 3D object seen by 2D creatures');
  const status = el('div', 'flat-status overlay mono');
  const legend = el('div', 'flat-legend overlay');
  const guiHost = el('div', 'flat-gui');
  stage.append(canvas, title, caption, status, legend);
  wrapper.append(stage, guiHost);
  root.append(wrapper);

  const ctxOrNull = canvas.getContext('2d');
  if (!ctxOrNull) throw new Error('mountFlatland: canvas 2D context unavailable');
  const ctx: CanvasRenderingContext2D = ctxOrNull;

  // ---- lil-gui panel ----------------------------------------------------------
  const gui = new GUI({ container: guiHost, title: 'Flatland controls', width: 300 });
  /**
   * Controllers that mirror state changed elsewhere (animation, keys). lil-gui's listen() runs its own
   * animation-frame loop, so it is switched on only while the app is shown.
   */
  const live: Controller[] = [];
  const track = <C extends Controller>(c: C): C => { live.push(c); return c; };
  const setListening = (on: boolean): void => { for (const c of live) c.listen(on); };
  const shapeOptions: Record<string, FlatShapeId> = {};
  for (const id of FLAT_SHAPE_IDS) shapeOptions[FLAT_SHAPES[id].label] = id;
  track(gui.add(state, 'shapeId', shapeOptions).name('Shape')).onChange((id: FlatShapeId) => setShape(id));

  const view = gui.addFolder('View');
  track(view.add(state, 'viewMode', FLAT_VIEW_MODES).name('Mode (1 2 3)')).onChange((mode: FlatViewMode) => {
    panel.show(flatModeTopic(mode));
  });
  const params = { projectionKind: state.projection.kind as FlatProjectionKind, distance: eyeDistance };
  view.add(params, 'projectionKind', FLAT_PROJECTION_KINDS).name('Projection').onChange((kind: FlatProjectionKind) => {
    state.projection = kind === 'perspective' ? { kind, distance: eyeDistance } : { kind };
    syncProjectionControls();
  });
  const distanceCtrl = view.add(params, 'distance', 1, 10, 0.01).name('Eye distance d').decimals(2).onChange((d: number) => {
    eyeDistance = d;
    state.projection = { kind: 'perspective', distance: d };
    syncProjectionControls();
  });
  const offsetCtrl = track(view.add(state, 'sliceOffset', -model.radius, model.radius, 0.001).name('Slice offset c').decimals(3));

  const rot = gui.addFolder('Rotation (radians)');
  for (const plane of FLAT_PLANES) {
    track(rot.add(state.angles, plane, -Math.PI, Math.PI, 0.001).decimals(3).name(isOutOfPlane(plane) ? `${plane} · into z` : plane))
      .onChange(() => panel.show('flat:rotation'));
  }

  const anim = gui.addFolder('Animation');
  track(anim.add(state.animation, 'preset', FLAT_PRESETS).name('Preset'));
  track(anim.add(state.animation, 'speed', 0, 3, 0.01).name('Speed ω (rad/s)'));
  track(anim.add(state.animation, 'playing').name('Playing (space)'));
  anim.add({ reset: () => resetFlat(state) }, 'reset').name('Reset angles and offset (R)');

  const syncProjectionControls = (): void => {
    params.projectionKind = state.projection.kind;
    params.distance = eyeDistance;
    const r = model.radius;
    // d must exceed every z (< R) for the eye to be outside the solid, §11.
    distanceCtrl.min(Math.max(1.05 * r, 0.5)).max(Math.max(10, 6 * r));
    distanceCtrl.enable(state.projection.kind === 'perspective');
    gui.controllersRecursive().forEach((c: Controller) => c.updateDisplay());
  };

  // ---- Title, legend ---------------------------------------------------------
  const h1 = el('h1', undefined, 'Flatland');
  const shapeLabel = el('div', 'shape-label');
  const shapeDesc = el('p', 'shape-description');
  title.append(h1, shapeLabel, shapeDesc);

  const legendRows: Array<{ root: HTMLElement; caption: HTMLElement; lo: HTMLElement; hi: HTMLElement }> = [];
  for (let i = 0; i < 2; i++) {
    const row = el('div', 'legend-row');
    const rowCaption = el('div', 'legend-caption');
    const bar = el('div', 'legend-bar');
    bar.style.background = gradientCSS();
    const labels = el('div', 'legend-labels');
    const lo = el('span');
    const hi = el('span');
    labels.append(lo, el('span', undefined, 'z = 0'), hi);
    row.append(rowCaption, bar, labels);
    legend.append(row);
    legendRows.push({ root: row, caption: rowCaption, lo, hi });
  }

  const syncTitle = (): void => {
    shapeLabel.textContent = FLAT_SHAPES[state.shapeId].label;
    shapeDesc.textContent = FLAT_SHAPES[state.shapeId].description;
  };
  const syncLegend = (): void => {
    const r = model.radius;
    const [zmin, zmax] = model.zRange;
    const rows: Array<[string, number, number]> = [];
    if (state.viewMode !== 'slice') rows.push(['shadow: z after rotation', -r, r]);
    if (state.viewMode !== 'projection') rows.push(['slice: z of the source point', zmin, zmax]);
    legendRows.forEach((row, i) => {
      const data = rows[i];
      row.root.classList.toggle('hidden', !data);
      if (!data) return;
      row.caption.textContent = data[0];
      row.lo.textContent = `z = ${signed(data[1], 2)}`;
      row.hi.textContent = `z = ${signed(data[2], 2)}`;
    });
  };

  // ---- State changes -----------------------------------------------------------
  function setShape(id: FlatShapeId): void {
    state.shapeId = id;
    model = modelOf(id);
    eyeDistance = eyeDistanceOf(id, model.radius);
    state.projection = state.projection.kind === 'perspective'
      ? { kind: 'perspective', distance: eyeDistance }
      : { kind: 'orthographic' };
    state.sliceOffset = clampOffset(state.sliceOffset, model.radius);
    offsetCtrl.min(-model.radius).max(model.radius);
    syncProjectionControls();
    syncTitle();
    syncLegend();
    slice = null;
    panel.show('flat:' + id);
  }

  // ---- Frame -----------------------------------------------------------------
  let slice: SliceCache | null = null;
  let lastKey = '';
  let lastStatus = '';
  let raf = 0;
  let visible = false;
  let lastTime = 0;

  const stageSize = (): { width: number; height: number } => {
    const r = stage.getBoundingClientRect();
    return { width: Math.max(1, Math.floor(r.width)), height: Math.max(1, Math.floor(r.height)) };
  };

  const sliceFor = (m: number[]): SliceCache => {
    const key = `${state.shapeId}|${state.angles.XY}|${state.angles.XZ}|${state.angles.YZ}|${state.sliceOffset}`;
    if (slice && slice.key === key) return slice;
    const plane = planeFromRotation(m, state.sliceOffset);
    const loops: Vec2[][] = [];
    let area = 0;
    for (const mesh of model.meshes) {
      const s = sliceSection(mesh, plane);
      loops.push(...s.loops);
      area += s.area;
    }
    slice = { key, loops, area };
    return slice;
  };

  let legendKey = '';

  const render = (): void => {
    // The legend follows the mode and the shape however they were changed (panel, keys, host).
    const nextLegendKey = `${state.viewMode}|${state.shapeId}`;
    if (nextLegendKey !== legendKey) {
      legendKey = nextLegendKey;
      syncLegend();
    }
    const { width, height } = stageSize();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const projKey = state.projection.kind === 'perspective' ? state.projection.distance : 0;
    const key = [
      state.shapeId, state.viewMode, state.angles.XY, state.angles.XZ, state.angles.YZ, state.sliceOffset,
      state.projection.kind, projKey, width, height, dpr,
    ].join('|');
    if (key === lastKey) return;
    lastKey = key;

    const pw = Math.round(width * dpr);
    const ph = Math.round(height * dpr);
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    // The pixel scale is fixed per shape (from the default eye), so changing
    // the eye distance or the projection kind moves the shadow rather than
    // refitting it, as the 4D camera stays put when d changes.
    const extent = projectedExtent2(model.radius, { kind: 'perspective', distance: eyeDistanceOf(state.shapeId, model.radius) });
    const vp: Viewport = { cx: width / 2, cy: height / 2, k: (0.36 * Math.min(width, height)) / extent, width, height };
    const step = sheetStep(extent);
    drawSheet(ctx, vp, Math.ceil((1.25 * extent) / step) * step, step);

    const m = compositeRotation3(state.angles);
    const mode = state.viewMode;
    if (mode !== 'slice') {
      drawProjection(ctx, vp, model, projectModel(model, m, state.projection), symmetricWScale(model.radius), mode === 'overlay' ? 0.4 : 1);
    }
    let sliceText = '';
    if (mode !== 'projection') {
      const s = sliceFor(m);
      const scale = mode === 'overlay' ? sliceScale2(state.projection, state.sliceOffset) : 1;
      drawSlice(ctx, vp, s.loops, planeZField(planeFromRotation(m, state.sliceOffset)), wColorScale([...model.zRange]), scale, model.meshes.length > 1);
      sliceText = s.loops.length > 0 ? `   area ${s.area.toFixed(2)}` : '   empty';
    }
    const angles = FLAT_PLANES.map((p) => `${p} ${degrees(state.angles[p])}`).join('  ');
    const text = `slice z = ${signed(state.sliceOffset, 2)}${sliceText}   |   ${angles}`;
    if (text !== lastStatus) {
      lastStatus = text;
      status.textContent = text;
    }
  };

  const frame = (now: number): void => {
    raf = 0;
    if (!visible) return;
    const dt = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;
    if (state.animation.playing) advanceFlat(state, dt, model.radius);
    render();
    raf = window.requestAnimationFrame(frame);
  };

  const requestRender = (): void => { lastKey = ''; };
  const onResize = (): void => requestRender();
  window.addEventListener('resize', onResize);
  const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null;
  observer?.observe(stage);

  syncProjectionControls();
  syncTitle();
  syncLegend();
  setListening(false);

  // ---- Public API ------------------------------------------------------------
  return {
    state,
    show(): void {
      wrapper.style.display = '';
      visible = true;
      setListening(true);
      requestRender();
      lastTime = performance.now();
      if (!raf) raf = window.requestAnimationFrame(frame);
      panel.show('flat:intro');
    },
    hide(): void {
      visible = false;
      if (raf) window.cancelAnimationFrame(raf);
      raf = 0;
      setListening(false);
      wrapper.style.display = 'none';
    },
    dispose(): void {
      visible = false;
      if (raf) window.cancelAnimationFrame(raf);
      raf = 0;
      window.removeEventListener('resize', onResize);
      observer?.disconnect();
      gui.destroy();
      wrapper.remove();
      root.style.position = previousPosition;
    },
    handleKey(e: KeyboardEvent): boolean {
      if (!visible) return false;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return false;
      if (e.metaKey || e.ctrlKey || e.altKey) return false;
      switch (e.key) {
        case ' ':
          state.animation.playing = !state.animation.playing;
          break;
        case '1':
        case '2':
        case '3': {
          const mode = FLAT_VIEW_MODES[Number(e.key) - 1];
          state.viewMode = mode;
          panel.show(flatModeTopic(mode));
          break;
        }
        case 'r':
        case 'R':
          resetFlat(state);
          break;
        default:
          return false;
      }
      e.preventDefault();
      return true;
    },
  };
}
