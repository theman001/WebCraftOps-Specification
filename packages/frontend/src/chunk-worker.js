// Bridge 유선 포맷: varint(cx,cz,sectionCount) + 섹션별 팔레트 + RLE 인덱스.
// bridge-core/fabric-bridge.ts의 encodeChunkPayload와 짝을 이루는 디코더.
const readVarInt = (view, offset) => {
  let result = 0;
  let shift = 0;
  let pos = offset;
  for (;;) {
    const byte = view.getUint8(pos);
    pos += 1;
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      break;
    }
    shift += 7;
  }
  return { value: result >>> 0, offset: pos };
};

// cx/cz는 32비트 two's complement 비트패턴 그대로 varint로 인코딩되어 있다(bridge-paper의
// VarIntCodec, bridge-mock 둘 다 음수를 이렇게 인코딩). readVarInt가 unsigned로 강제하면
// 스폰 서/북쪽(음수 좌표) 청크가 전부 거대한 양수로 깨진다 — 부호를 살려 다시 해석한다.
const readVarIntSigned = (view, offset) => {
  const { value, offset: nextOffset } = readVarInt(view, offset);
  return { value: value | 0, offset: nextOffset };
};

const decodeChunk = (buffer) => {
  const view = new DataView(buffer);
  const decoder = new TextDecoder();
  let offset = 0;

  let cx, cz, sectionCount;
  ({ value: cx, offset } = readVarIntSigned(view, offset));
  ({ value: cz, offset } = readVarIntSigned(view, offset));
  ({ value: sectionCount, offset } = readVarInt(view, offset));

  const palette = [];
  const indices = [];

  for (let s = 0; s < sectionCount; s += 1) {
    let paletteLength;
    ({ value: paletteLength, offset } = readVarInt(view, offset));

    const paletteOffset = palette.length;
    for (let i = 0; i < paletteLength; i += 1) {
      let entryLength;
      ({ value: entryLength, offset } = readVarInt(view, offset));
      palette.push(decoder.decode(new Uint8Array(buffer, offset, entryLength)));
      offset += entryLength;
    }

    let rleLength;
    ({ value: rleLength, offset } = readVarInt(view, offset));
    for (let i = 0; i < rleLength; i += 1) {
      let count, value;
      ({ value: count, offset } = readVarInt(view, offset));
      ({ value, offset } = readVarInt(view, offset));
      for (let n = 0; n < count; n += 1) {
        indices.push(paletteOffset + value);
      }
    }
  }

  const counts = new Array(palette.length).fill(0);
  indices.forEach((index) => {
    counts[index] += 1;
  });

  return { cx, cz, palette, counts, indices };
};

