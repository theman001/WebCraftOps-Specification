package net.webcraftops.bridgepaper.handlers;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import net.webcraftops.bridgepaper.HttpUtil;
import net.webcraftops.bridgepaper.Json;
import net.webcraftops.bridgepaper.MainThreadExecutor;
import org.bukkit.Bukkit;
import org.bukkit.World;

import java.io.IOException;
import java.util.List;
import java.util.logging.Logger;

// GET /bridge/worlds — 서버에 실제로 존재하는 월드 목록(id/차원 종류)을 돌려준다. 프런트가
// 네더/엔드 월드 이름을 "world_nether"처럼 하드코딩해서 추측하지 않고, level-name 설정에
// 따라 달라질 수 있는 진짜 worldId를 여기서 받아 그대로 /bridge/world/{worldId}/... 에 쓴다.
public final class WorldsHandler implements HttpHandler {
    private static final Logger LOGGER = Logger.getLogger("BridgePaper");
    private final MainThreadExecutor executor;

    public WorldsHandler(MainThreadExecutor executor) {
        this.executor = executor;
    }

    @Override
    public void handle(HttpExchange exchange) throws IOException {
        if (!"GET".equalsIgnoreCase(exchange.getRequestMethod())) {
            HttpUtil.sendError(exchange, 405, "GET만 지원합니다.");
            return;
        }
        try {
            List<World> worlds = executor.runSync(Bukkit::getWorlds, 5_000);
            StringBuilder json = new StringBuilder("[");
            for (int i = 0; i < worlds.size(); i++) {
                World world = worlds.get(i);
                if (i > 0) json.append(",");
                json.append("{\"id\":\"").append(Json.escape(world.getName()))
                    .append("\",\"environment\":\"").append(world.getEnvironment().name())
                    // World가 Keyed를 구현해서 얻는 실제 디멘션 키(예: "minecraft:overworld") —
                    // /execute in <dimension> 명령이 요구하는 값과 정확히 같다. environment로
                    // 유추하면 커스텀 차원이나 같은 환경의 월드가 여러 개일 때 틀릴 수 있어서
                    // 여기서 실제 값을 그대로 내려준다.
                    .append("\",\"dimensionKey\":\"").append(Json.escape(world.getKey().toString()))
                    .append("\"}");
            }
            json.append("]");
            HttpUtil.sendJson(exchange, 200, json.toString());
        } catch (Exception e) {
            LOGGER.severe("[Worlds] 목록 조회 실패: " + e);
            HttpUtil.sendError(exchange, 500, "월드 목록 조회 실패: " + e.getMessage());
        }
    }
}
