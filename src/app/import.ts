/**
 * Importing a 3D model and lifting it into 4D (MATH.md §12, with the liftings
 * of §9). A model arrives as triangles (OBJ or glTF/GLB), is normalised and
 * validated (normaliseMesh), registered as a shape under the 'Imported'
 * group (registerImportedShape) and offered through a small panel with a
 * drop zone (mountImport). The pure steps are separate from the DOM so that
 * they can be tested without a browser.
 */
import './import.css';
import { Matrix4, Vector3 } from 'three';
import type { InstancedMesh, Mesh, Object3D } from 'three';
import type { Vec3 } from '../math/types';
import type { Mesh3, Triangle } from '../geometry/mesh3';
import { flipMesh3, mesh3Volume, scaleMesh3, translateMesh3, validateMesh3, weldMesh3 } from '../geometry/mesh3';
import { extrude } from '../geometry/extrude';
import { spin } from '../geometry/spin';
import { boundingSphere, fromBufferGeometry, parseObj, WELD_TOLERANCE } from './obj';
import { IMPORT_ID_PREFIX, registerShape, unregisterShape } from './registry';
import type { ShapeEntry } from './registry';

/** Half-height of the prism an imported model is extruded into (so the prism spans w ∈ [−1/2, 1/2]). MATH.md §9.1 */
export const IMPORT_EXTRUDE_HALF_HEIGHT = 0.5;

/** Number of angular steps an imported model is spun with. MATH.md §9.2 */
export const IMPORT_SPIN_STEPS = 48;

/**
 * Triangle count above which the status line warns that slicing will be slow.
 * Measured: slicing the extruded model takes about 80 ms at 20 000 triangles
 * and 380 ms at 82 000 (the viewer then rebuilds the slice every few frames),
 * and a spun one about three times that.
 */
export const HEAVY_TRIANGLES = 40_000;

/** What validation found out about an imported model (MATH.md §12). */
export interface ImportReport {
  /** Every edge belongs to exactly two triangles: the surface has no boundary and no non-manifold edge. */
  closed: boolean;
  /** Every shared edge is traversed in opposite directions by its two triangles. */
  consistent: boolean;
  /** Edges that belong to only one triangle: 0 for a closed model, 3 for a cube missing one triangle. */
  boundaryEdges: number;
  /** Triangles of the welded model. */
  triangles: number;
  /**
   * Signed volume by the divergence theorem (§6) of the normalised, possibly
   * flipped mesh, in units of the normalised model (bounding radius 1). It
   * is the volume of the solid for a closed model and positive; for an open
   * one it is only the flux integral over the surface, shown for reference.
   */
  volume: number;
  /** The triangles were reversed because the signed volume was negative (the model was inside out). */
  flipped: boolean;
  /** Factor applied to the centred coordinates, 1 / (bounding radius of the original model). */
  scale: number;
}

/** Drop the vertices no triangle uses, renumbering the rest in order. */
function dropUnusedVertices(mesh: Mesh3): Mesh3 {
  const remap = new Int32Array(mesh.positions.length).fill(-1);
  const positions: Vec3[] = [];
  const triangles: Triangle[] = mesh.triangles.map((t): Triangle => {
    const out: Triangle = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      const v = t[k];
      if (remap[v] < 0) {
        remap[v] = positions.length;
        positions.push(mesh.positions[v]);
      }
      out[k] = remap[v];
    }
    return out;
  });
  return { positions, triangles };
}

/**
 * Normalise a raw model per MATH.md §12 and validate it.
 *
 * 1. Vertices that no triangle uses are dropped, then the mesh is welded by
 *    position (tolerance WELD_TOLERANCE × bounding radius), so that vertices
 *    split along texture or normal seams become one and triangles that
 *    collapse disappear.
 * 2. The bounding-box centre c is moved to the origin and the coordinates are
 *    scaled by 1/ρ, ρ = max |p − c|, so the bounding radius is 1. Winding
 *    is untouched by a positive scale. `report.scale` is 1/ρ.
 * 3. validateMesh3 (the 3D counterpart of §5.2) counts boundary edges and
 *    checks that every shared edge is traversed once in each direction.
 * 4. If the signed volume is negative the triangles are reversed so that the
 *    orientation is outward (counter-clockwise seen from outside, §9), and
 *    `flipped` is set. For a closed, consistent model the sign is exact; for
 *    an open one it is a heuristic (the flux through a nearly closed surface
 *    still has the right sign), and the slice view needs outward winding to
 *    draw its front faces.
 *
 * The input is not modified.
 *
 * @throws Error if no triangle survives or all vertices coincide or are not finite
 */
