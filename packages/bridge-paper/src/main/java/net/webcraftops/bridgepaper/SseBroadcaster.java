package net.webcraftops.bridgepaper;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Set;
import java.util.concurrent.CopyOnWriteArraySet;

// SSE 구독자에게 줄 단위 메시지를 실시간 브로드캐스트하는 범용 클래스(콘솔 로그, 지도
// 타일 무효화 이벤트, 엔티티 스냅샷 셋 다 이걸 인스턴스만 나눠서 쓴다). 최근 N줄은
// 버퍼에 남겨뒀다가 새 구독자가 연결되는 즉시 재생해 빈 화면으로 시작하지 않게 한다.
//
// [수정: 라운드 1] 백로그 크기를 생성자로 받게 했다 — 콘솔 로그는 히스토리가 유용해서
// 500줄이 맞지만, 엔티티 스냅샷(300ms마다 전체 좌표 재전송)은 "히스토리"가 아니라
// "최신 상태"만 의미 있다. 500개를 그대로 재생하면 새 구독자가 접속하자마자 최대 150초
// 치 과거 위치를 폭풍처럼 다시 받게 된다 — 엔티티 스냅샷은 반드시 1로 생성할 것.
public final class SseBroadcaster {
    private final int backlogSize;
    private final Set<OutputStream> subscribers = new CopyOnWriteArraySet<>();
    private final Deque<String> backlog = new ArrayDeque<>();

    public SseBroadcaster() {
        this(500);
    }

    public SseBroadcaster(int backlogSize) {
        this.backlogSize = backlogSize;
    }

    public synchronized void replayBacklogTo(OutputStream out) {
        for (String line : backlog) {
            writeEvent(out, line);
        }
    }

    public void subscribe(OutputStream out) {
        subscribers.add(out);
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
        for (OutputStream out : subscribers) {
            if (!writeEvent(out, line)) {
                subscribers.remove(out);
            }
        }
    }

    // 같은 OutputStream에 SSE 핸들러의 keep-alive 핑과 브로드캐스트가 동시에 쓰일 수 있어
    // out 자체를 락으로 삼아 프레임이 섞이지 않게 한다.
    private boolean writeEvent(OutputStream out, String line) {
        try {
            synchronized (out) {
                String payload = "data: " + line.replace("\n", "\ndata: ") + "\n\n";
                out.write(payload.getBytes(StandardCharsets.UTF_8));
                out.flush();
            }
            return true;
        } catch (IOException e) {
            return false;
        }
    }
}
