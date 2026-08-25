# frontend 패키지

WebCraftOps 웹 프런트엔드입니다. **독립 실행 파일이 아니라 `packages/backend`가 같은
오리진에서 서빙합니다** — 백엔드를 띄우고 `http://호스트:포트/`를 열면 됩니다(자세한 내용은
`packages/backend/README.md` 참고). 탭(연결/빌드/블루프린트/작업&로그) 구조이며, 사용자는
마인크래프트 서버(Bridge) 주소만 입력하면 됩니다.

## 포함 기능

- 서버(Bridge) 주소 입력 및 연결 테스트, 최근 서버 기록 (LocalStorage)
- 블록 팔레트 검색 + 클릭으로 브러시 블록 선택
- 3D 월드 뷰어: 실제 Three.js(r160, `vendor/three.module.js`) + OrbitControls
  (드래그 회전 · 휠 줌 · 오른쪽 드래그 이동), 지표면 자동 포커스, 클릭으로 배치/조회.
  배치는 클릭한 블록을 바꾸는 게 아니라 클릭한 면 바깥쪽에 새 블록을 놓으며(호버 시
  노란 반투명 미리보기로 위치 확인), 성공하면 서버 재조회 없이 씬에 바로 반영된다.
  시점 설정 패널(회전/줌/이동 속도, 청크 반경)에서 조정한 반경만큼 카메라(정확히는
  OrbitControls target) 주변 청크를 실시간으로 로드/언로드한다(월드 X/Z 좌표계로 통일해
  인접 청크가 이어짐)
- 리소스팩(.zip) 업로드 → 브라우저에서 직접 압축 해제(`resourcepack.js`, 외부 라이브러리
  없이 내장 `DecompressionStream` 사용) → 블록 텍스처를 3D 뷰에 적용. 블록당 텍스처
  1장을 6면에 동일 적용하는 단순화 버전(면별 텍스처/생물군계 색조 보정은 생략)
- 블록 이름 전체 마인크래프트 공식 한국어 번역 표시 (`vendor/block-names-ko.json`,
  Mojang 공식 `ko_kr.json`의 `block.minecraft.*`에서 추출, 미번역 극소수만 영문 폴백)
- Edit Job 생성/조회/상태 변경 + Undo/Redo UI
- Blueprint/Schematic 업로드 및 붙여넣기 작업 생성 UI
- 감사 로그 대시보드 UI (필터/조회 개수/페이지네이션 포함)
- 서버 콘솔 탭: 관리자(콘솔) 권한 실시간 로그(채팅 포함) SSE 스트리밍 + 명령어 입력.
  연결이 끊기면 브라우저 `EventSource`가 자동 재시도한다
- Three.js/OrbitControls CDN 의존 제거를 위한 로컬 모듈 사용 (`vendor/`)