export function normaliseMesh(mesh: Mesh3): { mesh: Mesh3; report: ImportReport } {
  const used = dropUnusedVertices(mesh);
  const raw = boundingSphere(used);
  if (used.triangles.length === 0) throw new Error('The model contains no triangles');
  if (!(raw.radius > 0) || !Number.isFinite(raw.radius)) {
    throw new Error('The model is degenerate: its vertices coincide or are not finite numbers');
  }
  const welded = dropUnusedVertices(weldMesh3(used, WELD_TOLERANCE * raw.radius));
  if (welded.triangles.length === 0) throw new Error('The model contains no triangles after welding coincident vertices');

  const { centre, radius } = boundingSphere(welded);
  const scale = 1 / radius;
  let out = scaleMesh3(translateMesh3(welded, [-centre[0], -centre[1], -centre[2]]), scale);

  const validation = validateMesh3(out, { allowDegenerate: true });
  let volume = mesh3Volume(out);
  let flipped = false;
  if (volume < 0) {
    out = flipMesh3(out);
    volume = -volume;
    flipped = true;
  }
  return {
    mesh: out,
    report: {
      closed: validation.closed,
      consistent: validation.consistent,
      boundaryEdges: validation.boundaryEdges,
      triangles: out.triangles.length,
      volume,
      flipped,
      scale,
    },
  };
}

// ---- Reading files -----------------------------------------------------------

const point = new Vector3();

/**
 * Collect every visible mesh of a three.js scene graph into one world-space
 * Mesh3: each mesh's geometry read by fromBufferGeometry, its vertices moved
 * by the mesh's world matrix (the equivalent of
 * `geometry.clone().applyMatrix4(mesh.matrixWorld)` after
 * `scene.updateMatrixWorld(true)`, but done on the Float64 mesh so that
 * normalised-integer attributes are not clamped), and the parts concatenated
 * with index offsets. A world matrix with a negative determinant (a mirror)
 * reverses the winding, so that part's triangles are flipped back to keep
 * them outward. Each instance of an InstancedMesh becomes its own copy.
 * Points, lines and skinning are ignored (the rest pose is used).
 */
export function sceneToMesh3(root: Object3D): Mesh3 {
  root.updateMatrixWorld(true);
  const positions: Vec3[] = [];
  const triangles: Triangle[] = [];
  const m = new Matrix4();

  const append = (local: Mesh3, matrix: Matrix4): void => {
    const offset = positions.length;
    for (const p of local.positions) {
      point.set(p[0], p[1], p[2]).applyMatrix4(matrix);
      positions.push([point.x, point.y, point.z]);
    }
    const mirrored = matrix.determinant() < 0;
    for (const [a, b, c] of local.triangles) {
      triangles.push(mirrored ? [a + offset, c + offset, b + offset] : [a + offset, b + offset, c + offset]);
    }
  };

  root.traverseVisible((obj) => {
    const mesh = obj as Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const local = fromBufferGeometry(mesh.geometry);
    const instanced = (obj as InstancedMesh).isInstancedMesh ? (obj as InstancedMesh) : null;
    if (instanced) {
      for (let i = 0; i < instanced.count; i++) {
        instanced.getMatrixAt(i, m);
        append(local, m.premultiply(mesh.matrixWorld));
      }
    } else {
      append(local, mesh.matrixWorld);
    }
  });
  return { positions, triangles };
}

