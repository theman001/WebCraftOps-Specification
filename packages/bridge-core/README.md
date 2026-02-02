# bridge-core 패키지

Minecraft Bridge의 공통 코어 로직과 어댑터 인터페이스를 정의합니다. 로더별 구현(Fabric/Forge/NeoForge)은 이 인터페이스를 구현해야 합니다.

## 목표

- 로더별 중복 로직 최소화
- 권한/레지스트리/월드 접근 추상화
- 명령 패턴 기반 작업 큐 연동
- LuckPerms 권한 어댑터 확장 지원
- LuckPerms 기본 구현 예시 및 권한 서비스 제공
- LuckPerms HTTP 어댑터 제공 (API 연동용)
