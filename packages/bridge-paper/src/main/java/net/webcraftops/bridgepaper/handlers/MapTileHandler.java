package net.webcraftops.bridgepaper.handlers;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import net.webcraftops.bridgepaper.HttpUtil;
import net.webcraftops.bridgepaper.MainThreadExecutor;
import net.webcraftops.bridgepaper.MapTileRenderer;
import org.bukkit.World;

import java.io.IOException;
import java.util.Map;
import java.util.logging.Logger;

// [디버깅] "[MapTileHandler]" 태그 — 요청이 실제로 여기까지 도달하는지(라우팅/토큰 문제
// 배제), worldId 파싱이 맞는지, 에러면 어떤 예외였는지를 남긴다.
public final class MapTileHandler implements HttpHandler {
    private static final Logger LOGGER = Logger.getLogger("BridgePaper");
    private final MainThreadExecutor executor;
    private final MapTileRenderer renderer;

    public MapTileHandler(MainThreadExecutor executor, MapTileRenderer renderer) {
        this.executor = executor;
        this.renderer = renderer;
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
            LOGGER.warning("[MapTileHandler] worldId=" + worldId + " 를 찾을 수 없음 (path="
                + exchange.getRequestURI().getPath() + ")");
            HttpUtil.sendError(exchange, 404, "월드를 찾을 수 없습니다: " + worldId);
            return;
        }

        Map<String, String> query = HttpUtil.parseQuery(exchange.getRequestURI().getRawQuery());
        int cx = parseIntOr(query.get("cx"), 0);
        int cz = parseIntOr(query.get("cz"), 0);

        try {
            byte[] png = executor.runSync(() -> renderer.render(world, cx, cz), 10_000);
            HttpUtil.sendBytes(exchange, 200, png, "image/png");
        } catch (Exception e) {
            LOGGER.severe("[MapTileHandler] world=" + worldId + " cx=" + cx + " cz=" + cz
                + " 요청 처리 실패: " + e);
            HttpUtil.sendError(exchange, 500, "타일 렌더링 실패: " + e.getMessage());
        }
    }

    private static int parseIntOr(String value, int fallback) {
        if (value == null || value.isEmpty()) {
            return fallback;
        }
        try {
            return Integer.parseInt(value);
        } catch (NumberFormatException e) {
            return fallback;
        }
    }
}
