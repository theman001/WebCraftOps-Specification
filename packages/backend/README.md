# backend 패키지

WebCraftOps 백엔드 API 서버의 초기 뼈대를 제공합니다. 서버 프로필 저장과 Bridge 연결 테스트 등 1단계 MVP를 위한 기본 라우팅을 포함합니다.

## 포함 기능 (초기)

- 서버 프로필 목록/생성/삭제
- Bridge 연결 테스트 엔드포인트
- Bridge 레지스트리 프록시 엔드포인트
- 헬스 체크

## 로컬 실행 예시

```
WEBCRAFTOPS_BACKEND_AUTO_START=true node ./packages/backend/src/index.ts
```
