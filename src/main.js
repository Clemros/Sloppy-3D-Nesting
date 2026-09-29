import './style.css';
import * as THREE from 'three';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { Viewer, placementMatrix } from './viewer.js';
import { loadModelFile } from './loaders.js';
import { sampleParts } from './samples.js';
import { meshVolume } from './core/geometry.js';
import { orientationSet } from './core/orientations.js';

const $ = (id) => document.getElementById(id);

const state = {
  models: [],
  nextId: 1,
  result: null,
  resultSettings: null,
  worker: null,
};

const viewer = new Viewer($('viewport'));

// ---------------------------------------------------------------- settings

const numberInputs = ['width', 'depth', 'height', 'margin', 'maxBins', 'voxel', 'gap'];

function readSettings() {
  const num = (id, fallback) => {
    const v = parseFloat($(id).value);
    return Number.isFinite(v) ? v : fallback;
  };
  return {
    width: Math.max(1, num('width', 250)),
    depth: Math.max(1, num('depth', 210)),
    height: Math.max(1, num('height', 220)),
    margin: Math.max(0, num('margin', 0)),
    maxBins: Math.max(1, Math.round(num('maxBins', 1))),
    voxel: Math.max(0.1, num('voxel', 2)),
    gap: Math.max(0, num('gap', 0)),
    mode: $('mode').value,
    rotation: $('rotation').value,
    zStep: parseFloat($('zStep').value),
  };
}

function onSettingsChanged() {
  $('zStep').disabled = $('rotation').value === 'none';
  markStale();
  if (!state.result) viewer.clearResult(readSettings());
}

$('preset').addEventListener('change', (e) => {
  if (e.target.value === 'custom') return;
  const [w, d, h] = e.target.value.split(',');
  $('width').value = w;
  $('depth').value = d;
  $('height').value = h;
  onSettingsChanged();
});
for (const id of numberInputs) {
  $(id).addEventListener('input', () => {
    if (['width', 'depth', 'height'].includes(id)) $('preset').value = 'custom';
    onSettingsChanged();
  });
}
for (const id of ['mode', 'rotation', 'zStep']) $(id).addEventListener('change', onSettingsChanged);

// ------------------------------------------------------------------ models

function colorFor(id) {
  return new THREE.Color().setHSL(((id * 137.508) % 360) / 360, 0.6, 0.55);
}

function addModel(name, geometry, quantity = 1) {
  const id = state.nextId++;
  state.models.push({
    id,
    name,
    geometry,
    quantity,
    color: colorFor(id),
    volume: meshVolume(geometry.getAttribute('position').array),
  });
}

function rotateModel(model, axis) {
  const g = model.geometry;
  if (axis === 'x') g.rotateX(Math.PI / 2);
  else g.rotateY(Math.PI / 2);
  g.computeBoundingBox();
  const b = g.boundingBox;
  g.translate(-(b.min.x + b.max.x) / 2, -(b.min.y + b.max.y) / 2, -b.min.z);
  g.computeVertexNormals();
  g.computeBoundingBox();
}

