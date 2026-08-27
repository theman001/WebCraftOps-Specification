package net.webcraftops.bridgepaper;

import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;
import net.webcraftops.bridgepaper.handlers.ConsoleCommandHandler;
import net.webcraftops.bridgepaper.handlers.HeightmapHandler;
import net.webcraftops.bridgepaper.handlers.InfoHandler;
import net.webcraftops.bridgepaper.handlers.MapTileHandler;
import net.webcraftops.bridgepaper.handlers.PlayerHeadHandler;
import net.webcraftops.bridgepaper.handlers.RegistryHandler;
import net.webcraftops.bridgepaper.handlers.SpawnPointHandler;
import net.webcraftops.bridgepaper.handlers.SseStreamHandler;
import net.webcraftops.bridgepaper.handlers.WorldRouteHandler;
import net.webcraftops.bridgepaper.handlers.WorldsHandler;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.util.concurrent.Executors;

public final class BridgeHttpServer {
    private final HttpServer server;

    public BridgeHttpServer(
            BridgePaperPlugin plugin,
            int port,
            String bindAddress,
            String token,
            SseBroadcaster consoleBroadcaster,
            MapTileRenderer mapTileRenderer,
            SseBroadcaster mapEventsBroadcaster,
            SseBroadcaster entitySnapshotBroadcaster
    ) throws IOException {
        MainThreadExecutor executor = new MainThreadExecutor(plugin);
        server = HttpServer.create(new InetSocketAddress(bindAddress, port), 0);
        server.createContext("/bridge/info", wrap(token, new InfoHandler(plugin)));
        server.createContext("/bridge/registry/blocks", wrap(token, new RegistryHandler()));
        WorldRouteHandler worldRoute = new WorldRouteHandler(
            new MapTileHandler(executor, mapTileRenderer),
            new SseStreamHandler(mapEventsBroadcaster),
            new SseStreamHandler(entitySnapshotBroadcaster),
            new SpawnPointHandler(executor),
            new HeightmapHandler(executor)
        );
        server.createContext("/bridge/world/", wrap(token, worldRoute)); // worldId는 핸들러가 경로에서 직접 파싱
        server.createContext("/bridge/worlds", wrap(token, new WorldsHandler(executor))); // 네더/엔드 등 실제 월드 목록
        server.createContext("/bridge/console/stream", wrap(token, new SseStreamHandler(consoleBroadcaster)));
        server.createContext("/bridge/console/command", wrap(token, new ConsoleCommandHandler(executor)));
        server.createContext("/bridge/players/", wrap(token, new PlayerHeadHandler()));
        // SSE 연결은 응답 없이 계속 열려있으므로 캐시드 풀이 스레드를 계속 새로 만들어 감당한다.
        server.setExecutor(Executors.newCachedThreadPool());
    }

    private HttpHandler wrap(String token, HttpHandler inner) {
        return exchange -> {
            String given = exchange.getRequestHeaders().getFirst("X-Bridge-Token");
            if (token != null && !token.isEmpty() && !token.equals(given)) {
                HttpUtil.sendError(exchange, 401, "invalid token");
                return;
            }
            inner.handle(exchange);
        };
    }

    public void start() {
        server.start();
    }

    public void stop() {
        server.stop(0);
    }
}
