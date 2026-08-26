package net.webcraftops.bridgepaper.handlers;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import net.webcraftops.bridgepaper.HttpUtil;
import net.webcraftops.bridgepaper.Json;

import javax.imageio.ImageIO;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.logging.Logger;

// GET /bridge/players/{uuid}/head — Mojang 세션 서버에서 스킨을 직접 받아 얼굴(8x8 +
// 모자 레이어)만 잘라서 서빙한다(서드파티 아바타 서비스 의존 없음 — 사용자가 명시적으로
// 자체 호스팅을 선택함). Bukkit API를 안 건드리므로 메인 스레드 필요 없음 — 이 핸들러가
// 도는 캐시드 스레드풀에서 그냥 블로킹 HTTP 호출해도 게임은 안 멈춘다.
//
// [디버깅] "[PlayerHead]" 태그 — 얼굴이 계속 회색 폴백으로만 보이면 여기 경고 로그로
// 세션 서버 호출 실패/textures 프로퍼티 없음/스킨 URL 파싱 실패 중 어디서 막혔는지 확인.
public final class PlayerHeadHandler implements HttpHandler {
    private static final Logger LOGGER = Logger.getLogger("BridgePaper");
    private static final long CACHE_TTL_MS = 10 * 60 * 1000;
    private static final HttpClient HTTP_CLIENT = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(5))
        .build();
    private static final Map<String, CacheEntry> CACHE = new ConcurrentHashMap<>();
    private static final BufferedImage FALLBACK = createFallback();

    private record CacheEntry(byte[] png, long expiresAt) {}

    @Override
    public void handle(HttpExchange exchange) throws IOException {
        if (!"GET".equalsIgnoreCase(exchange.getRequestMethod())) {
            HttpUtil.sendError(exchange, 405, "GET만 지원합니다.");
            return;
        }
        String uuid = extractUuid(exchange.getRequestURI().getPath());
        if (uuid == null) {
            HttpUtil.sendError(exchange, 400, "uuid를 경로에서 찾을 수 없습니다.");
            return;
        }

        CacheEntry cached = CACHE.get(uuid);
        if (cached != null && cached.expiresAt() > System.currentTimeMillis()) {
            HttpUtil.sendBytes(exchange, 200, cached.png(), "image/png");
            return;
        }

        byte[] png = fetchAndCropFace(uuid);
        CACHE.put(uuid, new CacheEntry(png, System.currentTimeMillis() + CACHE_TTL_MS));
        HttpUtil.sendBytes(exchange, 200, png, "image/png");
    }

    private static String extractUuid(String path) {
        // 기대 경로: /bridge/players/{uuid}/head
        String[] parts = path.split("/");
        for (int i = 0; i < parts.length; i++) {
            if ("players".equals(parts[i]) && i + 1 < parts.length) {
                return parts[i + 1];
            }
        }
        return null;
    }

    @SuppressWarnings("unchecked")
    private byte[] fetchAndCropFace(String uuid) {
        try {
            HttpRequest profileRequest = HttpRequest.newBuilder()
                .uri(URI.create("https://sessionserver.mojang.com/session/minecraft/profile/" + uuid))
                .timeout(Duration.ofSeconds(5))
                .GET()
                .build();
            HttpResponse<String> profileResponse =
                HTTP_CLIENT.send(profileRequest, HttpResponse.BodyHandlers.ofString());
            if (profileResponse.statusCode() != 200) {
                LOGGER.warning("[PlayerHead] uuid=" + uuid + " 세션 서버 응답 "
                    + profileResponse.statusCode() + " — 폴백 사용");
                return encodePng(FALLBACK);
            }

            Map<String, Object> profile = (Map<String, Object>) Json.parse(profileResponse.body());
            List<Object> properties = (List<Object>) profile.get("properties");
            String texturesValue = null;
            if (properties != null) {
                for (Object propertyObj : properties) {
                    Map<String, Object> property = (Map<String, Object>) propertyObj;
                    if ("textures".equals(property.get("name"))) {
                        texturesValue = (String) property.get("value");
                        break;
                    }
                }
            }
            if (texturesValue == null) {
                LOGGER.warning("[PlayerHead] uuid=" + uuid + " textures 프로퍼티 없음 — 폴백 사용");
                return encodePng(FALLBACK);
            }

            String decoded = new String(Base64.getDecoder().decode(texturesValue), StandardCharsets.UTF_8);
            Map<String, Object> texturesJson = (Map<String, Object>) Json.parse(decoded);
            Map<String, Object> textures = (Map<String, Object>) texturesJson.get("textures");
            Map<String, Object> skin = textures != null ? (Map<String, Object>) textures.get("SKIN") : null;
            String skinUrl = skin != null ? (String) skin.get("url") : null;
            if (skinUrl == null) {
                LOGGER.warning("[PlayerHead] uuid=" + uuid + " 스킨 URL 파싱 실패 — 폴백 사용");
                return encodePng(FALLBACK);
            }

            HttpRequest skinRequest = HttpRequest.newBuilder()
                .uri(URI.create(skinUrl)).timeout(Duration.ofSeconds(5)).GET().build();
            HttpResponse<byte[]> skinResponse =
                HTTP_CLIENT.send(skinRequest, HttpResponse.BodyHandlers.ofByteArray());
            BufferedImage skinImage = ImageIO.read(new ByteArrayInputStream(skinResponse.body()));
            BufferedImage face = cropFace(skinImage);
            LOGGER.info("[PlayerHead] uuid=" + uuid + " 얼굴 크롭 완료");
            return encodePng(face);
        } catch (Exception e) {
            LOGGER.warning("[PlayerHead] uuid=" + uuid + " 처리 실패: " + e + " — 폴백 사용");
            return encodePng(FALLBACK);
        }
    }

    // 스킨 텍스처의 8x8 기본 얼굴(8,8)-(16,16) 위에 8x8 모자 레이어(40,8)-(48,16)를
    // 알파 합성한다 — 마인크래프트 스킨의 표준 "얼굴" 렌더링 방식.
    private static BufferedImage cropFace(BufferedImage skin) {
        BufferedImage face = new BufferedImage(8, 8, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = face.createGraphics();
        g.drawImage(skin, 0, 0, 8, 8, 8, 8, 16, 16, null);
        g.drawImage(skin, 0, 0, 8, 8, 40, 8, 48, 16, null);
        g.dispose();
        return face;
    }

    private static byte[] encodePng(BufferedImage image) {
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            ImageIO.write(image, "png", out);
            return out.toByteArray();
        } catch (IOException e) {
            throw new RuntimeException(e);
        }
    }

    private static BufferedImage createFallback() {
        BufferedImage img = new BufferedImage(8, 8, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = img.createGraphics();
        g.setColor(new Color(0x9a, 0x9a, 0x9a));
        g.fillRect(0, 0, 8, 8);
        g.dispose();
        return img;
    }
}
