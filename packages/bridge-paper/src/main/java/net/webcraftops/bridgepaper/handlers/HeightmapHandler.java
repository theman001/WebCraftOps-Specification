package net.webcraftops.bridgepaper.handlers;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import net.webcraftops.bridgepaper.HttpUtil;
import net.webcraftops.bridgepaper.MainThreadExecutor;
import org.bukkit.World;

import java.io.IOException;
import java.util.Map;
import java.util.logging.Logger;

// GET /bridge/world/{worldId}/heightmap?x=&z= — 그 x,z 컬럼의 최고 높이(Y). 지도에서
// 플레이어를 드래그해 새 위치로 텔레포트할 때 "그 자리 지표면 바로 위"로 보내려면
// Y가 필요한데, 지도 타일 PNG엔 높이 정보가 없어서 따로 물어봐야 한다.
//
// MapTileRenderer와 같은 이유로 미생성 청크는 강제로 생성시키지 않는다(Watchdog 크래시
// 재발 방지) — 그 경우 409를 돌려주고 프런트가 텔레포트를 포기하게 한다.
public final class HeightmapHandler implements HttpHandler {
    private static final Logger LOGGER = Logger.getLogger("BridgePaper");
    private final MainThreadExecutor executor;

    public HeightmapHandler(MainThreadExecutor executor) {
        this.executor = executor;
    }

    @Override
    public void handle(HttpExchange exchange) throws IOException {
        if (!"GET".equalsIgnoreCase(exchange.getRequestMethod())) {
            HttpUtil.sendError(exchange, 405, "GET만 지원합니다.");
            return;
        }
        String worldId = HttpUtil.resolveWorldId(exchange.getRequestURI().getPath());
        World world = HttpUtil.resolveWorld(worldId);
        if (world == null) {
            HttpUtil.sendError(exchange, 404, "월드를 찾을 수 없습니다: " + worldId);
            return;
        }
        Map<String, String> query = HttpUtil.parseQuery(exchange.getRequestURI().getRawQuery());
        int x;
        int z;
        try {
            x = Integer.parseInt(query.get("x"));
            z = Integer.parseInt(query.get("z"));
        } catch (NumberFormatException | NullPointerException e) {
            HttpUtil.sendError(exchange, 400, "x, z 쿼리 파라미터가 필요합니다.");
            return;
        }
        try {
            int y = executor.runSync(() -> {
                int cx = Math.floorDiv(x, 16);
                int cz = Math.floorDiv(z, 16);
                if (!world.isChunkGenerated(cx, cz)) {
                    return Integer.MIN_VALUE; // 미생성 — 강제 생성 안 시킴(아래서 409로 변환)
                }
                return world.getHighestBlockYAt(x, z);
            }, 5_000);
            if (y == Integer.MIN_VALUE) {
                HttpUtil.sendError(exchange, 409, "아직 생성되지 않은 지역입니다.");
                return;
            }
            HttpUtil.sendJson(exchange, 200, "{\"y\":" + y + "}");
        } catch (Exception e) {
            LOGGER.severe("[Heightmap] world=" + worldId + " x=" + x + " z=" + z + " 조회 실패: " + e);
            HttpUtil.sendError(exchange, 500, "높이 조회 실패: " + e.getMessage());
        }
    }
}
