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

크롭 방법(2차 개정): 각 원본 텍스처에서 실제 눈(또는 가장 식별하기 쉬운 특징 — 거미는
빨간 눈, 박쥐는 보라색 눈)의 정확한 픽셀 좌표를 직접 스캔해서(밝기/색상 임계값으로 원본
해상도에서 찾음) 찾은 뒤, **그 좌표를 중심으로 8x8을 그대로 잘라서 썼다(리사이즈 없이
1:1)** — 16x16처럼 큰 영역을 크롭해서 8x8로 축소하면 나이어리스트 샘플링이 격자에 안
걸리는 눈동자 같은 1~2px짜리 디테일을 통째로 날려버리는 문제가 있었다(1차 시도에서
실측으로 확인 — 결과물이 죄다 특징 없는 단색 덩어리로 나왔었음). 좌표는 아래에 정확히
기록 — 나중에 다른 몹 추가하거나 좌표 보정할 때 참고할 것.

| 몹(EntityType) | 소스 텍스처 | 크롭 (x,y,w,h) | 비고 |
|---|---|---|---|
| ZOMBIE, ZOMBIE_VILLAGER, DROWNED | zombie/zombie.png | 8,8,8,8 | 휴머노이드 표준 얼굴 UV(모든 휴머노이드 몹 공통) |
| SKELETON, STRAY, WITHER_SKELETON | skeleton/skeleton.png | 8,8,8,8 | 위와 동일 규칙 |
| HUSK | zombie/husk.png | 8,8,8,8 | |
| VILLAGER, WANDERING_TRADER | villager/villager.png | 8,8,8,8 | |
| WITCH | witch/witch.png | 8,8,8,8 | |
| ENDERMAN | enderman/enderman.png | 8,8,8,8 | |
| CREEPER | creeper/creeper.png | 8,8,8,8 | 큐브형 머리도 동일 UV 규칙을 따름 |
| COW, MOOSHROOM | cow/cow_temperate.png | 6,5,8,8 | MOOSHROOM은 실제 버섯소 텍스처 아님(근사). 눈은 흰자+검은자(흑백), 코 옆 검은 반점이 아니라 이쪽이 진짜 눈 |
| PIG | pig/pig_temperate.png | 8,7,8,8 | |
| SHEEP | sheep/sheep.png | 7,6,8,8 | |
| CHICKEN | chicken/chicken_temperate.png | 1,0,8,8 | |
| WOLF | wolf/wolf.png | 3,2,8,8 | |
| CAT | cat/cat_black.png | 3,2,8,8 | 검은 고양이 변종만(다른 무늬 미지원). 초록 눈이 뚜렷하게 나옴 |
| RABBIT | rabbit/rabbit_brown.png | 3,19,8,8 | |
| BEE | bee/bee.png | 9,7,8,8 | |
| HORSE, DONKEY | horse/horse_brown.png (donkey는 horse/donkey.png) | 0,17,8,8 | DONKEY는 실제 당나귀 텍스처를 따로 씀(근사 아님) — 실측해보니 눈 좌표가 말과 동일 |
| SPIDER | spider/spider.png | 39,11,8,8 | 빨간 겹눈 4개가 몸통 오른쪽에 뭉쳐 있음(왼쪽은 전부 몸통 털) |
| CAVE_SPIDER | spider/cave_spider.png | 39,11,8,8 | 스파이더와 동일 UV 레이아웃, 텍스처만 청록색 |
| BAT | bat/bat.png | 2,13,8,8 | 보라색 눈 두 개가 나란히 있는 정면 UV(측면 UV는 눈이 하나만 보여서 씀 안 함) |

**미지원(전부 `_fallback.png`)**: IRON_GOLEM, SLIME/MAGMA_CUBE, 그 외 목록에 없는 모든
타입 — 시도했지만 눈/얼굴 위치를 못 찾았거나(iron_golem은 크롭을 여러 번 시도했는데도
실측 결과가 계속 엉뚱한 부분을 잘라서 정확한 좌표를 못 찾았다) 아예 시도하지 않은
몹들. 실제로 지도에서 자주 보이는데 계속 폴백으로만 나오면 이번에 정리한 방법(색상
스캔으로 눈 픽셀 좌표 직접 찾기 → 그 좌표 중심 8x8을 리사이즈 없이 크롭)으로 좌표를
다시 잡을 것 — 스크립트 자체는 저장소에 안 남겨뒀음(필요하면 다시 작성, 방법은 위
문단 참고).

## 플레이어 얼굴 (예외 — 이 폴더에 없음)

계정마다 실시간으로 다른 데이터라 미리 저장할 수 없다. `bridge-paper`가 Mojang 세션
서버에서 매번 직접 받아 크롭해서 서빙한다(`GET /bridge/players/{uuid}/head`) — 자세한
내용은 `packages/bridge-paper/README.md` 참고.
