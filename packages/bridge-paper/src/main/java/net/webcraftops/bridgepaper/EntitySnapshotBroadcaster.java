package net.webcraftops.bridgepaper;

import org.bukkit.Bukkit;
import org.bukkit.World;
import org.bukkit.entity.Entity;
import org.bukkit.entity.Item;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.plugin.Plugin;
import org.bukkit.scheduler.BukkitTask;

import java.util.logging.Logger;

// 300ms마다(구독자가 있을 때만 — 없으면 계산 자체를 스킵해 메인 스레드 낭비를 안 한다)
// 온라인 플레이어/몹/떨어진 아이템의 좌표를 스냅샷 찍어 SSE로 push한다. Bukkit 엔티티
// API는 메인 스레드 전용이라 runTaskTimer로 등록(이미 메인 스레드에서 실행되므로
// MainThreadExecutor.runSync가 따로 필요 없다 — HTTP 핸들러와 다른 점).
//
// [디버깅] "[EntitySnapshot]" 태그 — 지도에 엔티티가 하나도 안 보이면, 여기 로그가
// 애초에 스냅샷을 만들고 있는지(엔티티 수가 0인지) 먼저 확인한다. 매 틱마다 찍으면
// 너무 시끄러워서 하트비트(약 30초마다)로만 개수를 남기고, 실패는 즉시 남긴다.
public final class EntitySnapshotBroadcaster {
    private static final long PERIOD_TICKS = 6L; // 300ms (20tick/s 기준)
    private static final int HEARTBEAT_EVERY_N_TICKS = 100; // 약 30초
    private static final Logger LOGGER = Logger.getLogger("BridgePaper");

    private final SseBroadcaster broadcaster;
    private BukkitTask task;
    private int tickCount = 0;
    private boolean wasSubscribed = false;

    public EntitySnapshotBroadcaster(SseBroadcaster broadcaster) {
        this.broadcaster = broadcaster;
    }

    public void start(Plugin plugin) {
        LOGGER.info("[EntitySnapshot] 스케줄러 시작 (주기 " + PERIOD_TICKS + " tick)");
        task = Bukkit.getScheduler().runTaskTimer(plugin, this::tick, PERIOD_TICKS, PERIOD_TICKS);
    }

    public void stop() {
        if (task != null) {
            task.cancel();
        }
    }

    private void tick() {
        boolean subscribed = broadcaster.hasSubscribers();
        if (subscribed != wasSubscribed) {
            LOGGER.info("[EntitySnapshot] 구독자 " + (subscribed ? "생김 — 스냅샷 시작" : "없음 — 스냅샷 중지"));
            wasSubscribed = subscribed;
        }
        if (!subscribed) {
            return;
        }

        try {
            String json = buildSnapshotJson();
            broadcaster.broadcast(json);
            tickCount++;
            if (tickCount % HEARTBEAT_EVERY_N_TICKS == 0) {
                LOGGER.info("[EntitySnapshot] 하트비트: " + json.length() + " bytes 페이로드 전송 중");
            }
        } catch (RuntimeException e) {
            LOGGER.severe("[EntitySnapshot] 스냅샷 생성 실패: " + e);
        }
    }

    // [수정: 라운드 1] Bukkit.getWorlds() 전체(네더/엔드 포함)를 돌면 다른 차원의 엔티티가
    // 지도(오버월드 하나만 그림)에 자기 차원 좌표 그대로 잘못된 위치로 찍혔다 — 지도가
    // 대표하는 월드(=MapTileHandler/HttpUtil.resolveWorld("overworld")와 동일하게 첫
    // 번째 월드) 하나만 스캔하도록 좁혔다. World.getEntities()는 그 월드에 있는 엔티티만
    // 반환하므로 다른 차원의 플레이어/몹은 자연히 빠진다.
    private String buildSnapshotJson() {
        StringBuilder players = new StringBuilder();
        StringBuilder mobs = new StringBuilder();
        StringBuilder items = new StringBuilder();

        World world = Bukkit.getWorlds().get(0);
        for (Entity entity : world.getEntities()) {
            if (entity instanceof Player player) {
                appendComma(players);
                players.append("{\"uuid\":\"").append(player.getUniqueId())
                    .append("\",\"name\":\"").append(Json.escape(player.getName()))
                    .append("\",\"x\":").append(player.getLocation().getX())
                    .append(",\"z\":").append(player.getLocation().getZ())
                    .append(",\"yaw\":").append(player.getLocation().getYaw())
                    .append("}");
            } else if (entity instanceof Item item) {
                appendComma(items);
                // id: 프런트가 "이 특정 아이템"을 스냅샷 사이에서 계속 같은 대상으로 추적하는
                // 데 쓴다(포커스 고정 — 좌표만으로는 같은 종류의 다른 개체와 구분이 안 됨).
                items.append("{\"id\":\"").append(item.getUniqueId())
                    .append("\",\"material\":\"").append(item.getItemStack().getType().name())
                    .append("\",\"x\":").append(item.getLocation().getX())
                    .append(",\"z\":").append(item.getLocation().getZ())
                    .append("}");
            } else if (entity instanceof LivingEntity living) {
                appendComma(mobs);
                String customName = living.getCustomName();
                mobs.append("{\"id\":\"").append(living.getUniqueId())
                    .append("\",\"type\":\"").append(living.getType().name())
                    .append("\",\"x\":").append(living.getLocation().getX())
                    .append(",\"z\":").append(living.getLocation().getZ())
                    .append(",\"name\":").append(customName != null ? "\"" + Json.escape(customName) + "\"" : "null")
                    .append("}");
            }
        }

        return "{\"players\":[" + players + "],\"mobs\":[" + mobs + "],\"items\":[" + items + "]}";
    }

    private static void appendComma(StringBuilder sb) {
        if (sb.length() > 0) {
            sb.append(",");
        }
    }
}
