# bridge-paper 패키지

실제 Paper(Bukkit) 마인크래프트 서버에서 실행되는 WebCraftOps Bridge 플러그인입니다.
`bridge-core`(Fabric 설계)와 달리 이 패키지는 JVM에서 직접 로드되는 Paper 플러그인 jar로
빌드해야 합니다. Node.js/TypeScript가 아닌 Java + Gradle 프로젝트입니다.

## 포함 기능 (초기)

- `GET /bridge/info`
- `GET /bridge/registry/blocks` (Material 기반 best-effort — Fabric 스타일 상태 프로퍼티
  추출은 하지 않음)
- `GET /bridge/world/{worldId}/chunks?cx=&cz=` (varint + RLE, `bridge-core/fabric-bridge.ts`
  및 `frontend/chunk-worker.js`와 동일한 유선 포맷)
- `POST /bridge/command` — `setBlock`/`fill`만 구현. `replace`/`pasteBlueprint`/`clone`,
  `setBlock`의 `mode:"revert"`는 명시적으로 501을 반환합니다(조용한 가짜 성공 금지).
- `GET /bridge/console/stream` — SSE. `System.out`/`System.err`를 감싼 `TeeOutputStream`이
  한 줄씩 `ConsoleBroadcaster`로 넘기고, 그걸 구독자에게 그대로 push한다(Paper가 채팅도
  콘솔에 로깅하므로 별도 채팅 리스너 없이 같이 나온다). 최근 500줄은 백로그로 남겨뒀다가
  새 구독자 연결 시 재생한다.
- `POST /bridge/console/command` — `Bukkit.dispatchCommand(Bukkit.getConsoleSender(), ...)`로
  콘솔 권한 명령어 실행. 결과는 별도 응답 페이로드가 아니라 콘솔 로그(=SSE 스트림)로 나온다.

Edit Job의 생성/큐잉/스로틀링/취소는 백엔드(`packages/backend/src/edit-jobs.ts`)가
전담합니다 — 이 플러그인은 `/bridge/command`로 들어오는 커맨드 하나를 동기 실행하고
정확한 성공/실패만 돌려주면 됩니다.

> `console/stream`·`console/command`는 코드만 작성된 상태로, 아직 Gradle 빌드·실서버
> 배포로 검증하지 않았습니다(재빌드/재배포는 요청 시에만 진행). 배포 후에는 위
> "빌드 확인 완료" 항목들과 동일하게 실제 SSE 연결 + 명령어 실행을 검증해야 합니다.

## 인증

`X-Bridge-Token` 헤더로 보호됩니다. `BRIDGE_TOKEN` 환경변수(권장) 또는 `config.yml`의
`token` 값을 설정하세요. 둘 다 비어 있으면 기동 시 임의 토큰을 생성해 서버 로그에 한 번
경고로 출력합니다.

## 빌드 확인 완료 (실측)

`paper-api` 버전(`26.2.build.117-stable`)은 repo.papermc.io의 실제 메타데이터로 확인한 값이고,
실서버(192.168.0.126)를 read-only Server List Ping으로 직접 조회해 같은 `Paper 26.2`임을
확인했습니다. 이 저장소 안에서 실제로:

1. `gradle build`로 이 플러그인을 컴파일 (Gradle이 필요한 Java 25 툴체인을 `settings.gradle.kts`의
   foojay-resolver 플러그인으로 자동 다운로드 — JDK21만 있는 환경에서도 정상 동작 확인)
2. 공식 PaperMC에서 받은 실제 `paper-26.2-117.jar` 서버로 로컬에 격리된 테스트 서버를 띄워
   플러그인이 경고 없이 로드/활성화되는 것 확인
3. `/bridge/info`, `/bridge/registry/blocks`(1193개 블록), `/bridge/world/overworld/chunks`
   (프런트 `chunk-worker.js` 디코더로 실제 월드 데이터 왕복 검증), `POST /bridge/command`의
   `setBlock`/`fill`이 실제로 블록을 바꾸는 것, 미구현 커맨드가 501을 반환하는 것,
   백엔드(`packages/backend`)를 통한 Edit Job → 이 플러그인 → 실제 월드 쓰기 전체 경로까지 확인

즉 코드 자체는 검증된 상태입니다. 다만 이건 **당신의 실제 컨테이너가 아니라, 같은 버전 문자열의
공식 배포 jar로 만든 격리된 테스트 서버**에서 확인한 것이므로, 실제 배포 전 아래만 한 번 더
확인하시면 됩니다 (거의 확실히 동일하지만):

```bash
docker exec minecraft_server java -version   # 25 이상인지 확인 (아니면 build.gradle.kts의 toolchain 값 조정 필요)
```

## 빌드 (로컬 JDK 불필요)

```bash
docker run --rm \
  -v "$(pwd)/packages/bridge-paper:/home/gradle/project" \
  -w /home/gradle/project \
  gradle:8-jdk21 \
  gradle build --no-daemon
```
(Gradle이 컴파일에 필요한 JDK 25는 자동으로 내려받습니다 — 컨테이너에 미리 있을 필요 없음. 단,
컨테이너가 인터넷에 접근 가능해야 합니다.)

결과물: `build/libs/bridge-paper.jar`

## 배포

1. jar를 서버의 `plugins/` 폴더에 복사 (itzg/minecraft-server 기준 호스트 경로 예:
   `/data/minecraft/data/plugins/`, 또는 `docker cp bridge-paper.jar minecraft_server:/data/plugins/`)
2. `mc-server` 서비스(새 서비스 아님, 같은 컨테이너)의 docker-compose에 플러그인 HTTP
   포트를 게시하고 `BRIDGE_TOKEN`을 설정:
   ```yaml
   ports:
     - "8123:8123"
   environment:
     BRIDGE_TOKEN: "<임의의 강력한 값>"
   ```
3. `docker compose up -d --force-recreate mc-server`

## 로컬 실행 예시 (스모크 테스트)

```bash
curl -H "X-Bridge-Token: $TOKEN" http://<host>:8123/bridge/info
curl -H "X-Bridge-Token: $TOKEN" http://<host>:8123/bridge/registry/blocks | head -c 500
curl -H "X-Bridge-Token: $TOKEN" http://<host>:8123/bridge/world/overworld/chunks -o /tmp/chunk.bin
curl -X POST -H "X-Bridge-Token: $TOKEN" -H "Content-Type: application/json" \
  -d '{"type":"setBlock","params":{"block":"minecraft:gold_block","pos":[0,64,0]},"mode":"apply"}' \
  http://<host>:8123/bridge/command
```
