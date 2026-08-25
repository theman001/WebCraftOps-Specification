package net.webcraftops.bridgepaper;

import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;
import net.webcraftops.bridgepaper.handlers.ChunksHandler;
import net.webcraftops.bridgepaper.handlers.CommandHandler;
import net.webcraftops.bridgepaper.handlers.ConsoleCommandHandler;
import net.webcraftops.bridgepaper.handlers.ConsoleStreamHandler;
import net.webcraftops.bridgepaper.handlers.InfoHandler;
import net.webcraftops.bridgepaper.handlers.RegistryHandler;

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
            ConsoleBroadcaster consoleBroadcaster
    ) throws IOException {
        MainThreadExecutor executor = new MainThreadExecutor(plugin);
        server = HttpServer.create(new InetSocketAddress(bindAddress, port), 0);
        server.createContext("/bridge/info", wrap(token, new InfoHandler(plugin)));
        server.createContext("/bridge/registry/blocks", wrap(token, new RegistryHandler()));
        server.createContext("/bridge/world/", wrap(token, new ChunksHandler(executor))); // worldId는 핸들러가 경로에서 직접 파싱
        server.createContext("/bridge/command", wrap(token, new CommandHandler(executor)));
        server.createContext("/bridge/console/stream", wrap(token, new ConsoleStreamHandler(consoleBroadcaster)));
        server.createContext("/bridge/console/command", wrap(token, new ConsoleCommandHandler(executor)));
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
