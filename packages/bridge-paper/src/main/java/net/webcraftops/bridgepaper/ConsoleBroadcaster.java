package net.webcraftops.bridgepaper;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Set;
import java.util.concurrent.CopyOnWriteArraySet;

// SSE 구독자에게 콘솔 로그 줄을 실시간 브로드캐스트한다. 최근 N줄은 버퍼에 남겨뒀다가
// 새 구독자가 연결되는 즉시 재생해 빈 화면으로 시작하지 않게 한다.
public final class ConsoleBroadcaster {
    private static final int BACKLOG_SIZE = 500;
    private final Set<OutputStream> subscribers = new CopyOnWriteArraySet<>();
    private final Deque<String> backlog = new ArrayDeque<>();

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

    public synchronized void broadcast(String line) {
        backlog.addLast(line);
        if (backlog.size() > BACKLOG_SIZE) {
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
