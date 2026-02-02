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

  return { palette, counts };
};

self.addEventListener("message", (event) => {
  const { buffer } = event.data;
  const result = decodeChunk(buffer);
  self.postMessage(result);
});
