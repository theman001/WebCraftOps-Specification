package net.webcraftops.bridgepaper;

import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Block;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.logging.Logger;

// 청크(16x16 블록) 하나를 실제 블록 텍스처를 합성한 PNG 타일로 렌더링한다. 블록이 안
// 바뀌는 한 결과를 캐싱하고, MapChangeListener가 블록 배치/파괴 시 해당 청크만 무효화한다
// — 매번 다시 256개 컬럼을 스캔/합성하지 않아도 되게 하는 게 "실시간" 요구사항의 핵심.
//
// [디버깅] "[MapTile]" 태그로 캐시 미스(실제 렌더 발생)마다 소요 시간을 남긴다. 렌더링이
// 유독 느리거나(메인 스레드 프리즈 의심) 특정 (cx,cz)에서만 에러가 나면 여기서 잡힌다.
public final class MapTileRenderer {
    private static final int CHUNK_SIZE = 16;
    private static final int PIXELS_PER_BLOCK = 8;
    private static final int TILE_SIZE = CHUNK_SIZE * PIXELS_PER_BLOCK; // 128
    private static final Logger LOGGER = Logger.getLogger("BridgePaper");

    private final Map<String, byte[]> cache = new ConcurrentHashMap<>();

    // 반드시 메인 스레드에서 호출할 것(Bukkit 월드/블록 API).
    public byte[] render(World world, int cx, int cz) throws IOException {
        String key = cacheKey(world.getName(), cx, cz);
        byte[] cached = cache.get(key);
        if (cached != null) {
            return cached;
        }

        long startedAt = System.nanoTime();
        BufferedImage tile = new BufferedImage(TILE_SIZE, TILE_SIZE, BufferedImage.TYPE_INT_ARGB);
        int baseX = cx * CHUNK_SIZE;
        int baseZ = cz * CHUNK_SIZE;
        try {
            for (int lx = 0; lx < CHUNK_SIZE; lx++) {
                for (int lz = 0; lz < CHUNK_SIZE; lz++) {
                    Block block = world.getHighestBlockAt(baseX + lx, baseZ + lz);
                    Material material = block.getType();
                    BufferedImage texture = Textures.getTopTexture(material);
                    stamp(tile, texture, lx * PIXELS_PER_BLOCK, lz * PIXELS_PER_BLOCK);
                }
            }
        } catch (RuntimeException e) {
            LOGGER.severe("[MapTile] world=" + world.getName() + " cx=" + cx + " cz=" + cz
                + " 렌더링 중 예외: " + e);
            throw e;
        }

        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ImageIO.write(tile, "png", out);
        byte[] bytes = out.toByteArray();
        cache.put(key, bytes);
        double ms = (System.nanoTime() - startedAt) / 1_000_000.0;
        LOGGER.info(String.format("[MapTile] world=%s cx=%d cz=%d 렌더링 완료 (%.1fms, %d bytes)",
            world.getName(), cx, cz, ms, bytes.length));
        return bytes;
    }

    public void invalidate(String worldName, int cx, int cz) {
        cache.remove(cacheKey(worldName, cx, cz));
    }

    private static void stamp(BufferedImage tile, BufferedImage texture, int px, int pz) {
        for (int ty = 0; ty < PIXELS_PER_BLOCK; ty++) {
            for (int tx = 0; tx < PIXELS_PER_BLOCK; tx++) {
                // 16x16 텍스처를 8x8로 다운샘플(최근접 샘플링 — 지도 축척에서 굳이 보간 안 해도 됨).
                int sx = tx * 2;
                int sy = ty * 2;
                tile.setRGB(px + tx, pz + ty, texture.getRGB(sx, sy));
            }
        }
    }

    private static String cacheKey(String worldName, int cx, int cz) {
        return worldName + ":" + cx + "," + cz;
    }
}
