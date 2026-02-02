# WebCraftOps 사양 v0.3 (AI 에이전트 지향)

프로젝트: WebCraftOps
유형: 웹 기반 Minecraft Ops 콘솔 + 3D 월드 에디터 + 블루프린트/스키매틱 워크플로우
대상: 모디드 Minecraft 서버 (Fabric / Forge / NeoForge)
설계 원칙: 서버로부터의 진실 (하드코딩된 블록 목록 없음, 버전 불가지)

## 0) 문서 메타

- 문서명: WebCraftOps 사양 v0.3
- 상태: 기획 / 설계 스펙
- 주 소비자: AI 에이전트 (구현 준비 사양)
- 부 소비자: 인간 개발자 / 리뷰어
- 버전: v0.3
- 이전: v0.2 (스캐폴딩 & 저장소 구조)

### v0.3 핵심 업데이트

- Registry Dump 2.0 (속성 인지 + SNBT + 렌더 힌트)
- 청크 이진 전송 (protobuf/msgpack + 팔레트/RLE/VarInt + 압축)
- Edit Job 시스템 (커맨드 패턴 + Undo/Redo + 감사 로그)
- 적응형 스로틀링 (MSPT 기반)
- 보안 우선 인증 모델 (온라인 모드)
- 최종 AI 에이전트 지침 (DI/워커/안전/확장성)

## 1) 프로젝트 개요

### 1.1 미션

다음 기능을 제공하는 통합 웹 플랫폼을 구축한다.

- 서버 운영 (Ops 콘솔)
- 브라우저 내 월드 시각화 및 편집 (3D 에디터)
- 블루프린트/스키매틱 생성 및 라이브 월드 안전 붙여넣기
- 모드 서버 지원 (버전 하드코딩 금지)

## 2) 목표 및 비목표

### 2.1 목표 (필수)

- 웹 기반 서버 운영
  - 상태 대시보드
  - 명령 실행
  - 로그
  - 백업/복원 (선택)
- 웹 기반 3D 월드 뷰어/에디터
  - 청크 스트리밍
  - 마우스 기반 빌딩 (블록 설정/제거)
  - 브러시, 선택, 채우기/치환
  - Undo/Redo
- 블루프린트/스키매틱 워크플로우
  - 샌드박스 편집 모드
  - .schem 저장/로드
  - 회전/미러/앵커로 월드 붙여넣기
- 버전 불가지
  - 여러 MC 버전 및 모드 로더 지원
  - 동적 레지스트리 추출
- 서버 안전 우선
  - 작업 큐
  - MSPT/TPS 기반 적응형 스로틀링

### 2.2 비목표 (v0.x)

- 모든 모드 블록 모델의 픽셀 퍼펙트 렌더링
- 브라우저 내 완전한 게임 클라이언트
- WebCraftOps 범위를 벗어나는 치트/익스플로잇 방지
- 멀티플레이어 병합 충돌 해결 (추후 고려)

## 3) 핵심 개념

### 3.1 서버로부터의 진실

WebCraftOps는 정적인 블록/아이템 목록을 유지하지 않는다. 대신 Minecraft Bridge가 다음 정보를 추출한다.

- 레지스트리
- 상태 속성
- 기본 상태
- NBT 페이로드 (SNBT)
- 렌더 힌트

웹 UI는 서버 매핑을 기준으로 동적으로 생성된다.

### 3.2 로더 불가지 코어

브릿지 로직은 다음으로 분리한다.

- BridgeCore: 공통 로직 및 API 계약
- Loader Adapter: Fabric/Forge/NeoForge별 접근 계층

## 4) 시스템 아키텍처 (상위 수준)

### 4.1 구성 요소

- 웹 프런트엔드
  - 서버 선택 페이지 (사용자 입력 Bridge URL)
  - Ops 콘솔
  - 3D 월드 에디터 (Three.js)
  - 블루프린트 에디터
  - 무거운 디코드/메시 빌드를 위한 Web Worker
- 웹 백엔드 (API 서버)
  - Microsoft OAuth (OIDC)
  - 세션/토큰 관리
  - 서버 프로필 캐시 (최근/핀)
  - 블루프린트 저장
  - 감사 로그 저장
  - 브릿지 엔드포인트 리버스 프록시/게이트웨이 (선택)
