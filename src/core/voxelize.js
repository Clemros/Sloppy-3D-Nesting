// Shell generation: turns a triangle soup into a simplified "column shell".
//
// The part is voxelised on a grid whose cell size equals the tolerance. For
// every vertical (x, y) column only the lowest and highest occupied voxel are
// kept, so the shell is a conservative envelope: it always contains the real
// surface and overestimates it by at most one voxel per axis. Cavities that
// open upwards (cups, trays) are preserved because the column top is the
// highest surface voxel of that column.
//
// The shell is then dilated by half the requested part gap, so two shells that
// do not overlap guarantee at least `gap` between the real parts.

const EPS = 1e-7;
// Faces lying exactly on a voxel boundary are nudged towards the solid side
// (against the outward normal) and tested against a very slightly shrunken
// cell, so they are attributed to one voxel instead of both neighbours.
const INWARD = 1e-5;
const BOX_HALF = 0.5 - 1e-6;

export function rotatePositions(positions, R) {
  const out = new Float64Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    out[i] = R[0] * x + R[1] * y + R[2] * z;
    out[i + 1] = R[3] * x + R[4] * y + R[5] * z;
    out[i + 2] = R[6] * x + R[7] * y + R[8] * z;
  }
  return out;
}

function axisOverlap(ax, ay, az, x0, y0, z0, x1, y1, z1, x2, y2, z2, h) {
  const p0 = ax * x0 + ay * y0 + az * z0;
  const p1 = ax * x1 + ay * y1 + az * z1;
  const p2 = ax * x2 + ay * y2 + az * z2;
  const rad = h * (Math.abs(ax) + Math.abs(ay) + Math.abs(az));
  return !(Math.min(p0, p1, p2) > rad || Math.max(p0, p1, p2) < -rad);
}

