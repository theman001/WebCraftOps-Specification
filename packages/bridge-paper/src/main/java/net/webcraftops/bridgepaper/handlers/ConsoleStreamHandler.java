package net.webcraftops.bridgepaper.handlers;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import net.webcraftops.bridgepaper.ConsoleBroadcaster;
import net.webcraftops.bridgepaper.HttpUtil;

import java.io.IOException;
import java.io.OutputStream;

// SSE로 콘솔 로그(챗 포함 — Paper가 기본적으로 챗을 콘솔에도 로깅한다)를 실시간 스트리밍한다.
// ponytail: 연결 하나당 스레드 하나를 점유한다(커넥션-스레드 모델) — 동시 구독자가 많아지면
// 가상 스레드/비동기로 바꿀 것. 지금은 관리자 몇 명이 여는 정도라 충분하다.
public final class ConsoleStreamHandler implements HttpHandler {
    private static final long PING_INTERVAL_MS = 15_000;

    private final ConsoleBroadcaster broadcaster;

    public ConsoleStreamHandler(ConsoleBroadcaster broadcaster) {
        this.broadcaster = broadcaster;
    }

    @Override
    public void handle(HttpExchange exchange) throws IOException {
        if (!"GET".equalsIgnoreCase(exchange.getRequestMethod())) {
            HttpUtil.sendError(exchange, 405, "GET만 지원합니다.");
            return;
        }
        exchange.getResponseHeaders().add("Content-Type", "text/event-stream; charset=utf-8");
        exchange.getResponseHeaders().add("Cache-Control", "no-store");
        exchange.getResponseHeaders().add("Connection", "keep-alive");
        exchange.sendResponseHeaders(200, 0);
        OutputStream out = exchange.getResponseBody();

        broadcaster.replayBacklogTo(out);
        broadcaster.subscribe(out);
        try {
            // SSE 주석(:)으로 주기적으로 핑을 보내 프록시/브라우저가 유휴 연결을 끊지 않게 한다.
            while (!Thread.currentThread().isInterrupted()) {
                synchronized (out) {
                    out.write(':');
                    out.write('\n');
                    out.write('\n');
                    out.flush();
                }
                Thread.sleep(PING_INTERVAL_MS);
            }
        } catch (IOException | InterruptedException e) {
            // 클라이언트가 연결을 끊은 정상 종료 경로.
        } finally {
            broadcaster.unsubscribe(out);
            exchange.close();
        }
    }
}