const fmt = (v, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString('en-US');

function renderModelList() {
  const list = $('model-list');
  list.replaceChildren();
  $('model-empty').hidden = state.models.length > 0;
  for (const m of state.models) {
    const size = new THREE.Vector3();
    m.geometry.boundingBox.getSize(size);
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="swatch" style="background:#${m.color.getHexString()}"></span>
      <span class="name"></span>
      <button type="button" data-act="remove" title="Remove">✕</button>
      <span class="dims">${fmt(size.x)} × ${fmt(size.y)} × ${fmt(size.z)} mm · ${fmt(m.volume / 1000, 2)} cm³</span>
      <span class="model-controls">
        <label>Qty <input type="number" min="0" max="999" step="1" value="${m.quantity}" /></label>
        <span class="spacer"></span>
        <button type="button" data-act="x" title="Rotate 90° about X">⟲ X</button>
        <button type="button" data-act="y" title="Rotate 90° about Y">⟲ Y</button>
      </span>`;
    li.querySelector('.name').textContent = m.name;
    li.querySelector('.name').title = m.name;
    li.querySelector('input').addEventListener('input', (e) => {
      const q = parseInt(e.target.value, 10);
      m.quantity = Number.isFinite(q) ? Math.max(0, Math.min(999, q)) : 0;
      markStale();
    });
    li.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        const act = btn.dataset.act;
        if (act === 'remove') {
          state.models = state.models.filter((x) => x !== m);
        } else {
          rotateModel(m, act);
        }
        renderModelList();
        markStale();
      });
    });
    list.appendChild(li);
  }
  $('pack').disabled = state.models.length === 0;
}

async function addFiles(files) {
  const errors = [];
  for (const file of files) {
    try {
      const geometry = await loadModelFile(file);
      addModel(file.name.replace(/\.[^.]+$/, ''), geometry);
    } catch (err) {
      errors.push(`${file.name}: ${err.message}`);
    }
  }
  renderModelList();
  markStale();
  if (errors.length) alert(`Some files could not be loaded:\n${errors.join('\n')}`);
}

$('file').addEventListener('change', (e) => {
  addFiles([...e.target.files]);
  e.target.value = '';
});
const drop = $('drop');
for (const target of [drop, $('viewport')]) {
  target.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
  target.addEventListener('dragleave', () => drop.classList.remove('over'));
  target.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    addFiles([...e.dataTransfer.files]);
  });
}

$('samples').addEventListener('click', () => {
  for (const p of sampleParts()) addModel(p.name, p.geometry, p.quantity);
  renderModelList();
  markStale();
});

$('clear').addEventListener('click', () => {
  state.models = [];
  state.result = null;
  renderModelList();
  $('results').hidden = true;
  $('overlay').hidden = false;
  viewer.clearResult(readSettings());
});

// ----------------------------------------------------------------- packing

function markStale() {
  if (state.result) $('stale').hidden = false;
}

function setProgress(label, fraction) {
  $('progress').hidden = false;
  $('progress-label').textContent = label;
  $('progress-bar').value = fraction;
}

function runPack() {
  const settings = readSettings();
  const models = state.models.filter((m) => m.quantity > 0);
  if (models.length === 0) return;

  const orientations = orientationSet(settings.rotation, settings.zStep).length;
  if (state.worker) state.worker.terminate();
  const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  state.worker = worker;
  $('pack').textContent = 'Cancel';
  setProgress(`Building shells (${orientations} orientation${orientations > 1 ? 's' : ''} per model)…`, 0);

  const started = performance.now();
  worker.onmessage = (e) => {
    const msg = e.data;
    if (msg.type === 'progress') {
      setProgress(`${msg.phase}… ${msg.done} / ${msg.total}`, msg.done / msg.total);
      return;
    }
    finishWorker();
    if (msg.type === 'error') {
      alert(`Packing failed: ${msg.message}`);
      return;
    }
    state.result = msg.result;
    state.resultSettings = settings;
    state.result.elapsed = (performance.now() - started) / 1000;
    showResult();
  };
  worker.onerror = (e) => {
    finishWorker();
    alert(`Packing failed: ${e.message}`);
  };
  worker.postMessage({
    settings,
    models: models.map((m) => ({
      id: m.id,
      quantity: m.quantity,
      volume: m.volume,
      positions: m.geometry.getAttribute('position').array,
    })),
  });
}

function finishWorker() {
  if (state.worker) state.worker.terminate();
  state.worker = null;
  $('pack').textContent = 'Pack';
  $('progress').hidden = true;
}

$('pack').addEventListener('click', () => {
  if (state.worker) finishWorker();
  else runPack();
});

// ----------------------------------------------------------------- results

function modelMap() {
  return new Map(state.models.map((m) => [m.id, m]));
}

function showResult() {
  const r = state.result;
  const s = state.resultSettings;
  const models = modelMap();
  viewer.showResult(r, models, s);
  viewer.setPartsVisible($('showParts').checked);
  viewer.setShellsVisible($('showShells').checked);
  $('overlay').hidden = r.placements.length > 0;
  $('results').hidden = false;
  $('stale').hidden = true;

  const pct = (x) => `${fmt(x * 100)} %`;
  const rows = r.bins
    .map((b, i) => {
      const extra = s.mode === 'bed'
        ? `<td>${pct(b.bedCoverage)}</td>`
        : `<td>${fmt(b.usedHeight)} mm</td><td>${pct(b.densityInUsedHeight)}</td>`;
      return `<tr><td>#${i + 1}</td><td>${b.count}</td><td>${pct(b.fill)}</td>${extra}</tr>`;
    })
    .join('');
  const head = s.mode === 'bed'
    ? '<th>Bed covered¹</th>'
    : '<th>Used height</th><th>Density²</th>';

  const missing = new Map();
  for (const u of r.unplaced) missing.set(u.modelId, (missing.get(u.modelId) || 0) + 1);
  const missingList = [...missing]
    .map(([id, n]) => `${models.get(id)?.name ?? id} × ${n}`)
    .join(', ');

  $('summary').innerHTML = `
    <p>${r.placements.length} of ${r.total} parts placed in ${r.bins.length} build volume${r.bins.length === 1 ? '' : 's'}
      <span class="hint">(${r.orientations} orientation${r.orientations === 1 ? '' : 's'}, ${fmt(r.elapsed, 1)} s)</span></p>
    ${missing.size ? `<p class="warn">Not placed: ${escapeHtml(missingList)}. Increase the build volumes or reduce the gap/tolerance.</p>` : ''}
    ${r.bins.length ? `<table class="stats"><tr><th>Volume</th><th>Parts</th><th>Fill</th>${head}</tr>${rows}</table>` : ''}
    <p class="hint">Fill = part volume / build volume. ${s.mode === 'bed'
      ? '¹ Area covered by shell footprints, including the gap.'
      : '² Part volume / (width × depth × used height).'}</p>`;

  const exports = $('exports');
  exports.replaceChildren();
  r.bins.forEach((_, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = `STL volume #${i + 1}`;
    btn.addEventListener('click', () => exportBin(i));
    exports.appendChild(btn);
  });
  if (r.placements.length) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Layout JSON';
    btn.addEventListener('click', exportLayout);
    exports.appendChild(btn);
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function download(data, filename, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportBin(index) {
  const models = modelMap();
  const group = new THREE.Group();
  for (const p of state.result.placements) {
    if (p.bin !== index) continue;
    const m = models.get(p.modelId);
    if (!m) continue;
    const mesh = new THREE.Mesh(m.geometry);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(placementMatrix(p));
    group.add(mesh);
  }
  group.updateMatrixWorld(true);
  const data = new STLExporter().parse(group, { binary: true });
  download(data, `nesting-volume-${index + 1}.stl`, 'model/stl');
}

function exportLayout() {
  const models = modelMap();
  const s = state.resultSettings;
  const layout = {
    buildVolume: { width: s.width, depth: s.depth, height: s.height, margin: s.margin },
    settings: { mode: s.mode, voxel: s.voxel, gap: s.gap, rotation: s.rotation, zStep: s.zStep },
    note: 'world = rotation (row-major 3x3) * modelPoint + translation, in mm; model points are centred in X/Y with min Z = 0 as shown in the app.',
    placements: state.result.placements.map((p) => ({
      model: models.get(p.modelId)?.name,
      copy: p.copy + 1,
      volume: p.bin + 1,
      rotation: p.rotation,
      translation: p.translation.map((x) => Math.round(x * 1e4) / 1e4),
    })),
    unplaced: state.result.unplaced.map((u) => ({ model: models.get(u.modelId)?.name, copy: u.copy + 1 })),
  };
  download(JSON.stringify(layout, null, 2), 'nesting-layout.json', 'application/json');
}

$('showParts').addEventListener('change', (e) => viewer.setPartsVisible(e.target.checked));
$('showShells').addEventListener('change', (e) => viewer.setShellsVisible(e.target.checked));

// -------------------------------------------------------------------- init

renderModelList();
onSettingsChanged();
viewer.fit(readSettings());
