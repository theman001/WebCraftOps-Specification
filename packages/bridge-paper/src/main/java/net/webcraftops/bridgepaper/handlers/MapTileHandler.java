package net.webcraftops.bridgepaper.handlers;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import net.webcraftops.bridgepaper.HttpUtil;
import net.webcraftops.bridgepaper.MainThreadExecutor;
import net.webcraftops.bridgepaper.MapTileRenderer;
import org.bukkit.World;

import java.io.IOException;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Semaphore;
import java.util.logging.Logger;

// [실측 확인된 버그 → 수정] 지도 초기 로드 시 뷰포트에 걸친 청크 수십~수백 개가 한꺼번에
// 요청되면 그만큼의 렌더 작업이 메인 스레드 큐에 동시에 쌓여 Paper Watchdog 타임아웃
// (서버 강제 종료 → 재시작 반복)으로 이어지는 걸 실제 크래시 로그로 확인했다. 세마포어로
// 동시 렌더 개수를 제한해 — 초과분은 (메인 스레드가 아니라) 이 핸들러가 도는 스레드풀
// 워커에서 대기하므로 게임 자체는 안 막힌다.
//
// [디버깅] "[MapTileHandler]" 태그 — 요청이 실제로 여기까지 도달하는지(라우팅/토큰 문제
// 배제), worldId 파싱이 맞는지, 에러면 어떤 예외였는지를 남긴다.
public final class MapTileHandler implements HttpHandler {
    private static final Logger LOGGER = Logger.getLogger("BridgePaper");
    private static final Semaphore CONCURRENT_RENDER_LIMIT = new Semaphore(4);
    // 세마포어 획득 대기(시간 제한 없음) + 최대 10초 렌더까지, 타일 요청 하나가 스레드를
    // 오래 붙잡을 수 있다 — BridgeHttpServer의 공유 풀(짧은 요청 전용, 크기 제한됨)과
    // 같이 쓰면 줌아웃 폭주 때 콘솔 명령/스폰 조회처럼 전혀 무관한 요청까지 그 뒤에서
    // 오래 대기하게 된다(리뷰로 발견). 그래서 여기 전용 풀로 분리한다 — 세마포어(4)보다
    // 넉넉히 잡아 대기 중인 요청도 받아주되, 그 이상은 스레드를 새로 만드는 대신 이 풀
    // 자체의 큐에서 기다린다. 명시적으로 shutdown하지 않는다 — 이 프로젝트는 항상
    // 컨테이너 전체 재시작으로 배포되므로(BridgePaperPlugin.onDisable() 주석 참고) 굳이
    // 끌 필요가 없고, 잘못 끄면 그 뒤로 이 풀에 다시는 제출을 못 하게 된다.
    private static final ExecutorService TILE_EXECUTOR = Executors.newFixedThreadPool(16);
    private final MainThreadExecutor executor;
    private final MapTileRenderer renderer;

    public MapTileHandler(MainThreadExecutor executor, MapTileRenderer renderer) {
        this.executor = executor;
        this.renderer = renderer;
    }

    @Override
    public void handle(HttpExchange exchange) throws IOException {
        if (!"GET".equalsIgnoreCase(exchange.getRequestMethod())) {
            HttpUtil.sendError(exchange, 405, "GET만 지원합니다.");
            return;
        }
        // 여기서 리턴해서 공유 풀 스레드를 바로 반납한다 — 실제 처리(세마포어 대기 +
        // 렌더링)는 전용 풀에서 한다.
        TILE_EXECUTOR.submit(() -> handleTile(exchange));
    }

    private void handleTile(HttpExchange exchange) {
        String worldId = HttpUtil.resolveWorldId(exchange.getRequestURI().getPath());
        int cx = 0;
        int cz = 0;
        // handle()이 이제 즉시 리턴하고 여기서 비동기로 처리하므로, 예전(동기 handle())엔
        // 예외가 새면 프레임워크가 알아서 연결을 정리해줬던 안전망이 더 이상 안 걸린다 —
        // 응답을 두 번 쓰려다(성공 응답 쓰기 중 끊김 → catch에서 에러 응답도 실패) 실패해도
        // 연결이 안 닫힌 채 남을 수 있다. close()는 이미 닫혀도 안전하므로 무조건 끝에 한
        // 번 더 부른다.
        try {
            World world = HttpUtil.resolveWorld(worldId);
            if (world == null) {
                LOGGER.warning("[MapTileHandler] worldId=" + worldId + " 를 찾을 수 없음 (path="
                    + exchange.getRequestURI().getPath() + ")");
                HttpUtil.sendError(exchange, 404, "월드를 찾을 수 없습니다: " + worldId);
                return;
            }

            Map<String, String> query = HttpUtil.parseQuery(exchange.getRequestURI().getRawQuery());
            cx = parseIntOr(query.get("cx"), 0);
            cz = parseIntOr(query.get("cz"), 0);
            final int tileCx = cx;
            final int tileCz = cz;

            CONCURRENT_RENDER_LIMIT.acquire();
            try {
                byte[] png = executor.runSync(() -> renderer.render(world, tileCx, tileCz), 10_000);
                HttpUtil.sendBytes(exchange, 200, png, "image/png");
            } finally {
                CONCURRENT_RENDER_LIMIT.release();
            }
        } catch (InterruptedException e) {
            // 예전엔(동기 handle() 시절) 여기서 응답을 안 보내도 프레임워크가 알아서
            // 연결을 정리해줬는데, 지금은 별도 스레드에서 비동기로 처리하는 구조라 응답을
            // 안 쓰면 클라이언트가 그냥 계속 기다리게 된다(실측 확인) — 명시적으로 응답을
            // 보내야 한다.
            Thread.currentThread().interrupt();
            trySendError(exchange, 503, "요청 처리 중 인터럽트됨");
        } catch (Exception e) {
            LOGGER.severe("[MapTileHandler] world=" + worldId + " cx=" + cx + " cz=" + cz
                + " 요청 처리 실패: " + e);
            trySendError(exchange, 500, "타일 렌더링 실패: " + e.getMessage());
        } finally {
            exchange.close();
        }
    }

    // 이미 응답 헤더를 일부 쓴 뒤라 에러 응답 자체가 또 실패할 수 있다(연결이 이미
    // 끊겼거나 헤더가 이미 나간 경우) — 그때는 조용히 넘어간다(어차피 finally에서
    // exchange.close()가 정리한다).
    private static void trySendError(HttpExchange exchange, int status, String message) {
        try {
            HttpUtil.sendError(exchange, status, message);
        } catch (IOException ignored) {
            // 위 주석 참고.
        }
    }

    private static int parseIntOr(String value, int fallback) {
        if (value == null || value.isEmpty()) {
            return fallback;
        }
        try {
            return Integer.parseInt(value);
        } catch (NumberFormatException e) {
            return fallback;
        }
    }
}
