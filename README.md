# WebCraftOps 사양 저장소

WebCraftOps는 웹 기반 Minecraft Ops 콘솔, 3D 월드 에디터, 블루프린트/스키매틱 워크플로우를 통합한 플랫폼을 목표로 합니다. 이 저장소는 설계 사양과 구현을 위한 기본 구조를 함께 제공합니다.

## 문서 안내

- [WebCraftOps 사양 v0.3](docs/spec-v0.3.md)

## 패키지 구성

- `packages/shared`: 공통 데이터 모델 및 API 계약
- `packages/bridge-core`: Bridge 코어 어댑터 인터페이스
- `packages/frontend`: 웹 프런트엔드 (서버 선택 UI 포함)
- `packages/backend`: 웹 백엔드 (서버 프로필/브릿지 테스트)

## 폴더 구조

```
.
├── docs/
│   └── spec-v0.3.md
├── packages/
│   ├── backend/
│   │   ├── README.md
│   │   └── src/
│   │       ├── index.ts
│   │       └── server.ts
│   ├── bridge-core/
│   │   ├── README.md
│   │   └── src/
│   │       └── adapters.ts
│   ├── frontend/
│   │   ├── README.md
│   │   └── src/
│   │       ├── app.js
│   │       ├── index.html
│   │       └── index.ts
│   └── shared/
│       ├── README.md
│       └── src/
│           ├── backend-api.ts
│           └── bridge-api.ts
└── README.md
```

## 사용 방법

사양을 확인하려면 상단의 v0.3 문서를 열어 주세요. 구현 및 검토는 해당 문서를 기준으로 진행합니다.
