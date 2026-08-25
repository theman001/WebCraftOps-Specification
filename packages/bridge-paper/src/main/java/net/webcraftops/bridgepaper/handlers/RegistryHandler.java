package net.webcraftops.bridgepaper.handlers;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import net.webcraftops.bridgepaper.HttpUtil;
import net.webcraftops.bridgepaper.Json;
import org.bukkit.Material;

import java.io.IOException;
import java.time.Instant;

// Fabric 스타일 전체 상태-프로퍼티 추출은 하지 않는다(스펙 §6.2.3: 렌더 힌트는
// 정확도보다 사용성 우선). Material 기반 best-effort renderHint만 채운다.
public final class RegistryHandler implements HttpHandler {
    @Override
    public void handle(HttpExchange exchange) throws IOException {
        if (!"GET".equalsIgnoreCase(exchange.getRequestMethod())) {
            HttpUtil.sendError(exchange, 405, "GET만 지원합니다.");
            return;
        }
        StringBuilder sb = new StringBuilder();
        sb.append("{\"blocks\":[");
        boolean first = true;
        for (Material material : Material.values()) {
            if (!material.isBlock() || material.isAir() || material.isLegacy()) {
                continue;
            }
            if (!first) {
                sb.append(',');
            }
            first = false;
            String id = "minecraft:" + material.name().toLowerCase();
            sb.append("{\"id\":\"").append(Json.escape(id)).append("\",")
                .append("\"properties\":{},\"defaultState\":{},")
                .append("\"renderHint\":{\"type\":\"").append(renderHint(material)).append("\"}}");
        }
        sb.append("],\"generatedAt\":\"").append(Instant.now()).append("\"}");
        HttpUtil.sendJson(exchange, 200, sb.toString());
    }

    private static String renderHint(Material material) {
        String name = material.name();
        if (material == Material.WATER || material == Material.LAVA) {
            return "fluid";
        }
        if (name.contains("SLAB")) {
            return "slab";
        }
        if (name.contains("STAIRS")) {
            return "stairs";
        }
        if (name.contains("PANE") || name.contains("BARS")) {
            return "pane";
        }
        if (name.contains("SAPLING") || name.contains("FLOWER") || name.contains("CROP")
            || name.contains("MUSHROOM") || name.equals("GRASS") || name.equals("FERN")) {
            return "cross";
        }
        return "cube";
    }
}
