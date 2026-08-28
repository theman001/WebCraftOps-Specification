package net.webcraftops.bridgepaper.handlers;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import net.webcraftops.bridgepaper.HttpUtil;
import net.webcraftops.bridgepaper.SseBroadcaster;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

// 범용 SSE 스트리밍 핸들러 — 콘솔 로그, 지도 타일 무효화 이벤트, 엔티티 스냅샷 전부 이걸
// SseBroadcaster 인스턴스만 바꿔서 재사용한다(셋 다 백로그 재생 + keep-alive 핑 + 구독
// 등록/해제 로직이 완전히 동일함).
//
// 연결 하나당 스레드 하나가 수명 내내 붙는다(SseBroadcaster.subscribe()가 준 큐를
// 타임아웃과 함께 폴링) — 그래서 이 스레드는 BridgeHttpServer의 공유 풀(짧게 끝나는
// 일반 요청 전용, 크기 제한됨)이 아니라 여기 전용 풀에서 돈다. 공유 풀에서 돌았다면
// 관리자 탭을 몇 개만 열어놔도(탭 하나당 SSE 3개: 콘솔/지도이벤트/엔티티) 그 풀이 SSE
// 연결만으로 꽉 차서 타일 로딩 같은 일반 요청이 전부 막힐 수 있었다(실측 리뷰로 발견).
// SSE 연결 수는 "관리자가 연 탭 수"로 자연히 제한되는 값이라(타일 요청처럼 한 번에
// 수백 개씩 몰리는 폭주 종류가 아님) 여기는 무제한 풀이어도 안전하다.
public final class SseStreamHandler implements HttpHandler {
    private static final long PING_INTERVAL_MS = 15_000;
    // 명시적으로 shutdown하지 않는다 — MapTileHandler.TILE_EXECUTOR와 같은 이유
    // (BridgePaperPlugin.onDisable() 주석 참고): 이 프로젝트는 컨테이너 전체 재시작으로
    // 배포되므로 안 꺼도 문제없고, 잘못 끄면 그 뒤로 다시는 이 풀에 제출을 못 한다.
    // 크기는 관리자 탭 수 기준으로 넉넉하게(128) 잡아둔다 — cached(무제한)로 두면 접속이
    // 안 끊기고 계속 재연결을 시도하는 등의 상황에서 스레드가 끝없이 늘 수 있는데, 그건
    // 이 파일이 애초에 고치려던 것과 같은 종류의 문제라 여기도 상한을 둔다.
    private static final ExecutorService SSE_EXECUTOR = Executors.newFixedThreadPool(128);

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
        // 여기서 리턴해서 공유 풀 스레드를 바로 반납한다 — exchange는 이 요청을 접수한
        // 스레드가 아니라 SSE 전용 풀의 스레드가 나중에 close()할 때까지 계속 열려있는다
        // (com.sun.net.httpserver가 지원하는 정상적인 비동기 패턴).
        SSE_EXECUTOR.submit(() -> streamLoop(exchange));
    }

    private void streamLoop(HttpExchange exchange) {
        // out 획득/구독 자체도 try 안에 넣는다 — handle()이 이제 즉시 리턴하고 여기서
        // 비동기로 처리하므로(MapTileHandler와 같은 이유), try 밖에서 뭔가 던지면
        // exchange.close()가 전혀 안 불려서 클라이언트가 계속 매달리게 된다.
        OutputStream out = null;
        try {
            out = exchange.getResponseBody();
            BlockingQueue<String> queue = broadcaster.subscribe(out);
            // com.sun.net.httpserver는 청크 응답의 헤더를 첫 body write 전까지 실제로
            // 흘려보내지 않는다(실측 확인) — 그 첫 write를 이벤트가 생길 때까지(최대
            // PING_INTERVAL_MS) 기다리면, 조용한 스트림(지도 변경 이벤트처럼 드문 경우)에
            // 접속한 클라이언트의 EventSource onopen이 그만큼 늦게 뜬다("연결 중..."이
            // 계속 떠 있는 것처럼 보임). 그래서 연결하자마자 핑을 한 번 즉시 흘려보낸다.
            out.write(':');
            out.write('\n');
            out.write('\n');
            out.flush();
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
            // 클라이언트가 연결을 끊은 정상 종료 경로(또는 구독 준비 중 실패).
        } finally {
            if (out != null) {
                broadcaster.unsubscribe(out);
            }
            exchange.close();
        }
    }
}
