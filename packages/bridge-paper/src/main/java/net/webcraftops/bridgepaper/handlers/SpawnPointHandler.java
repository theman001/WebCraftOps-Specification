package net.webcraftops.bridgepaper.handlers;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import net.webcraftops.bridgepaper.HttpUtil;
import net.webcraftops.bridgepaper.MainThreadExecutor;
import org.bukkit.Location;
import org.bukkit.World;

import java.io.IOException;
import java.util.logging.Logger;

// GET /bridge/world/{worldId}/spawn — 월드 스폰포인트 좌표. 지도에 스폰 지점을 고정
// 핀으로 표시하고, 지도 밖 텍스트로도 참고용으로 보여주는 데 쓴다.
public final class SpawnPointHandler implements HttpHandler {
    private static final Logger LOGGER = Logger.getLogger("BridgePaper");
    private final MainThreadExecutor executor;

    public SpawnPointHandler(MainThreadExecutor executor) {
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
        try {
            Location spawn = executor.runSync(world::getSpawnLocation, 5_000);
            String json = "{\"x\":" + spawn.getX() + ",\"y\":" + spawn.getY() + ",\"z\":" + spawn.getZ() + "}";
            HttpUtil.sendJson(exchange, 200, json);
        } catch (Exception e) {
            LOGGER.severe("[SpawnPoint] world=" + worldId + " 조회 실패: " + e);
            HttpUtil.sendError(exchange, 500, "스폰포인트 조회 실패: " + e.getMessage());
        }
    }
}
