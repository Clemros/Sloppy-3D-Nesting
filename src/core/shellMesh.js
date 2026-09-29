// Surface triangles of a column shell (only faces not shared with a
// neighbouring column), in shell-local mm with voxel (0, 0, 0) at the origin.
export function shellSurface(shell, voxel) {
  const { nx, ny, lo, hi } = shell;
  const out = [];
  const quad = (a, b, c, d) => {
    out.push(...a, ...b, ...c, ...a, ...c, ...d);
  };
  const get = (i, j) => (i < 0 || j < 0 || i >= nx || j >= ny ? -1 : j * nx + i);

  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const c = j * nx + i;
      if (lo[c] < 0) continue;
      const x0 = i * voxel, x1 = (i + 1) * voxel;
      const y0 = j * voxel, y1 = (j + 1) * voxel;
      const z0 = lo[c] * voxel, z1 = (hi[c] + 1) * voxel;
      quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]); // top
      quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]); // bottom

      // Sides: [neighbour di, dj, corner a, corner b] with outward winding.
      const sides = [
        [1, 0, [x1, y0], [x1, y1]],
        [-1, 0, [x0, y1], [x0, y0]],
        [0, 1, [x1, y1], [x0, y1]],
        [0, -1, [x0, y0], [x1, y0]],
      ];
      for (const [di, dj, a, b] of sides) {
        const n = get(i + di, j + dj);
        const spans = [];
        if (n < 0 || lo[n] < 0) {
          spans.push([lo[c], hi[c] + 1]);
        } else {
          if (lo[c] < lo[n]) spans.push([lo[c], Math.min(hi[c] + 1, lo[n])]);
          if (hi[c] > hi[n]) spans.push([Math.max(lo[c], hi[n] + 1), hi[c] + 1]);
        }
        for (const [s0, s1] of spans) {
          const za = s0 * voxel, zb = s1 * voxel;
          quad([a[0], a[1], za], [b[0], b[1], za], [b[0], b[1], zb], [a[0], a[1], zb]);
        }
      }
    }
  }
  return new Float32Array(out);
}