/** Message of whatever a loader rejected with. */
const errorMessage = (e: unknown): string => {
  if (e instanceof Error) return e.message;
  const message = (e as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message ? message : String(e);
};

/**
 * Parse a binary glTF (.glb) or a self-contained glTF (.gltf, buffers and
 * images embedded as data URIs; external files cannot be reached from a
 * single dropped file) with three's GLTFLoader and flatten its scene with
 * sceneToMesh3. The loader is imported on first use, so that it is not part
 * of the initial bundle. Draco and Meshopt compressed files need decoders
 * this loader is not given and are rejected with the loader's message.
 */
async function meshFromGltf(data: ArrayBuffer): Promise<Mesh3> {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const gltf = await new Promise<{ scene: Object3D }>((resolve, reject) => {
    new GLTFLoader().parse(data, '', resolve, (e) => reject(new Error(errorMessage(e))));
  });
  return sceneToMesh3(gltf.scene);
}

/** The file name without its last extension, or the whole name for a name without one. */
const baseName = (fileName: string): string => {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(0, dot) : fileName;
};

/**
 * Read a model file into a raw Mesh3 (coordinates as stored; pass the result
 * through normaliseMesh). `.obj` is read as text with parseObj; `.glb` and
 * `.gltf` go through GLTFLoader and sceneToMesh3. The name is the file's name
 * without the extension.
 *
 * @throws Error for an unsupported extension, an unreadable or malformed
 *   file, or a file without triangles
 */
export async function loadModelFile(file: File): Promise<{ name: string; mesh: Mesh3 }> {
  const lower = file.name.toLowerCase();
  let mesh: Mesh3;
  if (lower.endsWith('.obj')) {
    mesh = parseObj(await file.text());
  } else if (lower.endsWith('.glb') || lower.endsWith('.gltf')) {
    try {
      mesh = await meshFromGltf(await file.arrayBuffer());
    } catch (e) {
      throw new Error(`Cannot read '${file.name}' as glTF: ${errorMessage(e)}`);
    }
  } else {
    const dot = file.name.lastIndexOf('.');
    throw new Error(`Cannot read '${file.name}': ${dot > 0 ? `'${file.name.slice(dot)}' is not a supported type` : 'it has no file extension'} (use .obj, .glb or .gltf)`);
  }
  if (mesh.triangles.length === 0) throw new Error(`'${file.name}' contains no triangles`);
  return { name: baseName(file.name), mesh };
}

// ---- Registering -------------------------------------------------------------

/** The two explicit ways to lift an imported solid into 4D (MATH.md §9: there is no canonical one). */
export type Lifting = 'extrude' | 'spin';

/** `name` as a lowercase ASCII identifier of at most 40 characters ('model' if nothing is left). */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return slug || 'model';
}

/** Whether the report describes a closed, consistently oriented surface: a solid that caps and spin make sense for (§9, §12). */
export const isSolid = (report: ImportReport): boolean => report.closed && report.consistent;

/** The part of a shape description that says whether the model is closed (MATH.md §12). */
export function closednessText(report: ImportReport): string {
  if (isSolid(report)) return 'closed';
  if (report.boundaryEdges > 0) return `open (${report.boundaryEdges} boundary edges; slices are open surfaces)`;
  if (!report.closed) return 'not a valid solid (edges shared by more than two triangles; slices may be open surfaces)';
  return 'not a valid solid (inconsistently oriented triangles; slices may be open surfaces)';
}

/**
 * Register a normalised model as a shape of the 'Imported' group, replacing
 * an earlier import with the same name and lifting, and return its entry.
 *
 * - id: IMPORT_ID_PREFIX + slugify(name) + '-' + lifting;
 * - 'extrude': the prism S × [−1/2, 1/2] (§9.1). The caps are the planar
 *   sections of S and exist only for a closed solid, so they are switched
 *   off for an open model (§12): its slices are open surfaces;
 * - 'spin': the model spun about the plane z = 0 in 48 steps (§9.2), whose
 *   half z ≥ 0 is kept when the model crosses the plane (§9.4). Spin needs a
 *   closed, consistently oriented mesh, so it is refused for anything else.
 *
 * @throws Error when `lifting` is 'spin' and the report does not describe a solid
 */
export function registerImportedShape(name: string, mesh: Mesh3, lifting: Lifting, report: ImportReport): ShapeEntry {
  const solid = isSolid(report);
  if (lifting === 'spin' && !solid) {
    throw new Error(`Spin needs a closed model, but '${name}' is ${closednessText(report)}; extrude it instead`);
  }
  const id = `${IMPORT_ID_PREFIX}${slugify(name)}-${lifting}`;
  unregisterShape(id);
  const entry: ShapeEntry = {
    id,
    label: `${name} (${lifting === 'extrude' ? 'extruded' : 'spun'})`,
    group: 'Imported',
    description: `Imported model ${lifting === 'extrude'
      ? 'extruded along w into a prism (§9.1)'
      : 'spun about the plane z = 0 (§9.2)'}: ${report.triangles} triangles, ${closednessText(report)}.`,
    create: () => (lifting === 'extrude'
      ? extrude(mesh, IMPORT_EXTRUDE_HALF_HEIGHT, name, { caps: solid })
      : spin(mesh, IMPORT_SPIN_STEPS, name)),
  };
  registerShape(entry);
  return entry;
}

