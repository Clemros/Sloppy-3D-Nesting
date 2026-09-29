import { buildShell } from './core/voxelize.js';
import { orientationSet } from './core/orientations.js';
import { packModels } from './core/pack.js';

self.onmessage = (event) => {
  const { models, settings } = event.data;
  try {
    const rotations = orientationSet(settings.rotation, settings.zStep);
    const totalShells = models.length * rotations.length;
    let doneShells = 0;
    let lastPost = 0;
    const progress = (phase, done, total) => {
      const now = Date.now();
      if (done === total || now - lastPost > 50) {
        lastPost = now;
        self.postMessage({ type: 'progress', phase, done, total });
      }
    };

    const prepared = models.map((m) => ({
      id: m.id,
      quantity: m.quantity,
      volume: m.volume,
      shells: rotations.map((R) => {
        const shell = buildShell(m.positions, R, settings.voxel, settings.gap);
        progress('Building shells', ++doneShells, totalShells);
        return shell;
      }),
    }));

    const result = packModels(prepared, rotations, settings, (d, t) => progress('Packing', d, t));

    // Ship only the shells that are actually used, for visualisation.
    const shells = {};
    const transfer = [];
    for (const p of result.placements) {
      const key = `${p.modelId}:${p.orientation}`;
      if (shells[key]) continue;
      const s = prepared.find((m) => m.id === p.modelId).shells[p.orientation];
      shells[key] = { nx: s.nx, ny: s.ny, nz: s.nz, lo: s.lo, hi: s.hi, cells: s.cells };
      transfer.push(s.lo.buffer, s.hi.buffer);
    }
    self.postMessage({ type: 'done', result: { ...result, shells, orientations: rotations.length } }, transfer);
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message || String(err) });
  }
};
