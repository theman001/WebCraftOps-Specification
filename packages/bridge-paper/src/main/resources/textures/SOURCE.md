# 텍스처 출처

`block/*.png`는 Mojang 공식 클라이언트 배포물에서 직접 추출했다. 서드파티 소스 없음.

- Minecraft 버전: `26.2` (버전 매니페스트 `https://launchermeta.mojang.com/mc/game/version_manifest_v2.json`
  기준 최신 release — 실서버(192.168.0.126)가 보고하는 Paper 빌드가 실제로 이 버전 위에서
  돈다, `curl https://api.papermc.io/v3/projects/paper`로 대조 확인함)
- 클라이언트 jar: `https://piston-data.mojang.com/v1/objects/2dc72797acbc1b63fc16a11c4ac393605f453754/client.jar`
  (해당 버전의 `piston-meta` JSON `downloads.client.url`)
- 추출 방법: jar(zip)에서 `assets/minecraft/textures/block/*.png` 전체(1269개)를 그대로 복사.
  가공/재압축 없음.

## MapTileRenderer가 텍스처를 고르는 방식

Bukkit `Material` 이름(소문자)을 기준으로 다음 순서로 파일을 찾는다:
1. `{material}_top.png` (예: `grass_block` → `grass_block_top.png`, `oak_log` → `oak_log_top.png`)
2. `{material}.png`
3. 위 두 개 다 없으면 회색 폴백 색상(텍스처 없음을 시각적으로 티나게 — 조용히 틀린 텍스처를
   보여주지 않는다).

이건 완전 자동화된 휴리스틱이라 100% 정확하진 않다(일부 블록은 위 두 이름 규칙과 다른
텍스처 파일명을 쓴다 — 예: 문/트랩도어처럼 여러 파츠로 구성된 블록, 특수 명명 규칙을 쓰는
일부 블록). 실제로 지도에서 회색으로 보이는 블록이 있으면 그 Material 이름과 실제 텍스처
파일명을 대조해서 `MapTileRenderer`의 매핑 규칙에 예외를 추가할 것.

## 애니메이션 텍스처(물/용암 등)

일부 텍스처는 세로로 긴 스프라이트시트(예: 16x512 = 32프레임)다. 렌더러는 항상 맨 위
16x16(첫 프레임)만 사용한다.

## 바이옴 틴트

`grass_block_top`, `*_leaves`, `water_still` 등은 원본 텍스처가 그레이스케일/특정 색조라
게임이 바이옴별 색상을 곱해서 보여준다. `MapTileRenderer`는 이 블록들에 한해 표준 평원
바이옴 근사 색(잔디/나뭇잎 `#7CBD6B` 계열, 물 `#3F76E4` 계열)을 곱해서 회색/보라 얼룩으로
안 보이게 한다 — 바이옴별 정확한 색상까지는 아직 구현하지 않음(전부 평원 바이옴 색 근사).
