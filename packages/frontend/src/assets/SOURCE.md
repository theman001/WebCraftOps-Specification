# 리소스 출처

전부 Mojang 공식 클라이언트 배포물에서 직접 추출했다. 서드파티 소스 없음(플레이어
얼굴만 예외 — 아래 참고).

- Minecraft 버전: `26.2` (실서버가 도는 버전과 동일 — `packages/bridge-paper/src/main/resources/textures/SOURCE.md`에 검증 과정 기록)
- 클라이언트 jar: `https://piston-data.mojang.com/v1/objects/2dc72797acbc1b63fc16a11c4ac393605f453754/client.jar`
- 추출 방법: jar(zip)에서 `assets/minecraft/textures/{item,entity}/**` PNG를 그대로 복사.
  가공/재압축 없음.

## `items/*.png`

바닐라 아이템 텍스처 전체(796개)를 파일명 그대로 복사. 엔티티 패널에서 떨어진
아이템(Item 엔티티) 마커로 그대로 사용한다.

## `mobs/*.png`

몹은 종류마다 UV 레이아웃이 완전히 달라서(휴머노이드/사족보행/비행 등) 전수 지원은
범위가 크다 — **자주 보이는 몹만 얼굴 영역을 수동으로 크롭**했고, 목록에 없는 타입은
`_fallback.png`(회색 원 아이콘, 실제 텍스처 아님 — 순수 생성)로 대체한다.

크롭 방법: 각 원본 텍스처를 브라우저 캔버스(puppeteer)로 열어 8px 격자를 씌워 눈 위치를
육안으로 확인한 뒤, 해당 영역을 잘라 8x8로 다운샘플(최근접 샘플링, 흐림 없음). 좌표는
아래에 정확히 기록 — 나중에 다른 몹 추가하거나 좌표 보정할 때 참고할 것.

| 몹(EntityType) | 소스 텍스처 | 크롭 (x,y,w,h) | 비고 |
|---|---|---|---|
| ZOMBIE, ZOMBIE_VILLAGER, DROWNED | zombie/zombie.png | 8,8,8,8 | 휴머노이드 표준 얼굴 UV(모든 휴머노이드 몹 공통) |
| SKELETON, STRAY, WITHER_SKELETON | skeleton/skeleton.png | 8,8,8,8 | 위와 동일 규칙 |
| HUSK | zombie/husk.png | 8,8,8,8 | |
| VILLAGER, WANDERING_TRADER | villager/villager.png | 8,8,8,8 | |
| WITCH | witch/witch.png | 8,8,8,8 | |
| ENDERMAN | enderman/enderman.png | 8,8,8,8 | |
| CREEPER | creeper/creeper.png | 8,8,8,8 | 큐브형 머리도 동일 UV 규칙을 따름 |
| COW, MOOSHROOM | cow/cow_temperate.png | 0,0,16,16 | MOOSHROOM은 실제 버섯소 텍스처 아님(근사) |
| PIG | pig/pig_temperate.png | 0,0,16,16 | |
| SHEEP | sheep/sheep.png | 0,0,16,16 | |
| CHICKEN | chicken/chicken_temperate.png | 0,0,16,16 | |
| WOLF | wolf/wolf.png | 0,0,16,16 | |
| CAT | cat/cat_black.png | 0,0,16,16 | 검은 고양이 변종만(다른 무늬 미지원) |
| RABBIT | rabbit/rabbit_brown.png | 0,16,16,16 | |
| BEE | bee/bee.png | 4,4,16,16 | |
| HORSE, DONKEY | horse/horse_brown.png | 0,16,20,16 | DONKEY는 실제 당나귀 텍스처 아님(근사) |

**미지원(전부 `_fallback.png`)**: SPIDER/CAVE_SPIDER, IRON_GOLEM, SLIME/MAGMA_CUBE,
그 외 목록에 없는 모든 타입 — 시도했지만 눈/얼굴 위치를 못 찾았거나(spider, iron_golem은
크롭을 여러 번 시도했는데도 실측 결과가 계속 엉뚱한 부분을 잘라서 정확한 좌표를 못
찾았다) 아예 시도하지 않은 몹들. 실제로 지도에서 자주 보이는데 계속 폴백으로만 나오면
`extracted/entity/` 재추출 + 격자 렌더로 좌표를 다시 잡을 것(이번 세션에서 쓴
`rendertex.mjs`/`cropmobs.mjs` 스크립트 방식 그대로 재사용 가능, 스크립트 자체는
저장소에 안 남겨뒀음 — 필요하면 다시 작성).

## 플레이어 얼굴 (예외 — 이 폴더에 없음)

계정마다 실시간으로 다른 데이터라 미리 저장할 수 없다. `bridge-paper`가 Mojang 세션
서버에서 매번 직접 받아 크롭해서 서빙한다(`GET /bridge/players/{uuid}/head`) — 자세한
내용은 `packages/bridge-paper/README.md` 참고.
