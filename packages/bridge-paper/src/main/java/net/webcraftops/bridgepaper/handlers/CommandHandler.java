package net.webcraftops.bridgepaper.handlers;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import net.webcraftops.bridgepaper.HttpUtil;
import net.webcraftops.bridgepaper.Json;
import net.webcraftops.bridgepaper.MainThreadExecutor;
import org.bukkit.Bukkit;
import org.bukkit.Material;
import org.bukkit.World;

import java.io.IOException;
import java.util.List;
import java.util.Map;

// packages/backend/src/edit-jobs.ts의 sendToBridge가 보내는 {type, params, mode} 계약을
// 그대로 받는다. 백엔드는 이 엔드포인트가 한 커맨드를 동기적으로 실행하고 성공/실패를
// 정확히 반환하리라 기대한다 — 조용히 성공한 척하는 것(오늘 이미 겪은 버그)은 금지.
public final class CommandHandler implements HttpHandler {
    private final MainThreadExecutor executor;

    public CommandHandler(MainThreadExecutor executor) {
        this.executor = executor;
    }

    @Override
    @SuppressWarnings("unchecked")
    public void handle(HttpExchange exchange) throws IOException {
        if (!"POST".equalsIgnoreCase(exchange.getRequestMethod())) {
            HttpUtil.sendError(exchange, 405, "POST만 지원합니다.");
            return;
        }

        Map<String, Object> body;
        try {
            body = (Map<String, Object>) Json.parse(HttpUtil.readBody(exchange));
        } catch (Exception e) {
            HttpUtil.sendError(exchange, 400, "JSON 파싱 실패: " + e.getMessage());
            return;
        }

        String type = (String) body.get("type");
        String mode = body.containsKey("mode") && body.get("mode") != null ? (String) body.get("mode") : "apply";
        Map<String, Object> params = (Map<String, Object>) body.get("params");
        if (type == null || params == null) {
            HttpUtil.sendError(exchange, 400, "type과 params가 필요합니다.");
            return;
        }

        if ("revert".equals(mode) && "setBlock".equals(type)) {
            HttpUtil.sendError(exchange, 501, "setBlock revert 미구현: 이전 블록 정보가 payload에 없습니다.");
            return;
        }

        World world = Bukkit.getWorlds().get(0);

        try {
            switch (type) {
                case "setBlock":
                    handleSetBlock(exchange, world, params);
                    return;
                case "fill":
                    handleFill(exchange, world, params);
                    return;
                default:
                    HttpUtil.sendError(exchange, 501, type + "은(는) bridge-paper v1에서 미구현입니다.");
            }
        } catch (Exception e) {
            HttpUtil.sendError(exchange, 500, "커맨드 실행 실패: " + e.getMessage());
        }
    }

    private void handleSetBlock(HttpExchange exchange, World world, Map<String, Object> params) throws Exception {
        List<Object> pos = (List<Object>) params.get("pos");
        Material material = resolveMaterial((String) params.get("block"));
        if (pos == null || pos.size() != 3 || material == null) {
            HttpUtil.sendError(exchange, 400, "pos([x,y,z])와 유효한 block이 필요합니다.");
            return;
        }
        int x = toInt(pos.get(0));
        int y = toInt(pos.get(1));
        int z = toInt(pos.get(2));
        executor.runSync(() -> {
            world.getBlockAt(x, y, z).setType(material);
            return null;
        }, 5_000);
        HttpUtil.sendJson(exchange, 200, "{\"ok\":true,\"type\":\"setBlock\"}");
    }

    private void handleFill(HttpExchange exchange, World world, Map<String, Object> params) throws Exception {
        List<Object> from = (List<Object>) params.get("from");
        List<Object> to = (List<Object>) params.get("to");
        Material material = resolveMaterial((String) params.get("block"));
        if (from == null || to == null || from.size() != 3 || to.size() != 3 || material == null) {
            HttpUtil.sendError(exchange, 400, "from/to([x,y,z])와 유효한 block이 필요합니다.");
            return;
        }
        int x1 = toInt(from.get(0));
        int y1 = toInt(from.get(1));
        int z1 = toInt(from.get(2));
        int x2 = toInt(to.get(0));
        int y2 = toInt(to.get(1));
        int z2 = toInt(to.get(2));
        // ponytail: 대형 fill 볼륨 상한 없음 — 틱 프리즈가 실제 문제가 되면 최대 볼륨 가드 추가.
        executor.runSync(() -> {
            for (int x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) {
                for (int y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) {
                    for (int z = Math.min(z1, z2); z <= Math.max(z1, z2); z++) {
                        world.getBlockAt(x, y, z).setType(material);
                    }
                }
            }
            return null;
        }, 30_000);
        HttpUtil.sendJson(exchange, 200, "{\"ok\":true,\"type\":\"fill\"}");
    }

    private static Material resolveMaterial(String blockId) {
        if (blockId == null) {
            return null;
        }
        String key = blockId.contains(":") ? blockId.substring(blockId.indexOf(':') + 1) : blockId;
        return Material.matchMaterial(key);
    }

    private static int toInt(Object value) {
        return ((Number) value).intValue();
    }
}