- Minecraft Bridge 모드
  - Minecraft 서버에서 실행
  - Bridge API 엔드포인트 제공
  - 레지스트리 매핑 추출
  - 이진 포맷 청크 스트리밍
  - 작업 큐를 통한 편집 적용 (안전 실행)
  - 권한 검사
- 스토리지
  - 블루프린트: 오브젝트 스토리지 또는 파일 시스템
  - 감사 로그: DB (SQLite/Postgres)
  - 선택: 청크 캐시 스토어

## 5) 첫 페이지 요구 사항 (사용자 제공 서버)

### 5.1 서버 주소 하드코딩 금지

웹 UI는 사용자가 Bridge 서버 주소를 입력하도록 요구해야 한다.

- 사용자가 bridgeUrl 입력
- 시스템은 연결성 테스트 (GET /bridge/info)
- 성공 시 로그인 → 콘솔

### 5.2 서버 프로필 캐시

프런트엔드는 다음을 수행해야 한다.

- 최근 서버를 LocalStorage/IndexedDB에 저장
- 즐겨찾기 핀
- 별칭 지정
- 선택적으로 자동 재연결

보안:

- 장기 민감 토큰을 안전하지 않은 스토리지에 저장하지 않는다.
- 가능하면 httpOnly 쿠키 사용.

## 6) [신규] 데이터 & 렌더링: Registry Dump 2.0

레지스트리 덤프는 버전 불가지 에디터를 위한 서버 생성 매핑 테이블이다.

### 6.1 목표

브릿지는 다음에 필요한 모든 데이터를 내보내야 한다.

- 블록 선택 (팔레트)
- 블록 상태 선택 (속성)
- 블루프린트 변환 및 복원
- UX를 위한 최소 렌더 힌트

### 6.2 출력 요구 사항

#### 6.2.1 속성 인지 덤프

각 블록 엔트리는 다음을 포함한다.

- id (네임스페이스)
- properties: 상태 속성 키 및 허용 값
- defaultState

예시:

```
{
  "id": "minecraft:oak_log",
  "properties": {
    "axis": ["x", "y", "z"]
  },
  "defaultState": {
    "axis": "y"
  }
}
```

#### 6.2.2 NBT 전략 (SNBT)

BlockEntity/TileEntity 데이터는 다음 방식으로 처리한다.

- SNBT로 직렬화
- 기본적으로 불투명 페이로드로 취급
- 선택적으로 편집 가능한 UI 컴포넌트로 파싱

예시:

```
{
  "pos": [10, 64, 10],
  "block": "minecraft:chest",
  "state": {"facing": "north"},
  "nbt_snbt": "{Items:[{Slot:0b,id:\"minecraft:diamond\",Count:64b}]}"
}
```

선택적 SNBT 편집 모듈:

- 표지판 텍스트
- 커맨드 블록 필드
- 배너, 책
- 모드별 UI 모듈은 추후 추가 가능

#### 6.2.3 렌더 힌트

브릿지는 웹 UX를 위해 블록당 최소 렌더 힌트를 내보내야 한다.

지원 타입:

- cube
- pane
- cross
- slab
- stairs
- fluid
- placeholder

예시:

```
{
  "id": "create:shaft",
  "renderHint": {
    "type": "placeholder",
    "label": "shaft"
  }
}
```

핵심 규칙:

- 렌더 힌트는 정확도보다 사용성에 초점.
- placeholder 블록은 정확히 렌더되지 않아도 선택/배치 가능해야 한다.

## 7) [신규] 네트워킹: Protocol Buffers & 이진 전송

### 7.1 동기

청크 스트리밍은 다음을 야기해서는 안 된다.

- 과도한 JSON 페이로드
- 브라우저 GC 일시 정지
- 메인 스레드 디코드 병목

### 7.2 전송 요구 사항

청크 데이터 전송은 다음을 우선한다.

- Protobuf 또는 MessagePack (이진)
- JSON은 디버그 또는 소량 페이로드에 한정

### 7.3 청크 페이로드 최적화

이진 청크 페이로드는 다음을 포함해야 한다.

