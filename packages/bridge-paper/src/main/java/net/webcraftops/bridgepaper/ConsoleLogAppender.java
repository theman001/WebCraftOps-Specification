package net.webcraftops.bridgepaper;

import org.apache.logging.log4j.core.Layout;
import org.apache.logging.log4j.core.LogEvent;
import org.apache.logging.log4j.core.appender.AbstractAppender;
import org.apache.logging.log4j.core.config.Property;
import org.apache.logging.log4j.core.layout.PatternLayout;

// TeeOutputStream(System.out/err 감싸기)만으로는 실제 명령어 결과/채팅 로그를 못 잡는다 —
// Paper의 콘솔 로깅(TerminalConsoleAppender)이 System.out을 거치지 않고 터미널에 직접
// 쓰기 때문(실측으로 확인: /list 실행 결과가 System.out tee에는 전혀 안 찍혔다). 그래서
// Log4j2 Appender를 루트 로거에 직접 등록해 모든 로그 이벤트(명령어 결과, 채팅, 플러그인
// 로그 전부 포함 — Bukkit의 java.util.logging도 결국 Log4j로 라우팅된다)를 받는다.
public final class ConsoleLogAppender extends AbstractAppender {
    private final SseBroadcaster broadcaster;

    private ConsoleLogAppender(SseBroadcaster broadcaster, Layout<String> layout) {
        super("WebCraftOpsConsoleAppender", null, layout, false, Property.EMPTY_ARRAY);
        this.broadcaster = broadcaster;
    }

    public static ConsoleLogAppender create(SseBroadcaster broadcaster) {
        PatternLayout layout = PatternLayout.newBuilder()
            .withPattern("[%d{HH:mm:ss}] [%t/%level]: %msg")
            .build();
        ConsoleLogAppender appender = new ConsoleLogAppender(broadcaster, layout);
        appender.start();
        return appender;
    }

    @Override
    public void append(LogEvent event) {
        broadcaster.broadcast((String) getLayout().toSerializable(event));
    }
}
