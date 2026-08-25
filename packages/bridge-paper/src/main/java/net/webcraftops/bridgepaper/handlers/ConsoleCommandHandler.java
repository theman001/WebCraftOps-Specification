package net.webcraftops.bridgepaper.handlers;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import net.webcraftops.bridgepaper.HttpUtil;
import net.webcraftops.bridgepaper.Json;
import net.webcraftops.bridgepaper.MainThreadExecutor;
import org.bukkit.Bukkit;

import java.io.IOException;
import java.util.Map;

// 콘솔(관리자) 권한으로 명령어를 실행한다. 실행 로그/에러는 서버가 알아서 콘솔에 찍고,
// 그게 ConsoleBroadcaster를 통해 SSE로 나가므로 여기서는 별도 결과 페이로드가 필요 없다.
public final class ConsoleCommandHandler implements HttpHandler {
    private final MainThreadExecutor executor;

    public ConsoleCommandHandler(MainThreadExecutor executor) {
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

        String command = (String) body.get("command");
        if (command == null || command.isBlank()) {
            HttpUtil.sendError(exchange, 400, "command가 필요합니다.");
            return;
        }
        String finalCommand = command.startsWith("/") ? command.substring(1) : command;

        try {
            executor.runSync(() -> {
                Bukkit.dispatchCommand(Bukkit.getConsoleSender(), finalCommand);
                return null;
            }, 5_000);
            HttpUtil.sendJson(exchange, 200, "{\"ok\":true}");
        } catch (Exception e) {
            HttpUtil.sendError(exchange, 500, "명령어 실행 실패: " + e.getMessage());
        }
    }
}
