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
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class BridgeHttpServer {
    private final HttpServer server;
    private final ExecutorService dispatchExecutor;

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
        // [실측 확인된 문제] newCachedThreadPool은 스레드 수 상한이 없다 — 지도 타일 렌더링
        // 자체는 세마포어(MapTileHandler)로 동시 4개까지만 제한되지만, 그건 "메인 스레드로
        // 넘어가는 작업"만 제한할 뿐 "요청을 받아 처리하는 스레드"는 여전히 요청 수만큼
        // 무제한으로 생겼다 — 지도를 빠르게 줌아웃하면 타일 요청이 순간적으로 수백 개까지
        // 튈 수 있는데, 그때마다 스레드가 그만큼 새로 생겨 세마포어 앞에서 대기하며 서버에
        // 불필요한 부담을 줬다. 고정 크기 풀로 바꿔서 스레드 수 자체를 못 넘게 막는다 —
        // 초과분은 스레드를 새로 만드는 대신 큐에서 대기한다(거부되지 않음, 응답만 늦어짐).
        // SSE 연결(콘솔/지도이벤트/엔티티)은 수명 내내 스레드를 붙잡는데, 이 풀에서 돌면
        // 관리자 탭 몇 개만 열려있어도 이 풀이 SSE만으로 다 차서 타일 요청 같은 일반 요청이
        // 전부 막힐 수 있다 — 그래서 SseStreamHandler가 자기 전용 풀로 즉시 넘기고 여기
        // 스레드는 곧바로 반납한다(리뷰로 발견). 이 풀은 순간적으로 몰리는 타일 요청 같은
        // 짧게 끝나는 요청만 상대하므로 64개로도 충분히 여유롭다.
        //
        // SSE_EXECUTOR/TILE_EXECUTOR(static, 여러 BridgePaperPlugin 인스턴스가 공유)와
        // 달리 이건 이 BridgeHttpServer 인스턴스 하나에만 속한다 — 리로드마다 새
        // BridgeHttpServer가 새 executor를 만들므로, stop()에서 이걸 꺼도 "다시는 못 쓰게
        // 되는" 문제가 없다. newFixedThreadPool은 newCachedThreadPool과 달리 유휴여도
        // 스레드가 스스로 안 죽으므로, 안 끄면 리로드마다 64개씩 쌓인다 — 반드시 끈다.
        dispatchExecutor = Executors.newFixedThreadPool(64);
        server.setExecutor(dispatchExecutor);
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
        dispatchExecutor.shutdownNow();
    }
}
