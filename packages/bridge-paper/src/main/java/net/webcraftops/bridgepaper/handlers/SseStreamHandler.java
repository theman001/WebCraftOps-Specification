package net.webcraftops.bridgepaper.handlers;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import net.webcraftops.bridgepaper.HttpUtil;
import net.webcraftops.bridgepaper.SseBroadcaster;

import java.io.IOException;
import java.io.OutputStream;

// 범용 SSE 스트리밍 핸들러 — 콘솔 로그, 지도 타일 무효화 이벤트, 엔티티 스냅샷 전부 이걸
// SseBroadcaster 인스턴스만 바꿔서 재사용한다(셋 다 백로그 재생 + keep-alive 핑 + 구독
// 등록/해제 로직이 완전히 동일함).
// ponytail: 연결 하나당 스레드 하나를 점유한다(커넥션-스레드 모델) — 동시 구독자가 많아지면
// 가상 스레드/비동기로 바꿀 것. 지금은 관리자 몇 명이 여는 정도라 충분하다.
public final class SseStreamHandler implements HttpHandler {
    private static final long PING_INTERVAL_MS = 15_000;

    private final SseBroadcaster broadcaster;

    public SseStreamHandler(SseBroadcaster broadcaster) {
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
