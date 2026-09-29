import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildShell, triBoxOverlap } from '../src/core/voxelize.js';
import { orientationSet } from '../src/core/orientations.js';
import { packModels } from '../src/core/pack.js';
import { meshVolume } from '../src/core/geometry.js';
import { shellSurface } from '../src/core/shellMesh.js';
import { rotationZ, multiply } from '../src/core/orientations.js';

// Axis-aligned box as a non-indexed triangle soup with outward winding.
function boxSoup(sx, sy, sz, ox = 0, oy = 0, oz = 0) {
  const v = [
    [0, 0, 0], [sx, 0, 0], [sx, sy, 0], [0, sy, 0],
    [0, 0, sz], [sx, 0, sz], [sx, sy, sz], [0, sy, sz],
  ].map(([x, y, z]) => [x + ox, y + oy, z + oz]);
  const faces = [
    [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7],
    [0, 1, 5], [0, 5, 4], [2, 3, 7], [2, 7, 6],
    [1, 2, 6], [1, 6, 5], [3, 0, 4], [3, 4, 7],
  ];
  return Float32Array.from(faces.flatMap((f) => f.flatMap((i) => v[i])));
}

// Open-top tray: 30x30 base of height 2 with 2 mm walls up to 12 mm.
function traySoup() {
  const parts = [
    boxSoup(30, 30, 2),
    boxSoup(2, 30, 10, 0, 0, 2),
    boxSoup(2, 30, 10, 28, 0, 2),
    boxSoup(26, 2, 10, 2, 0, 2),
    boxSoup(26, 2, 10, 2, 28, 2),
  ];
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];

function transformedBox(p, soup) {
  const R = p.rotation, T = p.translation;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < soup.length; i += 3) {
    const x = soup[i], y = soup[i + 1], z = soup[i + 2];
    const w = [
      R[0] * x + R[1] * y + R[2] * z + T[0],
      R[3] * x + R[4] * y + R[5] * z + T[1],
      R[6] * x + R[7] * y + R[8] * z + T[2],
    ];
    for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], w[a]); max[a] = Math.max(max[a], w[a]); }
  }
  return { min, max };
}

function gapBetween(a, b) {
  const d = [0, 1, 2].map((k) => Math.max(0, a.min[k] - b.max[k], b.min[k] - a.max[k]));
  return Math.hypot(...d);
}

test('triBoxOverlap detects touching and separated triangles', () => {
  assert.equal(triBoxOverlap(0, 0, 0, 0.5, -1, -1, 0, 1, -1, 0, 0, 1, 0), true);
  assert.equal(triBoxOverlap(0, 0, 0, 0.5, -1, -1, 0.6, 1, -1, 0.6, 0, 1, 0.6), false);
  assert.equal(triBoxOverlap(0, 0, 0, 0.5, 0.5, -1, -1, 0.5, 1, -1, 0.5, 0, 1), true);
});

test('meshVolume of a box', () => {
  assert.ok(Math.abs(meshVolume(boxSoup(10, 20, 5)) - 1000) < 1e-6);
});

test('shell of an aligned cube is exact without gap', () => {
  const s = buildShell(boxSoup(10, 10, 10), I, 1, 0);
  assert.deepEqual([s.nx, s.ny, s.nz], [10, 10, 10]);
  assert.equal(s.cells, 1000);
  assert.equal(s.bottomOffset, 0);
});

test('gap dilates the shell on every side', () => {
  const s = buildShell(boxSoup(10, 10, 10), I, 1, 2);
  assert.deepEqual([s.nx, s.ny, s.nz], [14, 14, 14]);
  assert.equal(s.bottomOffset, 2);
  for (let a = 0; a < 3; a++) assert.ok(Math.abs(s.origin[a] + 2) < 1e-9);
});

test('shell keeps an upward-facing cavity open', () => {
  const s = buildShell(traySoup(), I, 1, 0);
  const centre = 15 * s.nx + 15;
  assert.equal(s.lo[centre], 0);
  assert.equal(s.hi[centre], 1); // only the 2 mm floor
  assert.equal(s.hi[0], 11); // wall column spans the full height
});

test('shell encloses every vertex for a non-axis-aligned rotation', () => {
  const soup = traySoup();
  const R = multiply(rotationZ(33), [1, 0, 0, 0, 0.8, -0.6, 0, 0.6, 0.8]);
  const v = 1.5;
  const s = buildShell(soup, R, v, 0);
  for (let i = 0; i < soup.length; i += 3) {
    const x = soup[i], y = soup[i + 1], z = soup[i + 2];
    const w = [
      R[0] * x + R[1] * y + R[2] * z,
      R[3] * x + R[4] * y + R[5] * z,
      R[6] * x + R[7] * y + R[8] * z,
    ].map((c, a) => (c - s.origin[a]) / v);
    const ci = Math.min(s.nx - 1, Math.floor(w[0]));
    const cj = Math.min(s.ny - 1, Math.floor(w[1]));
    const c = cj * s.nx + ci;
    assert.ok(s.lo[c] >= 0, 'vertex column is empty');
    assert.ok(w[2] >= s.lo[c] - 1e-4 && w[2] <= s.hi[c] + 1 + 1e-4, 'vertex outside its column');
  }
});

