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
// [실측 확인된 버그 → 수정] 지도를 처음 불러올 때 뷰포트에 걸친 청크를 한꺼번에 요청하는데,
// 그중 한 번도 안 가본(생성 안 된) 청크가 있으면 getHighestBlockAt()이 그 청크를 강제로
// 생성시키면서 메인 스레드를 완전히 막아버렸다 — 여러 개 겹치면 Paper Watchdog이 "서버
// 30초 무응답"으로 판단해 프로세스를 죽이고, 그게 반복 재시작으로 보였다(실제 크래시
// 스레드 덤프로 확인: MapTileRenderer.render → ChunkLoadTask 대기). 그래서 미생성 청크는
// 강제 생성 없이 "미탐사" 표시만 즉시 돌려준다 — MapChangeListener의 ChunkLoadEvent
// 리스너가 실제로 생성되는 순간 캐시를 무효화해서 다음 요청 때 진짜 지형으로 바뀐다.
//
// [디버깅] "[MapTile]" 태그로 캐시 미스(실제 렌더 발생)마다 소요 시간을 남긴다. 렌더링이
// 유독 느리거나(메인 스레드 프리즈 의심) 특정 (cx,cz)에서만 에러가 나면 여기서 잡힌다.
public final class MapTileRenderer {
    private static final int CHUNK_SIZE = 16;
    private static final int PIXELS_PER_BLOCK = 8;
    private static final int TILE_SIZE = CHUNK_SIZE * PIXELS_PER_BLOCK; // 128
    private static final Logger LOGGER = Logger.getLogger("BridgePaper");
    private static final int UNEXPLORED_COLOR = 0xFF131315; // 프런트 배경색(--stone-950)과 맞춤 — UI 개편으로 갱신

    private final Map<String, byte[]> cache = new ConcurrentHashMap<>();

    // 반드시 메인 스레드에서 호출할 것(Bukkit 월드/블록 API).
    public byte[] render(World world, int cx, int cz) throws IOException {
        String key = cacheKey(world.getName(), cx, cz);
        byte[] cached = cache.get(key);
        if (cached != null) {
            return cached;
        }

        // 청크 생성을 절대 트리거하지 않는 확인 — isChunkGenerated는 생성 안 된 청크를
        // 그냥 "없다"고만 답하고 절대 블로킹하지 않는다(getHighestBlockAt과 결정적 차이).
        if (!world.isChunkGenerated(cx, cz)) {
            byte[] bytes = encodeSolid(UNEXPLORED_COLOR);
            cache.put(key, bytes);
            LOGGER.info("[MapTile] world=" + world.getName() + " cx=" + cx + " cz=" + cz
                + " 미탐사 청크 — 생성 트리거 없이 플레이스홀더 반환");
            return bytes;
        }

        long startedAt = System.nanoTime();
        BufferedImage tile = new BufferedImage(TILE_SIZE, TILE_SIZE, BufferedImage.TYPE_INT_ARGB);
        int baseX = cx * CHUNK_SIZE;
        int baseZ = cz * CHUNK_SIZE;
        try {
            for (int lx = 0; lx < CHUNK_SIZE; lx++) {
                for (int lz = 0; lz < CHUNK_SIZE; lz++) {
                    Block block = topBlock(world, baseX + lx, baseZ + lz);
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

    // 네더는 하늘이 없고 항상 베드락 천장으로 덮여있어서 world.getHighestBlockAt()이
    // (하늘에서 내려다보는 관점이라) 매 컬럼 그 천장만 잡아버린다 — 지도 전체가 회색
    // 천장 한 장으로만 보이게 된다. 그래서 네더는 천장 바로 아래부터 첫 번째 비-공기
    // 블록을 직접 스캔한다("동굴형" 지도 — Dynmap 등 다른 도구도 같은 방식을 쓴다).
    //
    // ponytail: 컬럼당 최대 ~120블록을 하나씩 읽는다(O(1) 하이트맵 대비 훨씬 느림). 다만
    // 이 메서드는 render() 위에서 이미 isChunkGenerated() 통과한(=이미 메모리에 로드된)
    // 청크에서만 불리므로 원래 사고 원인이었던 "동기 청크 생성"과는 무관하고, 단순 배열
    // 조회 수준이라 밀리초 단위로 끝난다 — 동시 렌더 개수도 이미 4개로 제한돼 있다(이
    // 파일 상단 MapTileHandler의 세마포어). 실측상 문제 되면: 청크 섹션을 직접 순회하는
    // 더 빠른 API로 바꾸거나, 네더 타일도 별도 동시성 캡을 둘 것.
    private static Block topBlock(World world, int x, int z) {
        if (world.getEnvironment() != World.Environment.NETHER) {
            return world.getHighestBlockAt(x, z);
        }
        int startY = Math.min(world.getMaxHeight() - 5, 120);
        for (int y = startY; y > world.getMinHeight(); y--) {
            Block block = world.getBlockAt(x, y, z);
            if (block.getType() != Material.AIR && block.getType() != Material.CAVE_AIR) {
                return block;
            }
        }
        return world.getBlockAt(x, world.getMinHeight(), z); // 완전히 뚫린 기둥 — 바닥(대개 베드락) 반환.
    }

    public void invalidate(String worldName, int cx, int cz) {
        cache.remove(cacheKey(worldName, cx, cz));
    }

    private static byte[] encodeSolid(int argb) throws IOException {
        BufferedImage tile = new BufferedImage(TILE_SIZE, TILE_SIZE, BufferedImage.TYPE_INT_ARGB);
        for (int y = 0; y < TILE_SIZE; y++) {
            for (int x = 0; x < TILE_SIZE; x++) {
                tile.setRGB(x, y, argb);
            }
        }
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ImageIO.write(tile, "png", out);
        return out.toByteArray();
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
