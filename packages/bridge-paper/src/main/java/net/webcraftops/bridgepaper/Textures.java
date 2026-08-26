package net.webcraftops.bridgepaper;

import org.bukkit.Material;

import javax.imageio.ImageIO;
import java.awt.Graphics2D;
import java.awt.image.BufferedImage;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
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
    // 못 찾는 대표적인 케이스만 수동 등록.
    // Map.of는 최대 10쌍까지만 지원해서(11번째부터 컴파일 에러) 여기부턴 ofEntries 사용.
    private static final Map<String, String> OVERRIDES = Map.ofEntries(
        Map.entry("water", "water_still"),
        Map.entry("lava", "lava_still"),
        Map.entry("snow_block", "snow"),
        Map.entry("magma_block", "magma"),
        Map.entry("dried_kelp_block", "dried_kelp_top"),
        Map.entry("smooth_quartz", "quartz_block_top"),
        Map.entry("smooth_sandstone", "sandstone_top"),
        Map.entry("smooth_red_sandstone", "red_sandstone_top"),
        Map.entry("sticky_piston", "piston_top_sticky"),
        // 상자는 블록 텍스처가 아니라 엔티티(3D 모델) 텍스처라 자동 규칙으로 못 찾는다.
        // Mojang 클라이언트 jar의 entity/chest/{normal,trapped,ender}.png에서 자물쇠가
        // 보이는 정면(lid front) UV(28,19,14x14)만 직접 크롭해 별도 파일로 번들했다 —
        // 하늘에서 봤을 때 그냥 나무 블록과 구분되도록(사용자 요청: 위 대신 정면을 써서
        // 상자임을 명확히 함). 크롭 근거는 이 파일 아래 SOURCE.md 참고.
        Map.entry("chest", "chest_front"),
        Map.entry("trapped_chest", "trapped_chest_front"),
        Map.entry("ender_chest", "ender_chest_front")
    );

    // 파생 블록(슬래브/계단/벽/펜스/버튼/문 등)은 실제로 "부모 블록"과 같은 텍스처를 6면에
    // 그대로 쓴다 — 접미사를 떼고 부모 이름 후보 몇 개(그대로/복수형/“_block”/“_planks”/
    // “_log”)를 순서대로 시도한다. (실측: 1193개 레지스트리 블록 기준 텍스처 매칭 55.6%
    // → 88.6%로 개선됨 — packages/bridge-paper/README.md 참고)
    private static final List<String> STRIP_SUFFIXES = List.of(
        "_mosaic_slab", "_mosaic_stairs", "_wall_hanging_sign", "_wall_sign", "_hanging_sign",
        "_sign", "_fence_gate", "_fence", "_pressure_plate", "_trapdoor", "_button", "_slab",
        "_stairs", "_wall", "_door", "_wood"
    );
    private static final List<String> BASE_VARIANT_SUFFIXES = List.of("", "s", "_block", "_planks", "_log");

    // 원본과 텍스처가 사실상 동일한 접두사 변형(밀랍 코팅 구리, 감염 블록).
    private static final List<String> STRIP_PREFIXES = List.of("waxed_", "infested_");

    // 배너/침대/카펫처럼 텍스처를 재사용할 부모가 없는 염료색 블록은 대표색 단색 스와치로
    // 대체한다(실제 Mojang 울/염료 팔레트 색상값).
    private static final List<String> COLOR_NAMES = List.of(
        "light_blue", "light_gray", "white", "orange", "magenta", "yellow", "lime", "pink",
        "gray", "cyan", "purple", "blue", "brown", "green", "red", "black"
    );
    private static final Map<String, Integer> COLOR_RGB = Map.ofEntries(
        Map.entry("white", 0xF9FFFE), Map.entry("orange", 0xF9801D), Map.entry("magenta", 0xC74EBD),
        Map.entry("light_blue", 0x3AB3DA), Map.entry("yellow", 0xFED83D), Map.entry("lime", 0x80C71F),
        Map.entry("pink", 0xF38BAA), Map.entry("gray", 0x474F52), Map.entry("light_gray", 0x9D9D97),
        Map.entry("cyan", 0x169C9C), Map.entry("purple", 0x8932B8), Map.entry("blue", 0x3C44AA),
        Map.entry("brown", 0x835432), Map.entry("green", 0x5E7C16), Map.entry("red", 0xB02E26),
        Map.entry("black", 0x1D1D21)
    );

    private static final Set<String> GRASS_TINT = Set.of(
        "grass_block", "short_grass", "tall_grass", "fern", "large_fern", "sugar_cane"
    );
    // 실측: 나뭇잎 텍스처 중 azalea/cherry/pale_oak는 원본 자체에 색이 박혀 있어 틴트가
    // 필요 없지만(팔레트 스캔으로 확인), 나머지는 회색조 원본이라 틴트가 없으면 그냥
    // 회색으로 보인다(birch/spruce도 실제 게임에선 바이옴 무관 고정색이지만, 여긴 근사
    // 하나(GRASS_COLOR)만 쓰므로 같은 틴트를 적용).
    private static final Set<String> FOLIAGE_TINT = Set.of(
        "oak_leaves", "jungle_leaves", "acacia_leaves", "dark_oak_leaves", "mangrove_leaves",
        "birch_leaves", "spruce_leaves", "vine"
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
        BufferedImage resolved = resolve(name);
        if (resolved != null) {
            return resolved;
        }
        if (MISSING_WARNED.add(name)) {
            LOGGER.warning("[Textures] " + name + " 텍스처를 못 찾아 회색 체커로 대체합니다.");
        }
        return MISSING;
    }

    // override → 파생 블록(슬래브 등) 분해 → 접두사(waxed_/infested_) 벗기고 재시도 →
    // 염료색 단색 스와치 순서로 시도한다. 진짜로 못 찾으면 null(호출부가 MISSING으로
    // 바꾸고 경고를 남긴다 — 재귀 중간 단계에서는 경고를 안 남기려고 여기선 null 그대로 둠).
    private static BufferedImage resolve(String name) {
        BufferedImage raw = readWithOverride(name);
        if (raw != null) {
            return applyTint(name, normalize(raw));
        }

        for (String suffix : STRIP_SUFFIXES) {
            if (name.endsWith(suffix) && name.length() > suffix.length()) {
                String base = name.substring(0, name.length() - suffix.length());
                for (String variant : BASE_VARIANT_SUFFIXES) {
                    BufferedImage candidate = readWithOverride(base + variant);
                    if (candidate != null) {
                        // 파생 블록(슬래브 등)엔 원본 블록과 별개의 바이옴 틴트 대상이 없다.
                        return normalize(candidate);
                    }
                }
            }
        }

        for (String prefix : STRIP_PREFIXES) {
            if (name.startsWith(prefix)) {
                BufferedImage stripped = resolve(name.substring(prefix.length()));
                if (stripped != null) {
                    return stripped;
                }
            }
        }

        for (String color : COLOR_NAMES) {
            if (name.startsWith(color + "_")) {
                return solidColor(0xFF000000 | COLOR_RGB.get(color));
            }
        }

        return null;
    }

    private static BufferedImage readWithOverride(String name) {
        String override = OVERRIDES.get(name);
        BufferedImage raw = override != null ? readTexture(override) : null;
        if (raw == null) {
            raw = readTexture(name + "_top");
        }
        if (raw == null) {
            raw = readTexture(name);
        }
        return raw;
    }

    private static BufferedImage applyTint(String name, BufferedImage normalized) {
        if (GRASS_TINT.contains(name) || FOLIAGE_TINT.contains(name)) {
            return tint(normalized, GRASS_COLOR);
        }
        if (WATER_TINT.contains(name)) {
            return tint(normalized, WATER_COLOR);
        }
        return normalized;
    }

    private static BufferedImage solidColor(int argb) {
        BufferedImage img = new BufferedImage(TEXTURE_SIZE, TEXTURE_SIZE, BufferedImage.TYPE_INT_ARGB);
        for (int y = 0; y < TEXTURE_SIZE; y++) {
            for (int x = 0; x < TEXTURE_SIZE; x++) {
                img.setRGB(x, y, argb);
            }
        }
        return img;
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
