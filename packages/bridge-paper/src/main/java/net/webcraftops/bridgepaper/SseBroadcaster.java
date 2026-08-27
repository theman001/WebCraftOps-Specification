package net.webcraftops.bridgepaper;

import java.io.OutputStream;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Map;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.LinkedBlockingQueue;

// SSE 구독자에게 줄 단위 메시지를 실시간 브로드캐스트하는 범용 클래스(콘솔 로그, 지도
// 타일 무효화 이벤트, 엔티티 스냅샷 셋 다 이걸 인스턴스만 나눠서 쓴다). 최근 N줄은
// 버퍼에 남겨뒀다가 새 구독자가 연결되는 즉시 재생해 빈 화면으로 시작하지 않게 한다.
//
// [수정: 라운드 1] 백로그 크기를 생성자로 받게 했다 — 콘솔 로그는 히스토리가 유용해서
// 500줄이 맞지만, 엔티티 스냅샷(300ms마다 전체 좌표 재전송)은 "히스토리"가 아니라
// "최신 상태"만 의미 있다. 500개를 그대로 재생하면 새 구독자가 접속하자마자 최대 150초
// 치 과거 위치를 폭풍처럼 다시 받게 된다 — 엔티티 스냅샷은 반드시 1로 생성할 것.
//
// [수정: 라운드 2~5 — 실제 서버 프리즈 사고, 이후 여러 차례 재검토] broadcast()는 콘솔
// 출력(TeeOutputStream/ConsoleLogAppender)과 EntitySnapshotBroadcaster(메인 스레드!)에서도
// 호출된다. 예전엔 구독자 OutputStream에 동기로 write()/flush()를 했는데, 응답 없는 SSE
// 클라이언트 하나(예: 브라우저가 정상 종료 없이 죽어서 TCP 소켓만 남은 경우)가 있으면 그
// write()가 무한정 블록될 수 있고, 하필 이게 메인 스레드에서 불리면 서버 전체가 그대로
// 멈춰서 Watchdog에 의해 강제 재시작되는 사고가 있었다. 여러 라운드에 걸쳐 "브로드캐스트
// 호출자와 별도로 소켓 쓰기 스레드를 둔다"는 방향으로 고치다가(전용 스레드풀, 큐 상한,
// RejectedExecutionHandler 등) 매번 새로운 경합/누수가 나왔다 — 스레드/실행기 생명주기를
// broadcast() 쪽과 연결 쪽 양쪽에서 따로 관리하다 보니 그 자체가 복잡도의 근원이었다.
//
// [수정: 라운드 6 — 재설계] SseStreamHandler는 애초에 연결 하나당 전용 스레드를 이미
// 하나 갖고 있다(핑 루프). 여기서 스레드를 "또" 만드는 대신, 그 기존 스레드가 소켓에
// 쓸 메시지를 꺼내가는 큐만 이 클래스가 들고 있는다 — broadcast()는 그 큐에 넣기만
// (offer, 절대 안 기다림) 하고, 실제 소켓 쓰기는 전부 SseStreamHandler의 기존 스레드가
// 큐를 폴링하며 한다. 이러면: (1) 이 클래스는 스레드/실행기를 하나도 안 만들고 안 관리
// 하니 생명주기 버그가 원천적으로 없고, (2) 같은 구독자로 가는 메시지는 큐라 순서가
// 보장되고, (3) 느리거나 멈춘 소켓은 딱 자기 큐/자기 연결 스레드에만 영향을 주고 다른
// 구독자나 broadcast() 호출자(메인 스레드 포함)에는 전혀 영향이 없다.
public final class SseBroadcaster {
    private final int backlogSize;
    private final Map<OutputStream, BlockingQueue<String>> subscribers = new ConcurrentHashMap<>();
    private final Deque<String> backlog = new ArrayDeque<>();

    public SseBroadcaster() {
        this(500);
    }

    public SseBroadcaster(int backlogSize) {
        this.backlogSize = backlogSize;
    }

    // 백로그 재생 + 구독 등록을 한 번에 원자적으로 한다 — 예전엔 이 둘이 별개 호출이라
    // (replayBacklogTo 다음에 subscribe) 그 사이에 broadcast()가 끼어들면 그 한 줄이
    // "이미 찍은 백로그 스냅샷에도 없고, 아직 구독자 목록에도 없어서" 그 클라이언트에게
    // 영영 전달 안 되는 틈이 있었다. 반환하는 큐를 호출자(SseStreamHandler)가 그대로
    // 폴링해서 소켓에 쓴다.
    // 큐 용량은 backlogSize를 그대로 쓴다 — 이미 그 브로드캐스터에 "얼마나 밀려도 의미가
    // 있는지"를 인스턴스별로 정확히 담고 있는 숫자다: 콘솔은 500(느린 클라이언트가 로그
    // 폭주를 놓치지 않게), 엔티티 스냅샷은 1(최신 상태만 의미 있음 — 밀리면 옛 스냅샷은
    // 자연히 버려지고 다음 스냅샷으로 항상 갱신됨). 별도 상수를 두면 이 의도와 어긋나는
    // 값을 넣기 쉽다.
    public synchronized BlockingQueue<String> subscribe(OutputStream out) {
        BlockingQueue<String> queue = new LinkedBlockingQueue<>(backlogSize);
        queue.addAll(backlog);
        subscribers.put(out, queue);
        return queue;
    }

    public void unsubscribe(OutputStream out) {
        subscribers.remove(out);
    }

    // 구독자가 없으면 굳이 페이로드를 만들 필요가 없다 — 엔티티 스냅샷처럼 주기적으로
    // 계산 비용이 드는 브로드캐스트는 호출 전에 이걸로 스킵한다.
    public boolean hasSubscribers() {
        return !subscribers.isEmpty();
    }

    public synchronized void broadcast(String line) {
        backlog.addLast(line);
        if (backlog.size() > backlogSize) {
            backlog.removeFirst();
        }
        // offer()는 큐가 꽉 차도 절대 안 기다리고 바로 false를 반환한다 — 호출한 스레드
        // (메인 스레드일 수 있음)는 여기서 절대 블록되지 않는다.
        for (BlockingQueue<String> queue : subscribers.values()) {
            queue.offer(line);
        }
    }
}
