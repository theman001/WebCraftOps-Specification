package net.webcraftops.bridgepaper;

import org.bukkit.Location;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.world.ChunkLoadEvent;

import java.util.logging.Logger;

// 블록이 바뀌면 해당 청크의 지도 타일 캐시만 지우고(재렌더링은 다음 요청 시 지연 실행 —
// 이벤트 핸들러 자체를 무겁게 만들지 않는다), 프런트가 그 타일만 다시 받아가도록 SSE로
// {"cx":..,"cz":..}를 push한다.
//
// [디버깅] "[MapEvents]" 태그 — 실시간 반영이 안 되는 것처럼 보이면, 여기 로그가
// 애초에 안 찍히는지(이벤트 자체가 안 들어옴) vs 찍히는데 프런트가 안 받는지부터 구분한다.
public final class MapChangeListener implements Listener {
    private static final Logger LOGGER = Logger.getLogger("BridgePaper");
    private final MapTileRenderer renderer;
    private final SseBroadcaster mapEvents;

    public MapChangeListener(MapTileRenderer renderer, SseBroadcaster mapEvents) {
        this.renderer = renderer;
        this.mapEvents = mapEvents;
    }

    @EventHandler
    public void onBlockPlace(BlockPlaceEvent event) {
        invalidate(event.getBlock().getLocation());
    }

    @EventHandler
    public void onBlockBreak(BlockBreakEvent event) {
        invalidate(event.getBlock().getLocation());
    }

    // MapTileRenderer가 미탐사 청크는 강제 생성 없이 플레이스홀더로 캐싱해두는데, 그
    // 청크가 나중에 실제로 생성되면(플레이어가 걸어가서 등) 캐시를 지워야 다음 요청 때
    // 진짜 지형이 그려진다. isNewChunk()가 true인 경우만(=이번이 첫 로드=방금 생성됨)
    // 해당한다 — 이미 있던 청크를 그냥 메모리에 로드하는 흔한 경우엔 안 걸린다.
    @EventHandler
    public void onChunkLoad(ChunkLoadEvent event) {
        if (!event.isNewChunk()) {
            return;
        }
        int cx = event.getChunk().getX();
        int cz = event.getChunk().getZ();
        String worldName = event.getWorld().getName();
        renderer.invalidate(worldName, cx, cz);
        boolean broadcasted = mapEvents.hasSubscribers();
        if (broadcasted) {
            mapEvents.broadcast("{\"cx\":" + cx + ",\"cz\":" + cz + "}");
        }
        LOGGER.info("[MapEvents] world=" + worldName + " cx=" + cx + " cz=" + cz
            + " 신규 생성 청크 — 미탐사 플레이스홀더 캐시 무효화");
    }

    private void invalidate(Location location) {
        int cx = Math.floorDiv(location.getBlockX(), 16);
        int cz = Math.floorDiv(location.getBlockZ(), 16);
        String worldName = location.getWorld().getName();
        renderer.invalidate(worldName, cx, cz);
        boolean broadcasted = mapEvents.hasSubscribers();
        if (broadcasted) {
            mapEvents.broadcast("{\"cx\":" + cx + ",\"cz\":" + cz + "}");
        }
        LOGGER.info("[MapEvents] world=" + worldName + " cx=" + cx + " cz=" + cz
            + " 타일 캐시 무효화" + (broadcasted ? " + SSE push" : " (구독자 없음, push 생략)"));
    }
}
