package net.webcraftops.bridgepaper.handlers;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import net.webcraftops.bridgepaper.HttpUtil;

import java.io.IOException;
import java.util.logging.Logger;

// /bridge/world/{worldId}/... 아래 여러 엔드포인트(타일/타일 이벤트/엔티티 스트림)를
// 한 HttpServer 컨텍스트(/bridge/world/)로 받아서 경로 접미사로 나눠 보낸다 — worldId가
// 경로 중간의 가변 세그먼트라 com.sun.net.httpserver의 접두사 라우팅만으로는 못 나눈다.
//
// [디버깅] 매칭 안 되는 경로가 여기서 404로 조용히 죽지 않게 "[WorldRoute]"로 남긴다 —
// 프런트가 엉뚱한 경로를 치고 있는지 여기서 바로 보인다.
public final class WorldRouteHandler implements HttpHandler {
    private static final Logger LOGGER = Logger.getLogger("BridgePaper");
    private final HttpHandler mapTileHandler;
    private final HttpHandler mapEventsHandler;
    private final HttpHandler entityStreamHandler;

    public WorldRouteHandler(HttpHandler mapTileHandler, HttpHandler mapEventsHandler, HttpHandler entityStreamHandler) {
        this.mapTileHandler = mapTileHandler;
        this.mapEventsHandler = mapEventsHandler;
        this.entityStreamHandler = entityStreamHandler;
    }

    @Override
    public void handle(HttpExchange exchange) throws IOException {
        String path = exchange.getRequestURI().getPath();
        if (path.endsWith("/map/tile")) {
            mapTileHandler.handle(exchange);
            return;
        }
        if (path.endsWith("/map/events")) {
            mapEventsHandler.handle(exchange);
            return;
        }
        if (path.endsWith("/entities/stream")) {
            entityStreamHandler.handle(exchange);
            return;
        }
        LOGGER.warning("[WorldRoute] 매칭되는 핸들러 없음: " + path);
        HttpUtil.sendError(exchange, 404, "지원하지 않는 경로입니다.");
    }
}
