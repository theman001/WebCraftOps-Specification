package net.webcraftops.bridgepaper;

import org.bukkit.ChunkSnapshot;
import org.bukkit.World;
import org.bukkit.block.data.BlockData;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

// packages/bridge-core/src/fabric-bridge.ts의 encodeChunkPayload/encodeRle와
// packages/frontend/src/chunk-worker.js의 decodeChunk가 기대하는 유선 포맷을 그대로 재현한다:
//   varint cx, varint cz, varint sectionCount
//   섹션마다: varint paletteLength, [varint idByteLen + UTF-8 bytes]*,
//             varint rleRunCount, [varint count + varint paletteIndex]*
// 반드시 메인 스레드에서 호출해야 한다(Bukkit 월드 API 제약) — 호출부(ChunksHandler)가
// MainThreadExecutor로 감싼다.
public final class ChunkEncoder {
    private ChunkEncoder() {}

    public static byte[] encode(World world, int cx, int cz) throws Exception {
        ChunkSnapshot snapshot = world.getChunkAt(cx, cz).getChunkSnapshot();
        int minHeight = world.getMinHeight();
        int maxHeight = world.getMaxHeight();

        ByteArrayOutputStream out = new ByteArrayOutputStream();
        VarIntCodec.writeVarInt(out, cx);
        VarIntCodec.writeVarInt(out, cz);

        List<byte[]> sections = new ArrayList<>();
        for (int sectionBaseY = minHeight; sectionBaseY < maxHeight; sectionBaseY += 16) {
            int sectionHeight = Math.min(16, maxHeight - sectionBaseY);
            sections.add(encodeSection(snapshot, sectionBaseY, sectionHeight));
        }

        VarIntCodec.writeVarInt(out, sections.size());
        for (byte[] section : sections) {
            out.write(section);
        }
        return out.toByteArray();
    }

    private static byte[] encodeSection(ChunkSnapshot snapshot, int baseY, int height) throws Exception {
        // 블록 상태(axis 등)는 팔레트에서 생략한다 — 기본 Material만 구분.
        // ponytail: 상태별 팔레트 분리는 시각적 정확도가 실제로 필요해지면 추가.
        List<String> palette = new ArrayList<>();
        int[] indices = new int[16 * 16 * height];

        int i = 0;
        for (int y = 0; y < height; y++) {
            for (int z = 0; z < 16; z++) {
                for (int x = 0; x < 16; x++) {
                    BlockData data = snapshot.getBlockData(x, baseY + y, z);
                    String id = data.getMaterial().getKey().toString();
                    int idx = palette.indexOf(id);
                    if (idx == -1) {
                        idx = palette.size();
                        palette.add(id);
                    }
                    indices[i++] = idx;
                }
            }
        }

        ByteArrayOutputStream out = new ByteArrayOutputStream();
        VarIntCodec.writeVarInt(out, palette.size());
        for (String id : palette) {
            byte[] bytes = id.getBytes(StandardCharsets.UTF_8);
            VarIntCodec.writeVarInt(out, bytes.length);
            out.write(bytes);
        }

        List<int[]> runs = new ArrayList<>(); // {value, count}
        if (indices.length > 0) {
            int current = indices[0];
            int count = 1;
            for (int k = 1; k < indices.length; k++) {
                if (indices[k] == current) {
                    count++;
                } else {
                    runs.add(new int[] {current, count});
                    current = indices[k];
                    count = 1;
                }
            }
            runs.add(new int[] {current, count});
        }

        VarIntCodec.writeVarInt(out, runs.size());
        for (int[] run : runs) {
            VarIntCodec.writeVarInt(out, run[1]); // count
            VarIntCodec.writeVarInt(out, run[0]); // paletteIndex
        }

        return out.toByteArray();
    }
}
