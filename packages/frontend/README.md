# frontend 패키지

WebCraftOps 웹 프런트엔드입니다. **독립 실행 파일이 아니라 `packages/backend`가 같은
오리진에서 서빙합니다** — 백엔드를 띄우고 `http://호스트:포트/`를 열면 됩니다(자세한 내용은
`packages/backend/README.md` 참고). 탭(연결/지도/블루프린트/작업&로그/콘솔) 구조이며,
사용자는 마인크래프트 서버(Bridge) 주소만 입력하면 됩니다.

> 이전엔 Three.js 기반 3D 뷰어 + 클릭 배치(브러시)였는데, 청크가 늘어날수록 느려지는
> 문제로 **실시간 2D 지도**로 전면 교체했다(`map.js`). 브러시(클릭으로 블록 배치)는
> 이번 개편에서 제거 — 나중에 필요하면 별도로 다시 붙일 예정. 관련 3D 코드/리소스
> (`vendor/three.module.js`, `vendor/OrbitControls.js`, `chunk-worker.js`,
> `resourcepack.js`, 블록 팔레트 UI)는 전부 삭제했다.

## 포함 기능

- 서버(Bridge) 주소 입력 및 연결 테스트, 최근 서버 기록 (LocalStorage)
- **실시간 2D 지도** (`map.js`): bridge-paper가 청크마다 실제 블록 텍스처를 합성해 만든
  PNG 타일을 그대로 그린다(클라이언트는 렌더링을 안 하므로 청크가 많아져도 안 느려짐).
  드래그로 이동, 휠로 확대/축소(커서 위치 기준). 뷰포트에 걸친 타일만 로드/해제하고,
  블록이 바뀐 청크는 SSE(`bridge/world/overworld/map/events`)로 알림을 받아 그 타일만
  다시 받는다 — 지도 전체를 다시 그리지 않는다.
- **엔티티 패널**(지도 탭 상단 체크박스 3개 — 유저/몹/아이템): `entities/stream` SSE로
  300ms마다 오는 스냅샷을 지도 위에 마커로 그린다. 유저는 `bridge/players/{uuid}/head`
  (bridge-paper가 Mojang 세션 서버에서 직접 받아 서빙, 자체 호스팅), 몹/아이템은
  `assets/mobs/`·`assets/items/`에 번들된 실제 Mojang 텍스처(출처는
  `assets/SOURCE.md`) — 크롭 안 된 몹 타입은 `assets/mobs/_fallback.png`로 대체.
  마커를 클릭하면 그 위치로 지도 중심이 이동한다(드래그와는 이동 거리로 구분).
- Edit Job 생성/조회/상태 변경 + Undo/Redo UI
- Blueprint/Schematic 업로드 및 붙여넣기 작업 생성 UI
- 감사 로그 대시보드 UI (필터/조회 개수/페이지네이션 포함)
- 서버 콘솔 탭: 관리자(콘솔) 권한 실시간 로그(채팅 포함) SSE 스트리밍 + 명령어 입력.
  연결이 끊기면 브라우저 `EventSource`가 자동 재시도한다