/** One line for the status area: size, closedness, volume, whether the winding was reversed, and the scale. */
export function describeReport(name: string, report: ImportReport): string {
  const parts = [`${report.triangles} triangles`, closednessText(report)];
  if (isSolid(report)) parts.push(`volume ${report.volume.toPrecision(3)} (bounding radius 1)`);
  if (report.flipped) parts.push('winding reversed (the model was inside out)');
  parts.push(`scaled by ${report.scale.toPrecision(3)}`);
  return `${name}: ${parts.join(', ')}.`;
}

// ---- Session and panel ---------------------------------------------------------

/** Statement of §9 shown under the lifting choice. */
const LIFTING_NOTE = 'A 3D object has no canonical 4D version (§9): extrude and spin are two explicit choices.';

/** What a load or a change of lifting produced. */
export interface ImportOutcome {
  entry: ShapeEntry;
  report: ImportReport;
  /** The lifting that was registered: 'spin' falls back to 'extrude' for a model that is not closed. */
  lifting: Lifting;
  /** The line for the status area. */
  status: string;
}

/**
 * The state behind the panel, without any DOM: the model read last (kept so
 * the lifting can be changed without reading the file again) and the chosen
 * lifting. Every successful load and every change of lifting registers the
 * shape and calls `onImported(entry, report)`.
 */
export class ImportSession {
  /** The chosen lifting; load() demotes 'spin' to 'extrude' when the model is not closed. */
  lifting: Lifting = 'extrude';
  private model: { name: string; mesh: Mesh3; report: ImportReport } | null = null;
  /** Incremented per load and by cancel(), so that a slow earlier load cannot overwrite a later one. */
  private ticket = 0;

  constructor(private readonly onImported: (entry: ShapeEntry, report: ImportReport) => void) {}

  /** Whether spin can be offered: always before a model is loaded, afterwards only for a closed one. */
  get spinAvailable(): boolean {
    return this.model === null || isSolid(this.model.report);
  }

  /**
   * Read `file`, normalise it, register it with the chosen lifting and
   * announce it.
   *
   * @returns null when a later load (or cancel()) superseded this one, so
   *   that the result and any error of the stale load are dropped
   * @throws Error with a message fit for the user when the file cannot be used
   */
  async load(file: File): Promise<ImportOutcome | null> {
    const mine = ++this.ticket;
    try {
      const raw = await loadModelFile(file);
      const { mesh, report } = normaliseMesh(raw.mesh);
      if (mine !== this.ticket) return null;
      this.model = { name: raw.name, mesh, report };
      let note = '';
      if (this.lifting === 'spin' && !isSolid(report)) {
        this.lifting = 'extrude';
        note = 'Spin needs a closed model, so it is extruded.';
      }
      return this.publish(note);
    } catch (e) {
      if (mine !== this.ticket) return null;
      throw new Error(errorMessage(e));
    }
  }

  /**
   * Choose the lifting and, when a model is loaded, register it with that
   * lifting and announce it; null when there is no model yet.
   *
   * @throws Error when 'spin' is chosen for a model that is not closed
   */
  setLifting(lifting: Lifting): ImportOutcome | null {
    this.lifting = lifting;
    return this.model ? this.publish('') : null;
  }

  /** Make any load in flight resolve with null (used when the panel goes away). */
  cancel(): void {
    this.ticket++;
  }

  private publish(note: string): ImportOutcome {
    if (!this.model) throw new Error('ImportSession: no model loaded');
    const { name, mesh, report } = this.model;
    const entry = registerImportedShape(name, mesh, this.lifting, report);
    this.onImported(entry, report);
    const notes = [note, report.triangles > HEAVY_TRIANGLES ? 'Large model: slices will be slow.' : ''].filter(Boolean);
    return {
      entry,
      report,
      lifting: this.lifting,
      status: [describeReport(name, report), ...notes].join(' '),
    };
  }
}

let panelCount = 0;

/**
 * Mount the import panel into `container`: a drop zone ('Drop an .obj or
 * .glb here', with a file button), the choice between the two liftings with
 * the §9 note, a status line that shows the report after loading, and an
 * error line for unreadable files. After each successful load, and when the
 * lifting is changed afterwards, the model is (re)registered and
 * `onImported(entry, report)` is called so the host can select the shape
 * (see ImportSession).
 *
 * A model that is not closed cannot be spun: spin is disabled for it, and
 * if it was chosen the model is extruded and the status says so.
 */
