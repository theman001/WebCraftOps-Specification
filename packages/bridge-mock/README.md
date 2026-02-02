# bridge-mock 패키지

프런트엔드/백엔드 연동을 검증하기 위한 Bridge 모의 서버입니다. Registry Dump 2.0과 기본 Info 응답을 제공합니다.

## 포함 기능 (초기)

- `GET /bridge/info`
- `GET /bridge/registry/blocks`

## 로컬 실행 예시

```
WEBCRAFTOPS_BRIDGE_MOCK_AUTO_START=true node ./packages/bridge-mock/src/index.ts
```
