// Greedy nesting of column shells into bounded build volumes.
//
// Each build volume is represented by a heightmap over its (x, y) cells. A part
// is "dropped" from above: for a candidate (x, y) its resting height is the
// smallest z at which no shell column intersects the heightmap. Because shell
// columns keep their individual bottoms, parts can settle into upward-facing
// cavities and around neighbours instead of resting on bounding boxes.
//
// Modes:
//   volume - parts may stack anywhere in the volume (SLS / MJF style). The
//            placement with the lowest resulting top is chosen.
//   bed    - every part stands on the build plate (FDM style); shell
//            footprints may not overlap. Placement is bottom-left.

export function containerFor(settings) {
  const { width, depth, height, voxel, margin, mode } = settings;
  const m = Math.max(0, margin);
  const ax = width - 2 * m;
  const ay = depth - 2 * m;
  const az = mode === 'bed' ? height : height - 2 * m;
  return {
    nx: Math.max(0, Math.floor(ax / voxel + 1e-9)),
    ny: Math.max(0, Math.floor(ay / voxel + 1e-9)),
    nz: Math.max(0, Math.floor(az / voxel + 1e-9)),
    origin: [m, m, mode === 'bed' ? 0 : m],
    heightLimit: az,
  };
}

function better(a, b) {
  if (!b) return true;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return false;
}

function findVolume(H, box, shells) {
  const { nx, ny, nz } = box;
  let best = null;
  for (let o = 0; o < shells.length; o++) {
    const s = shells[o];
    if (s.nx > nx || s.ny > ny || s.nz > nz) continue;
    const { ci, cj, clo } = s.cols;
    const n = ci.length;
    for (let y = 0; y + s.ny <= ny; y++) {
      for (let x = 0; x + s.nx <= nx; x++) {
        const limit = best ? Math.min(nz, best.score[0]) : nz;
        let z = 0;
        let ok = true;
        for (let c = 0; c < n; c++) {
          const need = H[(y + cj[c]) * nx + x + ci[c]] - clo[c];
          if (need > z) {
            z = need;
            if (z + s.nz > limit) {
              ok = false;
              break;
            }
          }
        }
        if (!ok) continue;
        const score = [z + s.nz, y + s.ny, x + s.nx, o];
        if (better(score, best && best.score)) best = { o, x, y, z, score };
      }
    }
  }
  return best;
}

function findBed(H, box, shells) {
  const { nx, ny } = box;
  let best = null;
  for (let o = 0; o < shells.length; o++) {
    const s = shells[o];
    if (s.nx > nx || s.ny > ny || s.size[2] > box.heightLimit + 1e-9) continue;
    const { ci, cj } = s.cols;
    const n = ci.length;
    let found = false;
    for (let y = 0; y + s.ny <= ny && !found; y++) {
      if (best && y + s.ny > best.score[0]) break;
      for (let x = 0; x + s.nx <= nx; x++) {
        if (best && y + s.ny === best.score[0] && x + s.nx >= best.score[1]) break;
        let ok = true;
        for (let c = 0; c < n; c++) {
          if (H[(y + cj[c]) * nx + x + ci[c]] !== 0) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
        const score = [y + s.ny, x + s.nx, o];
        if (better(score, best && best.score)) best = { o, x, y, z: -s.bottomOffset, score };
        found = true;
        break;
      }
    }
  }
  return best;
}

function place(H, box, s, spot, mode) {
  const { ci, cj, chi } = s.cols;
  for (let c = 0; c < ci.length; c++) {
    const idx = (spot.y + cj[c]) * box.nx + spot.x + ci[c];
    const top = mode === 'bed' ? 1 : spot.z + chi[c] + 1;
    if (top > H[idx]) H[idx] = top;
  }
}

/**
 * @param {Array<{id: *, quantity: number, volume: number, shells: object[]}>} models
 *   `shells[k]` is the shell of the model in orientation `rotations[k]`.
 * @param {number[][]} rotations Row-major 3x3 matrices, one per orientation.
 * @param {object} settings width, depth, height, margin, voxel, mode, maxBins.
 * @param {(done: number, total: number) => void} [onProgress]
 */
export function packModels(models, rotations, settings, onProgress) {
  const box = containerFor(settings);
  const mode = settings.mode === 'bed' ? 'bed' : 'volume';
  const maxBins = Math.max(1, settings.maxBins || 1);
  const v = settings.voxel;

  const items = [];
  for (const m of models) {
    const key = mode === 'bed'
      ? Math.min(...m.shells.map((s) => s.footprint))
      : Math.min(...m.shells.map((s) => s.cells));
    for (let copy = 0; copy < m.quantity; copy++) items.push({ model: m, copy, key });
  }
  items.sort((a, b) => b.key - a.key);

  const bins = [];
  const placements = [];
  const unplaced = [];
  const find = mode === 'bed' ? findBed : findVolume;

  items.forEach((item, n) => {
    const shells = item.model.shells;
    let spot = null;
    let binIndex = -1;
    for (let b = 0; b < bins.length && !spot; b++) {
      spot = find(bins[b].H, box, shells);
      if (spot) binIndex = b;
    }
    if (!spot && bins.length < maxBins) {
      const H = new Int32Array(box.nx * box.ny);
      spot = find(H, box, shells);
      if (spot) {
        bins.push({ H, volume: 0, count: 0 });
        binIndex = bins.length - 1;
      }
    }
    if (!spot) {
      unplaced.push({ modelId: item.model.id, copy: item.copy });
    } else {
      const s = shells[spot.o];
      const bin = bins[binIndex];
      place(bin.H, box, s, spot, mode);
      bin.volume += item.model.volume;
      bin.count += 1;
      const shellOffset = [
        box.origin[0] + spot.x * v,
        box.origin[1] + spot.y * v,
        box.origin[2] + spot.z * v,
      ];
      placements.push({
        modelId: item.model.id,
        copy: item.copy,
        bin: binIndex,
        orientation: spot.o,
        cell: [spot.x, spot.y, spot.z],
        rotation: rotations[spot.o],
        // world = rotation * p + translation
        translation: [
          shellOffset[0] - s.origin[0],
          shellOffset[1] - s.origin[1],
          shellOffset[2] - s.origin[2],
        ],
        shellOffset,
      });
    }
    if (onProgress) onProgress(n + 1, items.length);
  });

  const binVolume = settings.width * settings.depth * settings.height;
  const binStats = bins.map((bin) => {
    let maxH = 0;
    let covered = 0;
    for (let i = 0; i < bin.H.length; i++) {
      if (bin.H[i] > maxH) maxH = bin.H[i];
      if (bin.H[i] > 0) covered++;
    }
    const usedHeight = mode === 'bed' ? null : Math.min(settings.height, box.origin[2] + maxH * v);
    return {
      count: bin.count,
      partVolume: bin.volume,
      fill: bin.volume / binVolume,
      usedHeight,
      densityInUsedHeight: usedHeight ? bin.volume / (settings.width * settings.depth * usedHeight) : null,
      bedCoverage: (covered * v * v) / (settings.width * settings.depth),
    };
  });

  return { placements, unplaced, bins: binStats, container: box, total: items.length };
}