- 팔레트 딕셔너리 (palette[])
- 팔레트를 참조하는 복셀 블록 인덱스
- 압축:
  - RLE
  - VarInt
  - 선택: 델타 인코딩
- 최종 압축:
  - 환경 기반 gzip/br/deflate

#### 7.3.1 예시 패킷 구조 (개념)

```
ChunkPacket:
  cx, cz
  sectionCount
  palette[] (string ids)
  data[] (varint encoded palette indices, RLE compressed)
  optional: light data
```

### 7.4 Web Worker 요구 사항

프런트엔드는 다음을 수행해야 한다.

- Web Worker에서 청크 패킷 디코드
- 메인 스레드 외부에서 메시 빌드
- 렌더링용 최종 버퍼만 메인 스레드로 전송

## 8) [신규] 실행: Edit Job 시스템 & 적응형 스로틀링

### 8.1 핵심 철학

모든 편집은 제어된 파이프라인을 거쳐야 한다.

작업 큐 → 배치 적용 → 적응형 스로틀 → 감사

웹에서 임의의 setblock 루프를 직접 실행하는 것은 금지한다.

### 8.2 커맨드 패턴 (Undo/Redo + 감사)

모든 편집은 Command 객체로 표현한다.

- apply()
- revert()
- 감사 메타데이터

커맨드 예시:

- SetBlockCommand
- FillCommand
- ReplaceCommand
- PasteBlueprintCommand
- CloneCommand

#### 8.2.1 감사 로그 요구 사항

모든 작업은 다음을 기록해야 한다.

- 사용자 ID + MC UUID
- 타임스탬프
- 영향을 받은 월드 + 청크 범위
- 예상 블록 수
- 커맨드 유형 + 파라미터
- 적용 결과 + 소요 시간

### 8.3 적응형 스로틀링 (MSPT 기반)

브릿지는 다음을 사용해 적응형 스로틀링을 구현한다.

- MSPT (주)
- TPS (보조)
- 틱 백로그 감지

#### 8.3.1 요구 동작

동적으로 조정:

- 배치 크기
- 배치 간 지연

하드 스톱 조건:

- TPS < 15 → 작업 실행 즉시 일시 정지
- 서버 안정화 시 재개

#### 8.3.2 정책 예시 (가이드라인)

- MSPT < 35ms: 배치 크기 증가
- MSPT 35~45ms: 유지
- MSPT > 45ms: 배치 감소, 지연 증가
- TPS < 15: 큐 일시 정지

## 9) 보안: 보안 우선 모드

### 9.1 Secure Mode A (기본)

WebCraftOps는 다음을 공식 지원한다.

- online-mode=true 서버만 지원
- Microsoft OAuth (OIDC)
- Minecraft UUID 1:1 매핑

이 모드에서:

- 모든 권한 체크는 신뢰 가능
- 사용자는 암호학적으로 인증됨

### 9.2 오프라인 모드 정책

오프라인 서버는 본질적으로 신원을 보장할 수 없다.

정책:

- Secure Mode A에서 공식 지원하지 않음
- “로컬 모드”에서만 허용 (명시적 불안전 경고)

로컬 모드 요구 사항:

- 추가 화이트리스트
- 추가 서버 측 키
- UI 경고

### 9.3 권한 어댑터

브릿지는 다음 어댑터로 권한 체크를 구현해야 한다.

- OP 체크
- LuckPerms 노드 체크 (존재 시)
- 폴백 ACL 규칙

목표:

- 웹 UI에 서버 권한 의미를 보존

## 10) API 사양 (Bridge + Backend)

### 10.1 Bridge API (Minecraft)

기본 URL: bridgeUrl (사용자 입력)

- 정보
  - GET /bridge/info
- Registry Dump 2.0
  - GET /bridge/registry/blocks
  - GET /bridge/registry/items
  - GET /bridge/registry/render-hints
- 청크 스트리밍
  - GET /bridge/worlds
  - GET /bridge/world/{worldId}/chunks?cx=&cz=&radius=
    - 이진 페이로드 반환
- 편집 작업
  - POST /bridge/world/{worldId}/edit/jobs
  - GET /bridge/edit/jobs/{jobId}
  - POST /bridge/edit/jobs/{jobId}/pause
  - POST /bridge/edit/jobs/{jobId}/resume
  - POST /bridge/edit/jobs/{jobId}/cancel