export function mountImport(
  container: HTMLElement,
  onImported: (entry: ShapeEntry, report: ImportReport) => void,
): { dispose(): void } {
  const groupName = `import-lifting-${panelCount++}`;
  const root = document.createElement('section');
  root.className = 'import-panel';
  root.innerHTML = `
    <h3 class="import-title">Import a 3D model</h3>
    <div class="import-drop">
      <span class="import-drop-text">Drop an .obj or .glb here</span>
      <button type="button" class="import-browse">Choose file</button>
      <input type="file" class="import-input" accept=".obj,.glb,.gltf" hidden>
    </div>
    <fieldset class="import-lifting">
      <legend>Lift into 4D by</legend>
      <label title="The prism S × [−½, ½] (MATH.md §9.1)"><input type="radio" name="${groupName}" value="extrude" checked> Extrude</label>
      <label title="Sweep the half above z = 0 about that plane (MATH.md §9.2); needs a closed model"><input type="radio" name="${groupName}" value="spin"> Spin</label>
    </fieldset>
    <p class="import-note"></p>
    <p class="import-status" role="status" aria-live="polite"></p>
    <p class="import-error" role="alert"></p>`;
  container.appendChild(root);

  const q = <T extends Element>(selector: string): T => {
    const e = root.querySelector<T>(selector);
    if (!e) throw new Error(`import panel: missing ${selector}`);
    return e;
  };
  const drop = q<HTMLElement>('.import-drop');
  const browse = q<HTMLButtonElement>('.import-browse');
  const input = q<HTMLInputElement>('.import-input');
  const status = q<HTMLElement>('.import-status');
  const errorLine = q<HTMLElement>('.import-error');
  const radios = Array.from(root.querySelectorAll<HTMLInputElement>(`input[name="${groupName}"]`));
  const spinRadio = radios.find((r) => r.value === 'spin');
  const extrudeRadio = radios.find((r) => r.value === 'extrude');
  if (!spinRadio || !extrudeRadio) throw new Error('import panel: missing lifting radios');
  q<HTMLElement>('.import-note').textContent = LIFTING_NOTE;

  const session = new ImportSession(onImported);
  let disposed = false;
  let pending = 0;

  const showError = (message: string): void => {
    errorLine.textContent = message;
    root.classList.toggle('has-error', message !== '');
  };
  const show = (outcome: ImportOutcome): void => {
    status.textContent = outcome.status;
    extrudeRadio.checked = outcome.lifting === 'extrude';
    spinRadio.checked = outcome.lifting === 'spin';
    spinRadio.disabled = !session.spinAvailable;
  };

  const load = async (file: File): Promise<void> => {
    showError('');
    status.textContent = `Reading ${file.name}...`;
    pending++;
    root.classList.add('is-busy');
    try {
      const outcome = await session.load(file);
      if (outcome && !disposed) show(outcome);
    } catch (e) {
      if (!disposed) {
        status.textContent = '';
        showError(errorMessage(e));
      }
    } finally {
      pending--;
      if (!disposed && pending === 0) root.classList.remove('is-busy');
    }
  };

  const onBrowse = (): void => input.click();
  const onInput = (): void => {
    const file = input.files?.[0];
    input.value = ''; // so that the same file can be chosen again
    if (file) void load(file);
  };
  const onDragOver = (ev: DragEvent): void => {
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy';
    drop.classList.add('is-dragover');
  };
  const onDragLeave = (): void => drop.classList.remove('is-dragover');
  const onDrop = (ev: DragEvent): void => {
    ev.preventDefault();
    drop.classList.remove('is-dragover');
    const file = ev.dataTransfer?.files[0];
    if (file) void load(file);
  };
  const onLifting = (): void => {
    showError('');
    try {
      const outcome = session.setLifting(spinRadio.checked ? 'spin' : 'extrude');
      if (outcome) show(outcome);
    } catch (e) {
      showError(errorMessage(e));
    }
  };

  browse.addEventListener('click', onBrowse);
  input.addEventListener('change', onInput);
  drop.addEventListener('dragenter', onDragOver);
  drop.addEventListener('dragover', onDragOver);
  drop.addEventListener('dragleave', onDragLeave);
  drop.addEventListener('drop', onDrop);
  for (const r of radios) r.addEventListener('change', onLifting);

  return {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      session.cancel();
      browse.removeEventListener('click', onBrowse);
      input.removeEventListener('change', onInput);
      drop.removeEventListener('dragenter', onDragOver);
      drop.removeEventListener('dragover', onDragOver);
      drop.removeEventListener('dragleave', onDragLeave);
      drop.removeEventListener('drop', onDrop);
      for (const r of radios) r.removeEventListener('change', onLifting);
      root.remove();
    },
  };
}