test('shell surface is closed and matches the shell volume', () => {
  const s = buildShell(traySoup(), multiply(rotationZ(20), I), 1, 1);
  const surface = shellSurface(s, 1);
  assert.ok(Math.abs(meshVolume(surface) - s.cells) < 1e-6);
});

test('orientation sets have the expected sizes', () => {
  assert.equal(orientationSet('none').length, 1);
  assert.equal(orientationSet('z', 90).length, 4);
  assert.equal(orientationSet('z', 15).length, 24);
  assert.equal(orientationSet('all', 90).length, 24);
});

function prepare(soup, quantity, rotations, settings) {
  return {
    id: 'm',
    quantity,
    volume: meshVolume(soup),
    shells: rotations.map((R) => buildShell(soup, R, settings.voxel, settings.gap)),
  };
}

test('eight cubes fill a 2x2x2 volume exactly', () => {
  const settings = { width: 20, depth: 20, height: 20, margin: 0, voxel: 1, gap: 0, mode: 'volume', maxBins: 1 };
  const rot = orientationSet('none');
  const soup = boxSoup(10, 10, 10);
  const r = packModels([prepare(soup, 8, rot, settings)], rot, settings);
  assert.equal(r.placements.length, 8);
  assert.equal(r.unplaced.length, 0);
  assert.ok(Math.abs(r.bins[0].fill - 1) < 1e-9);
});

test('parts respect the gap, the wall margin and overflow into new bins', () => {
  const settings = { width: 60, depth: 60, height: 40, margin: 3, voxel: 1, gap: 2, mode: 'volume', maxBins: 3 };
  const rot = orientationSet('z', 90);
  const soup = boxSoup(22, 12, 9);
  const r = packModels([prepare(soup, 20, rot, settings)], rot, settings);
  assert.equal(r.placements.length + r.unplaced.length, 20);
  assert.ok(r.bins.length > 1, 'expected overflow into a second bin');
  const boxes = r.placements.map((p) => ({ bin: p.bin, ...transformedBox(p, soup) }));
  for (const b of boxes) {
    for (let a = 0; a < 3; a++) {
      assert.ok(b.min[a] >= 3 - 1e-6, 'inside wall margin (min)');
    }
    assert.ok(b.max[0] <= 57 + 1e-6 && b.max[1] <= 57 + 1e-6 && b.max[2] <= 37 + 1e-6, 'inside wall margin (max)');
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (boxes[i].bin !== boxes[j].bin) continue;
      assert.ok(gapBetween(boxes[i], boxes[j]) >= 2 - 1e-6, `parts ${i} and ${j} closer than the gap`);
    }
  }
});

test('a small part nests inside a tray', () => {
  const settings = { width: 34, depth: 34, height: 14, margin: 0, voxel: 1, gap: 0, mode: 'volume', maxBins: 1 };
  const rot = orientationSet('none');
  const tray = { ...prepare(traySoup(), 1, rot, settings), id: 'tray' };
  const cube = { ...prepare(boxSoup(10, 10, 8), 1, rot, settings), id: 'cube' };
  const r = packModels([tray, cube], rot, settings);
  assert.equal(r.unplaced.length, 0);
  const p = r.placements.find((q) => q.modelId === 'cube');
  const b = transformedBox(p, boxSoup(10, 10, 8));
  assert.ok(Math.abs(b.min[2] - 2) < 1e-6, `cube should rest on the tray floor, got z=${b.min[2]}`);
});

test('bed mode keeps every part on the plate', () => {
  const settings = { width: 50, depth: 50, height: 30, margin: 0, voxel: 1, gap: 1, mode: 'bed', maxBins: 1 };
  const rot = orientationSet('z', 90);
  const soup = boxSoup(20, 10, 25, 5, 5, 7);
  const r = packModels([prepare(soup, 6, rot, settings)], rot, settings);
  assert.equal(r.placements.length, 6);
  for (const p of r.placements) {
    const b = transformedBox(p, soup);
    assert.ok(Math.abs(b.min[2]) < 1e-6, `part not on bed: z=${b.min[2]}`);
  }
});

test('parts larger than the build volume are reported as unplaced', () => {
  const settings = { width: 20, depth: 20, height: 20, margin: 0, voxel: 1, gap: 0, mode: 'volume', maxBins: 2 };
  const rot = orientationSet('none');
  const r = packModels([prepare(boxSoup(30, 5, 5), 1, rot, settings)], rot, settings);
  assert.equal(r.placements.length, 0);
  assert.equal(r.unplaced.length, 1);
  assert.equal(r.bins.length, 0);
});
