package net.webcraftops.bridgepaper;

import com.sun.net.httpserver.HttpExchange;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;

public final class HttpUtil {
    private HttpUtil() {}

    public static String readBody(HttpExchange exchange) throws IOException {
        InputStream in = exchange.getRequestBody();
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        byte[] chunk = new byte[4096];
        int read;
        while ((read = in.read(chunk)) != -1) {
            buffer.write(chunk, 0, read);
        }
        return buffer.toString(StandardCharsets.UTF_8);
    }

    public static void sendJson(HttpExchange exchange, int status, String json) throws IOException {
        sendBytes(exchange, status, json.getBytes(StandardCharsets.UTF_8), "application/json; charset=utf-8");
    }

    public static void sendBytes(HttpExchange exchange, int status, byte[] body, String contentType) throws IOException {
        exchange.getResponseHeaders().add("Content-Type", contentType);
        exchange.sendResponseHeaders(status, body.length);
        exchange.getResponseBody().write(body);
        exchange.close();
    }

    public static void sendError(HttpExchange exchange, int status, String message) throws IOException {
        sendJson(exchange, status, "{\"ok\":false,\"error\":\"" + Json.escape(message) + "\"}");
    }

    public static Map<String, String> parseQuery(String rawQuery) {
        Map<String, String> result = new LinkedHashMap<>();
        if (rawQuery == null || rawQuery.isEmpty()) {
            return result;
        }
        for (String pair : rawQuery.split("&")) {
            int eq = pair.indexOf('=');
            if (eq < 0) {
                result.put(decode(pair), "");
            } else {
                result.put(decode(pair.substring(0, eq)), decode(pair.substring(eq + 1)));
            }
        }
        return result;
    }

    private static String decode(String s) {
        return java.net.URLDecoder.decode(s, StandardCharsets.UTF_8);
    }

    // 기대 경로 형태: /bridge/world/{worldId}/... — "world" 세그먼트 바로 다음 값을 뽑는다.
    // 여러 핸들러(청크였던 시절부터 지도 타일, 엔티티 스트림까지)가 공통으로 쓰는 파싱이라
    // 한 곳에 모아둔다.
    public static String resolveWorldId(String path) {
        String[] parts = path.split("/");
        for (int i = 0; i < parts.length; i++) {
            if ("world".equals(parts[i]) && i + 1 < parts.length) {
                return parts[i + 1];
            }
        }
        return null;
    }

    // 백엔드/mock 서버 관례상 "overworld"라는 리터럴을 쓰지만 실제 Bukkit 월드 이름이
    // 아니므로, 기본(첫 번째) 월드의 별칭으로 취급한다.
    public static org.bukkit.World resolveWorld(String worldId) {
        if (worldId == null) {
            return null;
        }
        return "overworld".equals(worldId)
            ? org.bukkit.Bukkit.getWorlds().get(0)
            : org.bukkit.Bukkit.getWorld(worldId);
    }
}