const buildMesh = (palette, indices, options = {}) => {
  const total = indices.length;
  // 브릿지 유선 포맷은 섹션당 16x16x16을 보장하므로(ChunkEncoder.java/fabric-bridge.ts),
  // 실제 청크 데이터는 항상 sizeX=sizeZ=16이다. sqrt로 정사각형을 추측하던 예전 방식은
  // 384블록 높이 실제 청크에서 314x314 평면처럼 왜곡돼 카메라가 지형 속에 파묻히는
  // 원인이었다.
  const sizeX = 16;
  const sizeZ = 16;
  const sizeY = Math.max(1, Math.ceil(total / (sizeX * sizeZ)));
  const lodStep = Math.max(1, options.lodStep ?? 1);

  // 블록 타입(팔레트 인덱스)별로 지오메트리를 분리해서 만든다 — 리소스팩 텍스처를
  // 블록마다 다른 재질로 입히려면(app.js) 블록 타입당 별도 Mesh가 필요하다. 한
  // 렌더 창(RENDER_RADIUS)에 실제로 존재하는 블록 종류는 많아야 수백 개 수준이라
  // 텍스처 아틀라스 없이 재질별 개별 Mesh로도 충분하다.
  const groupsByIndex = new Map();
  const getGroup = (paletteIdx) => {
    let group = groupsByIndex.get(paletteIdx);
    if (!group) {
      group = { positions: [], normals: [], uvs: [], indices: [], vertexOffset: 0 };
      groupsByIndex.set(paletteIdx, group);
    }
    return group;
  };

  const colorForIndex = (index) => {
    const hue = (index * 137.5) % 360;
    const color = hslToRgb(hue / 360, 0.45, 0.55);
    return color;
  };

  const faceUVs = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];

  const getIndex = (x, y, z) => {
    if (x < 0 || y < 0 || z < 0 || x >= sizeX || y >= sizeY || z >= sizeZ) {
      return null;
    }
    const idx = y * sizeX * sizeZ + z * sizeX + x;
    return idx < total ? indices[idx] : null;
  };

  // 공기 블록은 "채워진" 것으로 치지 않는다 — 이전엔 air까지 불투명 큐브로
  // 렌더링해서 실제 지형이 아니라 무지개색 노이즈처럼 보였다(청크 대부분은 공기).
  const hasSampledVoxel = (x, y, z) => {
    if (x % lodStep !== 0 || y % lodStep !== 0 || z % lodStep !== 0) {
      return false;
    }
    const idx = getIndex(x, y, z);
    if (idx === null) {
      return false;
    }
    return palette[idx] !== "minecraft:air";
  };

  const faceDefs = [
    { dir: [1, 0, 0], corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
    { dir: [-1, 0, 0], corners: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
    { dir: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
    { dir: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
    { dir: [0, 0, 1], corners: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]] },
    { dir: [0, 0, -1], corners: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
  ];

  // 청크 중앙 기둥에서 공기가 아닌 가장 높은 블록(지표면)을 먼저 찾는다. 실제
  // 청크는 최대 384블록 높이라 전부 렌더링하면(특히 지하 암반층) voxel마다
  // 개별 Mesh 객체를 만드는 지금 구조로는 수만 개가 생겨 렌더러가 감당을 못
  // 한다 — 지표면 근처 얇은 슬라이스만 그린다.
  let surfaceY = 0;
  for (let y = sizeY - 1; y >= 0; y -= 1) {
    const idx = getIndex(8, y, 8);
    if (idx !== null && palette[idx] && palette[idx] !== "minecraft:air") {
      surfaceY = y;
      break;
    }
  }
  const RENDER_RADIUS = 12;
  const yStart = Math.max(0, surfaceY - RENDER_RADIUS);
  const yEnd = Math.min(sizeY, surfaceY + RENDER_RADIUS + 1);

  const voxels = [];

  for (let y = yStart; y < yEnd; y += 1) {
    for (let z = 0; z < sizeZ; z += 1) {
      for (let x = 0; x < sizeX; x += 1) {
        if (!hasSampledVoxel(x, y, z)) {
          continue;
        }
        const idx = getIndex(x, y, z);
        voxels.push({ position: [x, y, z], blockId: palette[idx] });
        const group = getGroup(idx);
        for (const face of faceDefs) {
          const nx = x + face.dir[0];
          const ny = y + face.dir[1];
          const nz = z + face.dir[2];
          if (hasSampledVoxel(nx, ny, nz)) {
            continue;
          }
          face.corners.forEach((corner, cornerIdx) => {
            group.positions.push(x + corner[0], y + corner[1], z + corner[2]);
            group.normals.push(...face.dir);
            group.uvs.push(...faceUVs[cornerIdx]);
          });
          const vo = group.vertexOffset;
          group.indices.push(vo, vo + 1, vo + 2, vo, vo + 2, vo + 3);
          group.vertexOffset += 4;
        }
      }
    }
  }

  const groups = Array.from(groupsByIndex.entries()).map(([paletteIdx, group]) => ({
    blockId: palette[paletteIdx],
    color: colorForIndex(paletteIdx),
    positions: new Float32Array(group.positions),
    normals: new Float32Array(group.normals),
    uvs: new Float32Array(group.uvs),
    indices: new Uint32Array(group.indices),
  }));

  return {
    groups,
    voxels,
    dimensions: { sizeX, sizeY, sizeZ },
    surfaceY,
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
  const transferList = mesh.groups.flatMap((g) => [
    g.positions.buffer,
    g.normals.buffer,
    g.uvs.buffer,
    g.indices.buffer,
  ]);
  self.postMessage({ palette: result.palette, counts: result.counts, mesh }, transferList);
});
