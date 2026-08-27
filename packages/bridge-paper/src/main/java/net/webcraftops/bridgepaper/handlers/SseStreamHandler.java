package net.webcraftops.bridgepaper.handlers;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import net.webcraftops.bridgepaper.HttpUtil;
import net.webcraftops.bridgepaper.SseBroadcaster;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.TimeUnit;

// 범용 SSE 스트리밍 핸들러 — 콘솔 로그, 지도 타일 무효화 이벤트, 엔티티 스냅샷 전부 이걸
// SseBroadcaster 인스턴스만 바꿔서 재사용한다(셋 다 백로그 재생 + keep-alive 핑 + 구독
// 등록/해제 로직이 완전히 동일함).
//
// 연결 하나당 이 스레드 하나가 전부다 — SseBroadcaster.subscribe()가 준 큐를 타임아웃과
// 함께 폴링해서, 메시지가 오면 그걸 쓰고 없으면(타임아웃) 핑을 쓴다. 그래서 broadcast()를
// 부르는 쪽(메인 스레드 포함)은 큐에 넣기만 하고 절대 이 소켓 쓰기를 기다리지 않는다.
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

        BlockingQueue<String> queue = broadcaster.subscribe(out);
        try {
            while (!Thread.currentThread().isInterrupted()) {
                String line = queue.poll(PING_INTERVAL_MS, TimeUnit.MILLISECONDS);
                if (line != null) {
                    out.write(("data: " + line.replace("\n", "\ndata: ") + "\n\n").getBytes(StandardCharsets.UTF_8));
                } else {
                    out.write(':');
                    out.write('\n');
                    out.write('\n');
                }
                out.flush();
            }
        } catch (IOException | InterruptedException e) {
            // 클라이언트가 연결을 끊은 정상 종료 경로.
        } finally {
            broadcaster.unsubscribe(out);
            exchange.close();
        }
    }
}