// Separating-axis test between a triangle and an axis-aligned cube with centre
// (cx, cy, cz) and half size h (Akenine-Möller).
export function triBoxOverlap(cx, cy, cz, h, ax, ay, az, bx, by, bz, qx, qy, qz) {
  const x0 = ax - cx, y0 = ay - cy, z0 = az - cz;
  const x1 = bx - cx, y1 = by - cy, z1 = bz - cz;
  const x2 = qx - cx, y2 = qy - cy, z2 = qz - cz;

  if (Math.min(x0, x1, x2) > h || Math.max(x0, x1, x2) < -h) return false;
  if (Math.min(y0, y1, y2) > h || Math.max(y0, y1, y2) < -h) return false;
  if (Math.min(z0, z1, z2) > h || Math.max(z0, z1, z2) < -h) return false;

  const edges = [
    x1 - x0, y1 - y0, z1 - z0,
    x2 - x1, y2 - y1, z2 - z1,
    x0 - x2, y0 - y2, z0 - z2,
  ];
  for (let e = 0; e < 9; e += 3) {
    const ex = edges[e], ey = edges[e + 1], ez = edges[e + 2];
    if (!axisOverlap(0, -ez, ey, x0, y0, z0, x1, y1, z1, x2, y2, z2, h)) return false;
    if (!axisOverlap(ez, 0, -ex, x0, y0, z0, x1, y1, z1, x2, y2, z2, h)) return false;
    if (!axisOverlap(-ey, ex, 0, x0, y0, z0, x1, y1, z1, x2, y2, z2, h)) return false;
  }

  const nx = edges[1] * edges[5] - edges[2] * edges[4];
  const ny = edges[2] * edges[3] - edges[0] * edges[5];
  const nz = edges[0] * edges[4] - edges[1] * edges[3];
  const d = nx * x0 + ny * y0 + nz * z0;
  return Math.abs(d) <= h * (Math.abs(nx) + Math.abs(ny) + Math.abs(nz));
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Builds the column shell of a mesh in a given orientation.
 *
 * @param {Float32Array|Float64Array} positions Non-indexed triangle soup (x, y, z per vertex).
 * @param {number[]} R Row-major 3x3 rotation matrix.
 * @param {number} voxel Cell size in mm (the shell tolerance).
 * @param {number} gap Minimum distance between parts in mm.
 */
export function buildShell(positions, R, voxel, gap = 0) {
  const p = rotatePositions(positions, R);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      const v = p[i + a];
      if (v < min[a]) min[a] = v;
      if (v > max[a]) max[a] = v;
    }
  }
  if (!Number.isFinite(min[0])) throw new Error('Mesh has no vertices');

  const rv = gap > 0 ? gap / 2 / voxel : 0;
  const pad = rv > 0 ? Math.floor(rv) + 1 : 0;
  const cx = Math.max(1, Math.ceil((max[0] - min[0]) / voxel - 1e-9));
  const cy = Math.max(1, Math.ceil((max[1] - min[1]) / voxel - 1e-9));
  const cz = Math.max(1, Math.ceil((max[2] - min[2]) / voxel - 1e-9));
  const nx = cx + 2 * pad, ny = cy + 2 * pad;
  const ox = min[0] - pad * voxel, oy = min[1] - pad * voxel, oz = min[2] - pad * voxel;

  let lo = new Int32Array(nx * ny).fill(0x7fffffff);
  let hi = new Int32Array(nx * ny).fill(-1);
  const iMax = pad + cx - 1, jMax = pad + cy - 1, kMax = pad + cz - 1;

  for (let t = 0; t < p.length; t += 9) {
    let ax = (p[t] - ox) / voxel, ay = (p[t + 1] - oy) / voxel, az = (p[t + 2] - oz) / voxel;
    let bx = (p[t + 3] - ox) / voxel, by = (p[t + 4] - oy) / voxel, bz = (p[t + 5] - oz) / voxel;
    let qx = (p[t + 6] - ox) / voxel, qy = (p[t + 7] - oy) / voxel, qz = (p[t + 8] - oz) / voxel;

    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const wx = qx - ax, wy = qy - ay, wz = qz - az;
    const nX = uy * wz - uz * wy, nY = uz * wx - ux * wz, nZ = ux * wy - uy * wx;
    const nLen = Math.hypot(nX, nY, nZ);
    if (nLen > 0) {
      const sx = (nX / nLen) * INWARD, sy = (nY / nLen) * INWARD, sz = (nZ / nLen) * INWARD;
      ax -= sx; ay -= sy; az -= sz;
      bx -= sx; by -= sy; bz -= sz;
      qx -= sx; qy -= sy; qz -= sz;
    }

    const tMinX = Math.min(ax, bx, qx), tMaxX = Math.max(ax, bx, qx);
    const tMinY = Math.min(ay, by, qy), tMaxY = Math.max(ay, by, qy);
    const tMinZ = Math.min(az, bz, qz), tMaxZ = Math.max(az, bz, qz);
    const i0 = clamp(Math.floor(tMinX - EPS), pad, iMax), i1 = clamp(Math.floor(tMaxX + EPS), pad, iMax);
    const j0 = clamp(Math.floor(tMinY - EPS), pad, jMax), j1 = clamp(Math.floor(tMaxY + EPS), pad, jMax);
    const kt0 = clamp(Math.floor(tMinZ - EPS), pad, kMax), kt1 = clamp(Math.floor(tMaxZ + EPS), pad, kMax);

    // The normal narrows the z range tested per column (not for steep faces).
    const useplane = nLen > 0 && Math.abs(nZ) > 1e-6 * nLen;

    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        let k0 = kt0, k1 = kt1;
        if (useplane) {
          const xa = Math.max(i, tMinX), xb = Math.min(i + 1, tMaxX);
          const ya = Math.max(j, tMinY), yb = Math.min(j + 1, tMaxY);
          const za = az - (nX * (xa - ax) + nY * (ya - ay)) / nZ;
          const zb = az - (nX * (xb - ax) + nY * (ya - ay)) / nZ;
          const zc = az - (nX * (xa - ax) + nY * (yb - ay)) / nZ;
          const zd = az - (nX * (xb - ax) + nY * (yb - ay)) / nZ;
          const zlo = Math.max(Math.min(za, zb, zc, zd), tMinZ);
          const zhi = Math.min(Math.max(za, zb, zc, zd), tMaxZ);
          k0 = clamp(Math.floor(zlo - EPS), pad, kMax);
          k1 = clamp(Math.floor(zhi + EPS), pad, kMax);
          if (k0 > k1) continue;
        }
        const c = j * nx + i;
        if (lo[c] <= k0 && hi[c] >= k1) continue; // nothing new to learn
        const upTo = Math.min(k1, lo[c] - 1);
        for (let k = k0; k <= upTo; k++) {
          if (triBoxOverlap(i + 0.5, j + 0.5, k + 0.5, BOX_HALF, ax, ay, az, bx, by, bz, qx, qy, qz)) {
            lo[c] = k;
            break;
          }
        }
        const downTo = Math.max(k0, hi[c] + 1);
        for (let k = k1; k >= downTo; k--) {
          if (triBoxOverlap(i + 0.5, j + 0.5, k + 0.5, BOX_HALF, ax, ay, az, bx, by, bz, qx, qy, qz)) {
            hi[c] = k;
            break;
          }
        }
      }
    }
  }

  if (pad > 0) {
    // Conservative Euclidean dilation: a target voxel is filled when its minimum
    // distance to any source voxel is within the gap radius.
    const offsets = [];
    const r2 = rv * rv;
    for (let dj = -pad; dj <= pad; dj++) {
      for (let di = -pad; di <= pad; di++) {
        const hx = Math.max(0, Math.abs(di) - 1), hy = Math.max(0, Math.abs(dj) - 1);
        const h2 = hx * hx + hy * hy;
        if (h2 > r2) continue;
        offsets.push(di, dj, Math.floor(1 + Math.sqrt(r2 - h2)));
      }
    }
    const lo2 = new Int32Array(nx * ny).fill(0x7fffffff);
    const hi2 = new Int32Array(nx * ny).fill(-1);
    for (let j = pad; j <= jMax; j++) {
      for (let i = pad; i <= iMax; i++) {
        const s = j * nx + i;
        if (hi[s] < 0) continue;
        for (let o = 0; o < offsets.length; o += 3) {
          const tIdx = (j + offsets[o + 1]) * nx + i + offsets[o];
          const e = offsets[o + 2];
          if (lo[s] - e < lo2[tIdx]) lo2[tIdx] = lo[s] - e;
          if (hi[s] + e > hi2[tIdx]) hi2[tIdx] = hi[s] + e;
        }
      }
    }
    lo = lo2;
    hi = hi2;
  }

  // Crop to occupied columns and normalise so the lowest voxel is k = 0.
  let iLo = Infinity, iHi = -1, jLo = Infinity, jHi = -1, kLo = Infinity, kHi = -1;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const c = j * nx + i;
      if (hi[c] < 0) continue;
      if (i < iLo) iLo = i;
      if (i > iHi) iHi = i;
      if (j < jLo) jLo = j;
      if (j > jHi) jHi = j;
      if (lo[c] < kLo) kLo = lo[c];
      if (hi[c] > kHi) kHi = hi[c];
    }
  }
  if (iHi < 0) throw new Error('Mesh produced an empty shell');

  const sx = iHi - iLo + 1, sy = jHi - jLo + 1, sz = kHi - kLo + 1;
  const sLo = new Int32Array(sx * sy).fill(-1);
  const sHi = new Int32Array(sx * sy).fill(-1);
  const ci = [], cj = [], clo = [], chi = [];
  let cells = 0;
  for (let j = 0; j < sy; j++) {
    for (let i = 0; i < sx; i++) {
      const c = (j + jLo) * nx + i + iLo;
      if (hi[c] < 0) continue;
      const a = lo[c] - kLo, b = hi[c] - kLo;
      sLo[j * sx + i] = a;
      sHi[j * sx + i] = b;
      ci.push(i); cj.push(j); clo.push(a); chi.push(b);
      cells += b - a + 1;
    }
  }

  return {
    nx: sx,
    ny: sy,
    nz: sz,
    voxel,
    lo: sLo,
    hi: sHi,
    // World position (rotated frame, mm) of the corner of voxel (0, 0, 0).
    origin: [ox + iLo * voxel, oy + jLo * voxel, oz + kLo * voxel],
    // Cells between the shell bottom and the real part bottom.
    bottomOffset: pad - kLo,
    // Real extent of the rotated part in mm.
    size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
    cells,
    footprint: ci.length,
    cols: {
      ci: Int32Array.from(ci),
      cj: Int32Array.from(cj),
      clo: Int32Array.from(clo),
      chi: Int32Array.from(chi),
    },
  };
}
