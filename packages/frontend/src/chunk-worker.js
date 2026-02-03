const decodeChunk = (buffer) => {
  const view = new DataView(buffer);
  let offset = 0;
  const paletteCount = view.getUint8(offset);
  offset += 1;
  const palette = [];
  const decoder = new TextDecoder();

  for (let i = 0; i < paletteCount; i += 1) {
    const length = view.getUint8(offset);
    offset += 1;
    const entry = decoder.decode(new Uint8Array(buffer, offset, length));
    offset += length;
    palette.push(entry);
  }

  const indicesLength = view.getUint16(offset);
  offset += 2;
  const counts = new Array(palette.length).fill(0);
  for (let i = 0; i < indicesLength; i += 1) {
    const index = view.getUint8(offset + i);
    if (counts[index] !== undefined) {
      counts[index] += 1;
    }
  }

  return { palette, counts, indices: Array.from(new Uint8Array(buffer, offset, indicesLength)) };
};

const buildMesh = (palette, indices, options = {}) => {
  const total = indices.length;
  const sizeX = Math.ceil(Math.sqrt(total));
  const sizeZ = sizeX;
  const sizeY = Math.ceil(total / (sizeX * sizeZ));
  const lodStep = Math.max(1, options.lodStep ?? 1);

  const positions = [];
  const normals = [];
  const colors = [];
  const meshIndices = [];
  let vertexOffset = 0;

  const colorForIndex = (index) => {
    const hue = (index * 137.5) % 360;
    const color = hslToRgb(hue / 360, 0.45, 0.55);
    return color;
  };

  const getIndex = (x, y, z) => {
    if (x < 0 || y < 0 || z < 0 || x >= sizeX || y >= sizeY || z >= sizeZ) {
      return null;
    }
    const idx = y * sizeX * sizeZ + z * sizeX + x;
    return idx < total ? indices[idx] : null;
  };

  const hasSampledVoxel = (x, y, z) => {
    if (x % lodStep !== 0 || y % lodStep !== 0 || z % lodStep !== 0) {
      return false;
    }
    return getIndex(x, y, z) !== null;
  };

  const faceDefs = [
    { dir: [1, 0, 0], corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
    { dir: [-1, 0, 0], corners: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
    { dir: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
    { dir: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
    { dir: [0, 0, 1], corners: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]] },
    { dir: [0, 0, -1], corners: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
  ];

  const voxels = [];

  for (let y = 0; y < sizeY; y += 1) {
    for (let z = 0; z < sizeZ; z += 1) {
      for (let x = 0; x < sizeX; x += 1) {
        if (!hasSampledVoxel(x, y, z)) {
          continue;
        }
        const idx = getIndex(x, y, z);
        voxels.push({ position: [x, y, z], blockId: palette[idx] });
        const [r, g, b] = colorForIndex(idx);
        for (const face of faceDefs) {
          const nx = x + face.dir[0];
          const ny = y + face.dir[1];
          const nz = z + face.dir[2];
          if (hasSampledVoxel(nx, ny, nz)) {
            continue;
          }
          face.corners.forEach((corner) => {
            positions.push(x + corner[0], y + corner[1], z + corner[2]);
            normals.push(...face.dir);
            colors.push(r, g, b);
          });
          meshIndices.push(
            vertexOffset,
            vertexOffset + 1,
            vertexOffset + 2,
            vertexOffset,
            vertexOffset + 2,
            vertexOffset + 3,
          );
          vertexOffset += 4;
        }
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    colors: new Float32Array(colors),
    indices: new Uint32Array(meshIndices),
    voxels,
    dimensions: { sizeX, sizeY, sizeZ },
    lodStep,
  };
};

const hslToRgb = (h, s, l) => {
  if (s === 0) {
    return [l, l, l];
  }
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const r = hue2rgb(p, q, h + 1 / 3);
  const g = hue2rgb(p, q, h);
  const b = hue2rgb(p, q, h - 1 / 3);
  return [r, g, b];
};

self.addEventListener("message", (event) => {
  const { buffer, lodStep } = event.data;
  const result = decodeChunk(buffer);
  const mesh = buildMesh(result.palette, result.indices, { lodStep });
  self.postMessage(
    { palette: result.palette, counts: result.counts, mesh },
    [mesh.positions.buffer, mesh.normals.buffer, mesh.colors.buffer, mesh.indices.buffer],
  );
});
