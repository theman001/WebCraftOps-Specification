# backend 패키지

WebCraftOps 백엔드 API 서버입니다. **`packages/frontend/src`의 정적 파일(index.html/app.js/
map.js 등)도 같은 서버·같은 포트에서 함께 서빙합니다** — 별도로 프런트 정적
서버를 띄울 필요가 없고, 사용자는 이 서버 하나의 주소만 열면 됩니다(예: `http://호스트:4000/`).
프런트는 Backend 주소를 몰라도 됩니다(항상 같은 오리진이라 상대 경로로 호출) — 사용자가
직접 입력하는 건 마인크래프트 Bridge 서버 주소뿐입니다.

## 포함 기능 (초기)

- 프런트엔드 정적 파일 서빙 (`GET /`, `/app.js`, `/map.js` 등)
- 서버 프로필 목록/생성/삭제
- Bridge 연결 테스트 엔드포인트
- Bridge 레지스트리 프록시 엔드포인트
- Bridge 지도 타일 프록시(`GET /bridge/world/overworld/map/tile`) + 지도 변경 SSE
  프록시(`GET /bridge/world/overworld/map/events`)
- 엔티티 스냅샷 SSE 프록시(`GET /bridge/world/overworld/entities/stream`) + 플레이어
  얼굴 이미지 프록시(`GET /bridge/players/:uuid/head`)
- SSE 프록시 3종(콘솔 로그/지도 이벤트/엔티티 스트림)이 `proxySse()` 공용 헬퍼를,
  이미지 프록시 2종(지도 타일/플레이어 얼굴)이 `proxyImage()` 공용 헬퍼를 공유한다 —
  브라우저 EventSource가 커스텀 헤더를 못 보내는 문제 때문에 프런트는 이 프록시로만
  붙고, 브릿지로 나가는 요청에만 토큰을 싣는다
- 명령어 실행(`POST /bridge/console/command`)
- Edit Job 시스템 (Command 패턴 기반)
- Edit Job 메트릭 업데이트 (adaptive throttle 준비)
- 블루프린트 메타데이터 저장/조회
- 감사 로그 조회 (/audit)
- 헬스 체크

## 실행 방법

### Docker (권장)

```
BRIDGE_TOKEN=<bridge-paper와 동일한 값> docker compose up -d --build
```

저장소 루트의 `Dockerfile`/`docker-compose.yml` 참고. 감사 로그 SQLite 파일은
`webcraftops-data` 볼륨에 남는다. code-server의 `/proxy/<port>/` 같은 내장 프록시는
SSE(콘솔 로그 스트리밍)를 제대로 못 흘려보내는 경우가 있으니, 이 컨테이너의 포트를
그런 프록시를 거치지 않고 직접 노출하는 걸 권장한다.

### 로컬 실행 (tsx)

```
BRIDGE_TOKEN=<bridge-paper와 동일한 값> WEBCRAFTOPS_BACKEND_AUTO_START=true npx tsx packages/backend/src/index.ts
```

`packages/backend/src/index.ts`는 TypeScript라 일반 `node`로 직접 실행할 수 없다(Node
버전에 따라 `--experimental-strip-types`가 필요) — `tsx`로 실행한다.

브라우저에서 `http://localhost:4000/`을 열면 프런트엔드가 뜹니다.

## 감사 로그 DB

- 기본 저장소: SQLite (`data/webcraftops.sqlite`)
- 드라이버 선택: `WEBCRAFTOPS_DB_DRIVER=sqlite|postgres`
- SQLite 경로: `WEBCRAFTOPS_DB_PATH`
- Postgres 연결: `WEBCRAFTOPS_POSTGRES_URL` (pg 패키지 필요)
- 필터: `userId`, `worldId`, `commandType`, `since`, `until`, `limit`, `cursor`

## 메트릭 입력 경로

- 수동 업데이트: `POST /bridge/edit/jobs/:jobId/metrics`
- 자동 샘플링(테스트용): `POST /bridge/edit/jobs/:jobId/metrics/auto`, 중지 `POST /bridge/edit/jobs/:jobId/metrics/auto/stop`