- 명령
  - POST /bridge/command

### 10.2 웹 백엔드 API

- 인증
  - GET /auth/login/ms
  - GET /auth/callback
  - GET /auth/me
  - POST /auth/logout
- 서버
  - GET /servers
  - POST /servers
  - DELETE /servers/{id}
  - POST /bridge/test
- 블루프린트
  - GET /blueprints
  - POST /blueprints
  - GET /blueprints/{id}
  - POST /blueprints/{id}/paste
- 감사
  - GET /audit?worldId=&user=&time_range=

## 11) 데이터 모델

### 11.1 Registry Dump 응답

```
{
  "blocks": [
    {
      "id": "minecraft:stone",
      "properties": {},
      "defaultState": {},
      "renderHint": {"type": "cube"}
    }
  ],
  "generatedAt": "2026-02-02T00:00:00Z"
}
```

### 11.2 Edit Job

```
{
  "jobId": "uuid",
  "worldId": "overworld",
  "createdBy": "mc_uuid",
  "status": "running",
  "policy": {
    "adaptiveThrottle": true,
    "tpsPauseThreshold": 15
  },
  "stats": {
    "estimatedBlocks": 50000,
    "doneBlocks": 12000,
    "mspt": 42.5,
    "tps": 18.9
  }
}
```

### 11.3 블루프린트 메타데이터

```
{
  "id": "castle_v1",
  "name": "Castle v1",
  "format": "schem",
  "size": [120, 45, 80],
  "blocks": 53200,
  "tags": ["castle", "medieval"],
  "created_by": "mc_uuid",
  "created_at": "2026-02-02T00:00:00Z"
}
```

## 12) 개발 로드맵

### Phase 1 (MVP)

- 서버 선택 + 캐시
- OAuth 로그인 (스텁 → 실체)
- Ops 대시보드
- Registry Dump 2.0 (blocks + properties)
- 단순 청크 스트림 + 최소 렌더
- setblock 명령을 작업으로 실행

### Phase 2 (Builder Toolset)

- 브러시/선택 작업
- schem 내보내기/가져오기
- 작업 큐로 붙여넣기
- 커맨드 패턴 기반 Undo/Redo

### Phase 3 (Production)

- 적응형 스로틀링 완성
- 이진 청크 전송 안정화
- 감사 대시보드
- LuckPerms 권한 어댑터 통합

## 13) AI 에이전트 구현 지침 (최종)

### 13.1 아키텍처

- 반드시 의존성 주입(Dependency Injection) 구현
- 다음을 분리
  - BridgeCore
  - LoaderAdapter (Fabric/Forge/NeoForge)
  - PermissionAdapter
  - RegistryAdapter
  - WorldAccessAdapter
- 로더 간 중복 로직 금지 (필요한 경우만 예외)

### 13.2 성능

- 청크/대형 페이로드는 이진 직렬화 선호
- 팔레트 + RLE + VarInt + 압축 사용
- 프런트엔드 고려 사항
  - Web Worker 디코드
  - 메인 스레드는 렌더링만

### 13.3 안전

- 모든 월드 편집은 작업 큐를 통해서만 수행
- 적응형 스로틀링 구현 필수
- TPS < 15 시 자동 일시정지
- 취소/재개 제어 제공

### 13.4 일관성

- Undo/Redo는 커맨드 패턴 사용
- 커맨드는 apply()/revert() 지원
- 모든 작업은 감사 로그 기록

### 13.5 확장성

- 모드 블록 하드코딩 금지
- UI 팔레트는 런타임 레지스트리 덤프 기반
- 렌더 힌트는 placeholder 허용 (편집 기능 차단 금지)

## 부록 A) 용어집

- Registry: 서버 측 블록/아이템 레지스트리 매핑
- BlockState: 블록 속성 상태 (axis, facing 등)
- NBT: Named Binary Tag (BlockEntity 데이터)
- SNBT: Stringified NBT
- MSPT: 밀리초/틱
- RLE: 런 렝스 인코딩
- VarInt: 가변 길이 정수 인코딩
- 블루프린트/스키매틱: 붙여넣기/복사용 빌딩 데이터
