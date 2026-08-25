package net.webcraftops.bridgepaper.handlers;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import net.webcraftops.bridgepaper.ChunkEncoder;
import net.webcraftops.bridgepaper.HttpUtil;
import net.webcraftops.bridgepaper.MainThreadExecutor;
import org.bukkit.Bukkit;
import org.bukkit.World;

import java.io.IOException;
import java.util.Map;

public final class ChunksHandler implements HttpHandler {
    private final MainThreadExecutor executor;

    public ChunksHandler(MainThreadExecutor executor) {
        this.executor = executor;
    }

    @Override
    public void handle(HttpExchange exchange) throws IOException {
        if (!"GET".equalsIgnoreCase(exchange.getRequestMethod())) {
            HttpUtil.sendError(exchange, 405, "GET만 지원합니다.");
            return;
        }

        String path = exchange.getRequestURI().getPath();
        if (!path.endsWith("/chunks")) {
            HttpUtil.sendError(exchange, 404, "지원하지 않는 경로입니다.");
            return;
        }
        // 기대 경로: /bridge/world/{worldId}/chunks
        String[] parts = path.split("/");
        String worldId = null;
        for (int i = 0; i < parts.length; i++) {
            if ("world".equals(parts[i]) && i + 1 < parts.length) {
                worldId = parts[i + 1];
                break;
            }
        }
        if (worldId == null) {
            HttpUtil.sendError(exchange, 404, "지원하지 않는 경로입니다.");
            return;
        }

        // 백엔드/mock 서버 관례상 "overworld"라는 리터럴을 쓰지만 실제 Bukkit 월드 이름이
        // 아니므로, 기본(첫 번째) 월드의 별칭으로 취급한다.
        World world = "overworld".equals(worldId) ? Bukkit.getWorlds().get(0) : Bukkit.getWorld(worldId);
        if (world == null) {
            HttpUtil.sendError(exchange, 404, "월드를 찾을 수 없습니다: " + worldId);
            return;
        }

        Map<String, String> query = HttpUtil.parseQuery(exchange.getRequestURI().getRawQuery());
        String radiusStr = query.get("radius");
        if (radiusStr != null && parseIntOr(radiusStr, 0) > 0) {
            HttpUtil.sendError(exchange, 400, "radius>0 미구현: 유선 포맷은 단일 청크만 인코딩합니다.");
            return;
        }
        int cx = parseIntOr(query.get("cx"), 0);
        int cz = parseIntOr(query.get("cz"), 0);

        try {
            byte[] bytes = executor.runSync(() -> ChunkEncoder.encode(world, cx, cz), 10_000);
            HttpUtil.sendBytes(exchange, 200, bytes, "application/octet-stream");
        } catch (Exception e) {
            HttpUtil.sendError(exchange, 500, "청크 인코딩 실패: " + e.getMessage());
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
