# WebCraftOps 사양 저장소

WebCraftOps는 웹 기반 Minecraft Ops 콘솔, 3D 월드 에디터, 블루프린트/스키매틱 워크플로우를 통합한 플랫폼을 목표로 합니다. 이 저장소는 설계 사양과 구현을 위한 기본 구조를 함께 제공합니다.

## 문서 안내

- [WebCraftOps 사양 v0.3](docs/spec-v0.3.md)
- [Phase 3 통합 검증 시나리오](docs/phase3-validation.md)

## 패키지 구성

- `packages/shared`: 공통 데이터 모델 및 API 계약
- `packages/bridge-core`: Bridge 코어 어댑터 인터페이스 (Fabric 설계, TypeScript)
- `packages/bridge-mock`: Bridge 모의 서버 (Registry Dump 테스트용)
- `packages/bridge-paper`: 실제 Paper 서버용 Bridge 플러그인 (Java/Gradle)
- `packages/frontend`: 웹 프런트엔드 (서버 선택/팔레트/Edit Job UI)
- `packages/backend`: 웹 백엔드 (서버 프로필/브릿지 테스트)

## 폴더 구조

```
.
├── Dockerfile               # 백엔드(+프런트 정적 서빙) 이미지
├── docker-compose.yml
├── docs/
│   └── spec-v0.3.md
├── packages/
│   ├── backend/              # Node 백엔드 + 프런트 정적 서빙
│   ├── bridge-core/          # Fabric 설계(TypeScript, 참고용 — 실서버는 bridge-paper 사용)
│   ├── bridge-mock/          # Bridge 모의 서버 (로컬 테스트용)
│   ├── bridge-paper/         # 실제 Paper 서버용 Bridge 플러그인 (Java/Gradle)
│   ├── frontend/             # 웹 프런트엔드 (연결/빌드/블루프린트/작업&로그/콘솔 탭)
│   └── shared/                # 공통 타입
└── README.md
```

## 사용 방법

사양을 확인하려면 상단의 v0.3 문서를 열어 주세요. 구현 및 검토는 해당 문서를 기준으로 진행합니다.

## 빠른 시작 (Docker)

```bash
BRIDGE_TOKEN=<bridge-paper와 동일한 값> docker compose up -d --build
```

`http://<호스트>:4000/`을 열면 프런트엔드가 뜹니다. 자세한 내용은
[`packages/backend/README.md`](packages/backend/README.md), 플러그인은
[`packages/bridge-paper/README.md`](packages/bridge-paper/README.md) 참고.
