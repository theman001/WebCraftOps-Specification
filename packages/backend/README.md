# backend 패키지

WebCraftOps 백엔드 API 서버의 초기 뼈대를 제공합니다. 서버 프로필 저장과 Bridge 연결 테스트 등 1단계 MVP를 위한 기본 라우팅을 포함합니다.

## 포함 기능 (초기)

- 서버 프로필 목록/생성/삭제
- Bridge 연결 테스트 엔드포인트
- Bridge 레지스트리 프록시 엔드포인트
- Bridge 청크 프록시 엔드포인트
- Edit Job 시스템 (Command 패턴 기반)
- Edit Job 메트릭 업데이트 (adaptive throttle 준비)
- 블루프린트 메타데이터 저장/조회
- 감사 로그 조회 (/audit)
- 헬스 체크

## 로컬 실행 예시

```
WEBCRAFTOPS_BACKEND_AUTO_START=true node ./packages/backend/src/index.ts
```

## 감사 로그 DB

- 기본 저장소: SQLite (`data/webcraftops.sqlite`)
- 드라이버 선택: `WEBCRAFTOPS_DB_DRIVER=sqlite|postgres`
- SQLite 경로: `WEBCRAFTOPS_DB_PATH`
- Postgres 연결: `WEBCRAFTOPS_POSTGRES_URL` (pg 패키지 필요)
- 필터: `userId`, `worldId`, `commandType`, `since`, `until`, `limit`, `cursor`

## 메트릭 입력 경로

- 수동 업데이트: `POST /bridge/edit/jobs/:jobId/metrics`
- 자동 샘플링(테스트용): `POST /bridge/edit/jobs/:jobId/metrics/auto`, 중지 `POST /bridge/edit/jobs/:jobId/metrics/auto/stop`
