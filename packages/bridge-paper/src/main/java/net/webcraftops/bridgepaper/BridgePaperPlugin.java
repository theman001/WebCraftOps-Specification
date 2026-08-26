package net.webcraftops.bridgepaper;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.core.Logger;
import org.bukkit.plugin.java.JavaPlugin;

import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

public final class BridgePaperPlugin extends JavaPlugin {
    private BridgeHttpServer httpServer;
    private SseBroadcaster consoleBroadcaster;
    private ConsoleLogAppender consoleLogAppender;
    private MapTileRenderer mapTileRenderer;
    private SseBroadcaster mapEventsBroadcaster;
    private MapChangeListener mapChangeListener;
    private SseBroadcaster entitySnapshotBroadcaster;
    private EntitySnapshotBroadcaster entitySnapshotScheduler;
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

        consoleBroadcaster = new SseBroadcaster();
        originalOut = System.out;
        originalErr = System.err;
        System.setOut(new PrintStream(new TeeOutputStream(originalOut, consoleBroadcaster), true, StandardCharsets.UTF_8));
        System.setErr(new PrintStream(new TeeOutputStream(originalErr, consoleBroadcaster), true, StandardCharsets.UTF_8));
        // 실제 명령어 결과/채팅 로그는 System.out이 아니라 Log4j를 통해서만 나간다
        // (TerminalConsoleAppender가 터미널에 직접 씀) — 루트 로거에 직접 붙어서 받는다.
        consoleLogAppender = ConsoleLogAppender.create(consoleBroadcaster);
        ((Logger) LogManager.getRootLogger()).addAppender(consoleLogAppender);

        // [디버깅] 지도 타일 파이프라인 1단계 — 실배포 후 문제가 생기면 아래 순서로
        // "[BridgePaperPlugin]"/"[Textures]"/"[MapTile]"/"[MapTileHandler]"/"[MapEvents]"/
        // "[WorldRoute]" 태그를 콘솔(또는 콘솔 탭)에서 찾아 어느 단계인지 좁혀갈 것:
        // 1) 여기 verifyBundled()가 "누락!"이면 → jar에 텍스처가 안 들어감(빌드 문제).
        // 2) 실제 타일 요청 시 [WorldRoute] 404 → 프런트가 잘못된 경로로 요청.
        // 3) [MapTileHandler] 월드를 찾을 수 없음 → worldId 불일치.
        // 4) [MapTile] 렌더링 중 예외 → Bukkit API 호출 자체가 실패(권한/월드 언로드 등).
        // 5) 타일은 잘 오는데 색이 이상함 → [Textures] 누락 경고로 어떤 블록인지 확인.
        getLogger().info("[BridgePaperPlugin] 지도 타일 파이프라인 초기화 중...");
        boolean texturesOk = Textures.verifyBundled();
        getLogger().info("[BridgePaperPlugin] 텍스처 번들 확인: " + (texturesOk ? "정상" : "실패 — 위 로그 참고"));
        mapTileRenderer = new MapTileRenderer();
        mapEventsBroadcaster = new SseBroadcaster();
        mapChangeListener = new MapChangeListener(mapTileRenderer, mapEventsBroadcaster);
        getServer().getPluginManager().registerEvents(mapChangeListener, this);

        // [디버깅] 3단계 — 엔티티 스냅샷/플레이어 얼굴. 지도에 유저/몹/아이템이 안 보이면
        // "[EntitySnapshot]" 로그로 스냅샷 자체가 도는지(구독자 유무, 엔티티 수) 확인하고,
        // 얼굴이 안 뜨면 "[PlayerHead]" 로그로 Mojang 세션 서버 응답을 확인할 것.
        // 백로그 1개만 — 새 구독자는 "최신 좌표"만 필요하지 과거 스냅샷 히스토리는 필요 없다.
        entitySnapshotBroadcaster = new SseBroadcaster(1);
        entitySnapshotScheduler = new EntitySnapshotBroadcaster(entitySnapshotBroadcaster);
        entitySnapshotScheduler.start(this);

        try {
            httpServer = new BridgeHttpServer(
                this, port, bindAddress, token, consoleBroadcaster, mapTileRenderer, mapEventsBroadcaster,
                entitySnapshotBroadcaster
            );
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
        if (entitySnapshotScheduler != null) {
            entitySnapshotScheduler.stop();
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
