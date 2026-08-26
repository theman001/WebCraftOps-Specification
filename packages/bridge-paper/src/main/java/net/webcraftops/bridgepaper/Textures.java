package net.webcraftops.bridgepaper;

import org.bukkit.Material;

import javax.imageio.ImageIO;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.logging.Logger;

// 블록 상단 텍스처를 Material 기준으로 찾아 캐싱하고, 잔디/나뭇잎/물처럼 바이옴 색이
// 곱해지는 블록은 근사 색을 입힌다(전부 평원 바이옴 근사 — 바이옴별 정확한 색은 아직
// 미구현). 텍스처 선택 규칙과 알려진 한계는 resources/textures/SOURCE.md 참고.
//
// [디버깅] 지도가 이상하면 여기서 나는 "[Textures]" 로그부터 볼 것 — 어떤 Material이
// 텍스처를 못 찾아 회색 체커로 대체됐는지 전부 남긴다(같은 Material은 한 번만).
public final class Textures {
    private static final int TEXTURE_SIZE = 16;
    private static final Logger LOGGER = Logger.getLogger("BridgePaper");
    private static final Map<Material, BufferedImage> CACHE = new HashMap<>();
    private static final Set<String> MISSING_WARNED = new HashSet<>();
    private static final BufferedImage MISSING = createMissingTexture();

    // 텍스처 파일명이 Material 이름과 아예 다른 블록들 — 자동 규칙(_top / 그대로)으로는
    // 못 찾는 대표적인 케이스만 수동 등록. 나머지(슬래브/계단/울타리 등 파생 블록)는 아직
    // 커버 안 됨 — 지도에서 회색 체커로 보이면 여기 추가할 것.
    private static final Map<String, String> OVERRIDES = Map.of(
        "water", "water_still",
        "lava", "lava_still"
    );

    private static final Set<String> GRASS_TINT = Set.of(
        "grass_block", "short_grass", "tall_grass", "fern", "large_fern", "sugar_cane"
    );
    private static final Set<String> FOLIAGE_TINT = Set.of(
        "oak_leaves", "jungle_leaves", "acacia_leaves", "dark_oak_leaves", "mangrove_leaves", "vine"
    );
    private static final Set<String> WATER_TINT = Set.of("water", "bubble_column");

    private static final int GRASS_COLOR = 0x7CBD6B;
    private static final int WATER_COLOR = 0x3F76E4;

    private Textures() {}

    // [디버깅] 플러그인 기동 시 한 번 호출 — jar에 텍스처 리소스가 실제로 번들되어
    // 클래스패스에서 읽히는지 즉시 확인한다. 여기서 실패하면 지도 타일은 100% 전부 회색
    // 체커로만 나올 것이므로, 첫 지도 요청까지 기다릴 필요 없이 기동 로그에서 바로 안다.
    public static boolean verifyBundled() {
        String[] known = {"stone", "grass_block_top", "water_still", "oak_planks"};
        boolean allOk = true;
        for (String name : known) {
            boolean found = readTexture(name) != null;
            allOk &= found;
            LOGGER.info("[Textures] 번들 확인 " + name + ".png: " + (found ? "OK" : "누락!"));
        }
        if (!allOk) {
            LOGGER.severe("[Textures] 블록 텍스처 리소스가 jar에 안 들어있는 것으로 보입니다 — "
                + "Gradle 빌드/resources 경로를 확인하세요.");
        }
        return allOk;
    }

    public static synchronized BufferedImage getTopTexture(Material material) {
        return CACHE.computeIfAbsent(material, Textures::load);
    }

    private static BufferedImage load(Material material) {
        String name = material.name().toLowerCase(Locale.ROOT);
        String override = OVERRIDES.get(name);
        BufferedImage raw = override != null ? readTexture(override) : null;
        if (raw == null) {
            raw = readTexture(name + "_top");
        }
        if (raw == null) {
            raw = readTexture(name);
        }
        if (raw == null) {
            if (MISSING_WARNED.add(name)) {
                LOGGER.warning("[Textures] " + name + " 텍스처를 못 찾아 회색 체커로 대체합니다 "
                    + "(시도한 파일명: " + name + "_top.png, " + name + ".png"
                    + (override != null ? ", " + override + ".png" : "") + ")");
            }
            return MISSING;
        }
        BufferedImage normalized = normalize(raw);
        if (GRASS_TINT.contains(name) || FOLIAGE_TINT.contains(name)) {
            return tint(normalized, GRASS_COLOR);
        }
        if (WATER_TINT.contains(name)) {
            return tint(normalized, WATER_COLOR);
        }
        return normalized;
    }

    private static BufferedImage readTexture(String fileName) {
        try (InputStream in = Textures.class.getResourceAsStream("/textures/block/" + fileName + ".png")) {
            if (in == null) {
                return null;
            }
            return ImageIO.read(in);
        } catch (IOException e) {
            return null;
        }
    }

    // 16x16이 아닌 텍스처(고해상도, 애니메이션 스프라이트시트 등)를 16x16 한 장으로 맞춘다.
    private static BufferedImage normalize(BufferedImage raw) {
        if (raw.getWidth() == TEXTURE_SIZE && raw.getHeight() == TEXTURE_SIZE) {
            return raw;
        }
        BufferedImage out = new BufferedImage(TEXTURE_SIZE, TEXTURE_SIZE, BufferedImage.TYPE_INT_ARGB);
        Graphics2D g = out.createGraphics();
        if (raw.getWidth() == TEXTURE_SIZE && raw.getHeight() > TEXTURE_SIZE) {
            // 세로로 긴 애니메이션 시트 — 첫 프레임(맨 위 16x16)만 그대로 자른다.
            g.drawImage(raw, 0, 0, TEXTURE_SIZE, TEXTURE_SIZE, 0, 0, TEXTURE_SIZE, TEXTURE_SIZE, null);
        } else {
            g.drawImage(raw, 0, 0, TEXTURE_SIZE, TEXTURE_SIZE, 0, 0, raw.getWidth(), raw.getHeight(), null);
        }
        g.dispose();
        return out;
    }

    private static BufferedImage tint(BufferedImage src, int rgb) {
        BufferedImage out = new BufferedImage(src.getWidth(), src.getHeight(), BufferedImage.TYPE_INT_ARGB);
        float tr = ((rgb >> 16) & 0xFF) / 255f;
        float tg = ((rgb >> 8) & 0xFF) / 255f;
        float tb = (rgb & 0xFF) / 255f;
        for (int y = 0; y < src.getHeight(); y++) {
            for (int x = 0; x < src.getWidth(); x++) {
                int argb = src.getRGB(x, y);
                int a = (argb >> 24) & 0xFF;
                int r = (int) (((argb >> 16) & 0xFF) * tr);
                int g = (int) (((argb >> 8) & 0xFF) * tg);
                int b = (int) ((argb & 0xFF) * tb);
                out.setRGB(x, y, (a << 24) | (r << 16) | (g << 8) | b);
            }
        }
        return out;
    }

    private static BufferedImage createMissingTexture() {
        BufferedImage img = new BufferedImage(TEXTURE_SIZE, TEXTURE_SIZE, BufferedImage.TYPE_INT_ARGB);
        for (int y = 0; y < TEXTURE_SIZE; y++) {
            for (int x = 0; x < TEXTURE_SIZE; x++) {
                boolean checker = ((x / 4) + (y / 4)) % 2 == 0;
                img.setRGB(x, y, checker ? 0xFFAAAAAA : 0xFF888888);
            }
        }
        return img;
    }
}
