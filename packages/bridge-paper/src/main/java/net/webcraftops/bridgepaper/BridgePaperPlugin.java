package net.webcraftops.bridgepaper;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.core.Logger;
import org.bukkit.plugin.java.JavaPlugin;

import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

public final class BridgePaperPlugin extends JavaPlugin {
    private BridgeHttpServer httpServer;
    private ConsoleBroadcaster consoleBroadcaster;
    private ConsoleLogAppender consoleLogAppender;
    // 콘솔 스트리밍을 위해 System.out/err을 감싸는데, 플러그인 리로드 시 원래 스트림
    // 위에 계속 겹쳐 감싸지 않도록 켜지기 전 원본을 기억해둔다.
    private PrintStream originalOut;
    private PrintStream originalErr;
    // 켜질 때마다 새로 생성 — 프런트가 이 값의 변화로 서버(브릿지) 재시작을 감지해
    // 세션을 끊는다. 플러그인 리로드가 아니라 실제 서버 재기동에서만 바뀐다.
    private final String bootId = java.util.UUID.randomUUID().toString();

    public String getBootId() {
        return bootId;
    }

    @Override
    public void onEnable() {
        saveDefaultConfig();
        int port = getConfig().getInt("http.port", 8123);
        String bindAddress = getConfig().getString("http.bindAddress", "0.0.0.0");

        String token = System.getenv("BRIDGE_TOKEN");
        if (token == null || token.isEmpty()) {
            token = getConfig().getString("token", "");
        }
        if (token == null || token.isEmpty()) {
            token = UUID.randomUUID().toString();
            getLogger().warning("BRIDGE_TOKEN이 설정되지 않아 임시 토큰을 생성했습니다: " + token
                + " (재시작마다 바뀝니다. BRIDGE_TOKEN 환경변수 또는 config.yml의 token 값을 고정하세요.)");
        }

        consoleBroadcaster = new ConsoleBroadcaster();
        originalOut = System.out;
        originalErr = System.err;
        System.setOut(new PrintStream(new TeeOutputStream(originalOut, consoleBroadcaster), true, StandardCharsets.UTF_8));
        System.setErr(new PrintStream(new TeeOutputStream(originalErr, consoleBroadcaster), true, StandardCharsets.UTF_8));
        // 실제 명령어 결과/채팅 로그는 System.out이 아니라 Log4j를 통해서만 나간다
        // (TerminalConsoleAppender가 터미널에 직접 씀) — 루트 로거에 직접 붙어서 받는다.
        consoleLogAppender = ConsoleLogAppender.create(consoleBroadcaster);
        ((Logger) LogManager.getRootLogger()).addAppender(consoleLogAppender);

        try {
            httpServer = new BridgeHttpServer(this, port, bindAddress, token, consoleBroadcaster);
            httpServer.start();
            getLogger().info("Bridge HTTP 서버가 " + bindAddress + ":" + port + " 에서 시작되었습니다.");
        } catch (Exception e) {
            getLogger().severe("Bridge HTTP 서버 시작 실패: " + e.getMessage());
        }
    }

    @Override
    public void onDisable() {
        if (httpServer != null) {
            httpServer.stop();
        }
        if (consoleLogAppender != null) {
            ((Logger) LogManager.getRootLogger()).removeAppender(consoleLogAppender);
            consoleLogAppender.stop();
        }
        if (originalOut != null) {
            System.setOut(originalOut);
        }
        if (originalErr != null) {
            System.setErr(originalErr);
        }
    }
}
