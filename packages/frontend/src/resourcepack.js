// 마인크래프트 리소스팩(.zip)에서 블록 텍스처만 뽑아내는 최소 구현.
// 외부 zip 라이브러리 없이 ZIP 중앙 디렉터리를 직접 읽고, 브라우저 내장
// DecompressionStream("deflate-raw")로 압축을 푼다(stored 항목은 그대로 사용).
//
// ponytail: 블록당 텍스처 1장만 뽑아 6면에 동일 적용한다(면별 텍스처/블록스테이트
// 모델/생물 군계 색조 보정은 생략). assets/<namespace>/textures/block/<name>.png를
// <namespace>:<name> 블록 ID로 그대로 매칭 — 대부분의 단순 큐브 블록은 이 방식으로도
// 정확하다. 통나무 옆/윗면, 잔디 색조 등 면별 정확도가 필요해지면 blockstates/models
// JSON까지 파싱하는 방향으로 확장.

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;

const findEndOfCentralDirectory = (view) => {
  const maxCommentLength = 65535;
  const start = Math.max(0, view.byteLength - 22 - maxCommentLength);
  for (let offset = view.byteLength - 22; offset >= start; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) {
      return offset;
    }
  }
  throw new Error("ZIP 파일이 아니거나 손상되었습니다 (EOCD 없음).");
};

const decodeEntryData = async (bytes, compressionMethod) => {
  if (compressionMethod === 0) {
    return bytes;
  }
  if (compressionMethod === 8) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  throw new Error(`지원하지 않는 ZIP 압축 방식: ${compressionMethod}`);
};

// assets/<namespace>/textures/block/<name>.png -> "<namespace>:<name>"
const blockIdFromPath = (path) => {
  const match = path.match(/^assets\/([^/]+)\/textures\/block\/([^/]+)\.png$/);
  return match ? `${match[1]}:${match[2]}` : null;
};

export const loadBlockTexturesFromResourcePack = async (file, onProgress) => {
  const buffer = await file.arrayBuffer();
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const decoder = new TextDecoder("utf-8");

  const eocdOffset = findEndOfCentralDirectory(view);
  const entryCount = view.getUint16(eocdOffset + 10, true);
  let centralDirOffset = view.getUint32(eocdOffset + 16, true);

  const targets = [];
  for (let i = 0; i < entryCount; i += 1) {
    if (view.getUint32(centralDirOffset, true) !== CENTRAL_DIR_SIGNATURE) {
      break;
    }
    const compressionMethod = view.getUint16(centralDirOffset + 10, true);
    const compressedSize = view.getUint32(centralDirOffset + 20, true);
    const nameLength = view.getUint16(centralDirOffset + 28, true);
    const extraLength = view.getUint16(centralDirOffset + 30, true);
    const commentLength = view.getUint16(centralDirOffset + 32, true);
    const localHeaderOffset = view.getUint32(centralDirOffset + 42, true);
    const nameStart = centralDirOffset + 46;
    const path = decoder.decode(bytes.subarray(nameStart, nameStart + nameLength));

    const blockId = blockIdFromPath(path);
    if (blockId) {
      targets.push({ blockId, compressionMethod, compressedSize, localHeaderOffset });
    }
    centralDirOffset = nameStart + nameLength + extraLength + commentLength;
  }

  const textures = new Map();
  for (let i = 0; i < targets.length; i += 1) {
    const target = targets[i];
    if (view.getUint32(target.localHeaderOffset, true) !== LOCAL_HEADER_SIGNATURE) {
      continue;
    }
    const localNameLength = view.getUint16(target.localHeaderOffset + 26, true);
    const localExtraLength = view.getUint16(target.localHeaderOffset + 28, true);
    const dataStart = target.localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.subarray(dataStart, dataStart + target.compressedSize);
    try {
      const png = await decodeEntryData(compressed, target.compressionMethod);
      textures.set(target.blockId, new Blob([png], { type: "image/png" }));
    } catch {
      // 개별 텍스처 하나가 깨져도 나머지는 계속 처리한다.
    }
    onProgress?.(i + 1, targets.length);
  }
  return textures;
};
