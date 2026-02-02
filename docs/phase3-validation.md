# Phase 3 통합 검증 시나리오

Phase 3 전환을 위한 **백엔드 · 브릿지 · 프런트 통합 검증**과 **성능/부하 점검 항목**을 정리합니다.

> 본 시나리오는 개발 환경에서 수동/자동으로 수행할 수 있도록 단계화되어 있습니다.

---

## 1) 사전 준비

- 백엔드 서버 실행 (포트 4000 기준)
- 브릿지 모의 서버 실행 (필요 시)
- 프런트엔드 정적 페이지 제공

```
WEBCRAFTOPS_BACKEND_AUTO_START=true node ./packages/backend/src/index.ts
```

> TypeScript 실행 환경이 없으면 `tsx` 또는 빌드 단계가 필요합니다.

---

## 2) 통합 검증 시나리오

### 2.1 Edit Job 생성 → 실행 → 감사 로그 기록 확인

1. Edit Job 생성 (setBlock 예시)
```
curl -X POST http://localhost:4000/bridge/world/overworld/edit/jobs \
  -H "Content-Type: application/json" \
  -d '{ "createdBy": "tester", "commands": [{"type":"setBlock","params":{"block":"minecraft:stone"}}] }'
```

2. 작업 상태 확인
```
curl http://localhost:4000/bridge/edit/jobs
```

3. 감사 로그 조회
```
curl "http://localhost:4000/audit?userId=tester&limit=20"
```

**기대 결과**
- 작업이 생성/완료 상태로 업데이트됨
- 감사 로그에 `setBlock` 기록이 존재함

---

### 2.2 적응형 스로틀링 메트릭 입력

1. 메트릭 수동 입력 (TPS 낮게)
```
curl -X POST http://localhost:4000/bridge/edit/jobs/{jobId}/metrics \
  -H "Content-Type: application/json" \
  -d '{ "mspt": 60, "tps": 14 }'
```

2. 작업 상태 확인 (일시정지 여부)
```
curl http://localhost:4000/bridge/edit/jobs/{jobId}
```

3. 메트릭 회복 입력 (자동 재개)
```
curl -X POST http://localhost:4000/bridge/edit/jobs/{jobId}/metrics \
  -H "Content-Type: application/json" \
  -d '{ "mspt": 30, "tps": 19 }'
```

**기대 결과**
- TPS < 15 시 작업이 `paused`
- TPS 회복 시 `running`으로 전환
- MSPT에 따라 batchSize / delayMs가 조정됨

---

### 2.3 감사 로그 시간 범위 필터 검증

```
curl "http://localhost:4000/audit?since=2026-02-02T00:00:00Z&until=2026-02-03T00:00:00Z&limit=50"
```

**기대 결과**
- 시간 범위 내의 로그만 반환
- 잘못된 시간 형식일 경우 400 에러

---

## 3) 성능/부하 점검 항목

### 3.1 백엔드
- 감사 로그 조회 응답 시간 (limit 100/500 기준)
- audit 인덱스 적용 여부 확인
- TPS/MSTP 메트릭 업데이트 호출 빈도 테스트 (1s/500ms)

### 3.2 프런트엔드
- 감사 로그 대량 표시 시 렌더링 지연 여부
- 필터 변경 시 API 호출 정상 여부

### 3.3 브릿지 (추후 실제 연동 시)
- Job 실행 중 TPS 하락 시 자동 일시정지 동작 확인
- LuckPerms 연동 실패 시 OP/ACL 폴백 동작 확인

---

## 4) 결과 기록 템플릿

```
- 날짜:
- 테스트 환경:
- 수행 항목:
  - [ ] Edit Job 생성 → 감사 로그 확인
  - [ ] TPS 하드 스톱/재개 확인
  - [ ] 시간 범위 필터 확인
- 이슈:
- 비고:
```
