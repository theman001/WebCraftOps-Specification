# 텍스처 출처

`block/*.png`는 Mojang 공식 클라이언트 배포물에서 직접 추출했다. 서드파티 소스 없음.

- Minecraft 버전: `26.2` (버전 매니페스트 `https://launchermeta.mojang.com/mc/game/version_manifest_v2.json`
  기준 최신 release — 실서버(192.168.0.126)가 보고하는 Paper 빌드가 실제로 이 버전 위에서
  돈다, `curl https://api.papermc.io/v3/projects/paper`로 대조 확인함)
- 클라이언트 jar: `https://piston-data.mojang.com/v1/objects/2dc72797acbc1b63fc16a11c4ac393605f453754/client.jar`
  (해당 버전의 `piston-meta` JSON `downloads.client.url`)
- 추출 방법: jar(zip)에서 `assets/minecraft/textures/block/*.png` 전체(1269개)를 그대로 복사.
  가공/재압축 없음.

## MapTileRenderer(정확히는 Textures.java)가 텍스처를 고르는 방식

**실측 검증 완료** — 실서버(192.168.0.126)의 실제 블록 레지스트리(`/bridge/registry/blocks`,
1193개)를 받아서 아래 규칙으로 몇 개가 실제 텍스처를 찾는지 시뮬레이션했다: 개선 전
55.6%(663/1193) → 개선 후 **88.6%(1057/1193)**. 나머지 11.4%(136개)는 화분에 심은 식물,
머리/해골, 커맨드 블록, 산호 fan, 가마솥, 웨이드 코팅 구리 상자/골렘 조각상 등 —
공중에서 보는 지도에서 굳이 정확한 텍스처가 없어도 되는 소품/기술 블록들이라 회색으로 남겨둠.

순서(Bukkit `Material` 이름 소문자 기준):
1. `OVERRIDES` 수동 매핑(예: `water`→`water_still`, `smooth_quartz`→`quartz_block_top`)
2. `{material}_top.png`, 없으면 `{material}.png`
3. 파생 블록(슬래브/계단/벽/펜스/버튼/문/신호판/모자이크 등) — 접미사를 떼고 부모 이름
   후보(그대로/복수형"s"/"_block"/"_planks"/"_log")를 순서대로 시도. 예:
   `stone_brick_slab` → `stone_bricks.png`, `oak_fence` → `oak_planks.png`,
   `stripped_acacia_wood` → `stripped_acacia_log.png`
4. 접두사 벗기고 재시도(`waxed_`/`infested_` — 원본과 텍스처가 사실상 동일)
5. 염료색 블록(배너/침대/카펫 등, 텍스처를 재사용할 부모가 없음) — 이름 앞 색상 단어로
   실제 Mojang 울/염료 팔레트 단색 스와치
6. 그래도 없으면 회색 체커(텍스처 없음을 시각적으로 티나게 — 조용히 틀린 텍스처를
   보여주지 않는다)

100% 정확하진 않다(부모 텍스처를 그대로 6면에 쓰는 근사라 실제 슬래브 옆면 음영 등은
없음). 회색으로 보이는 블록이 계속 거슬리면 `Textures.OVERRIDES`에 예외를 추가할 것 —
어떤 Material이 실패했는지는 `[Textures]` 경고 로그에 전부 남는다(같은 Material은 한 번만).

## 애니메이션 텍스처(물/용암 등)

일부 텍스처는 세로로 긴 스프라이트시트(예: 16x512 = 32프레임)다. 렌더러는 항상 맨 위
16x16(첫 프레임)만 사용한다.

## 바이옴 틴트

`grass_block_top`, `*_leaves`, `water_still` 등은 원본 텍스처가 그레이스케일/특정 색조라
게임이 바이옴별 색상을 곱해서 보여준다. `MapTileRenderer`는 이 블록들에 한해 표준 평원
바이옴 근사 색(잔디/나뭇잎 `#7CBD6B` 계열, 물 `#3F76E4` 계열)을 곱해서 회색/보라 얼룩으로
안 보이게 한다 — 바이옴별 정확한 색상까지는 아직 구현하지 않음(전부 평원 바이옴 색 근사).
