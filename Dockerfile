# WebCraftOps 백엔드(+프런트 정적 서빙) 이미지.
# bridge-paper(Java/Paper 플러그인)는 별도 배포물이라 여기 포함하지 않는다.
FROM node:22-alpine

WORKDIR /app/backend

COPY packages/backend/package.json ./
RUN npm install --omit=dev

COPY packages/backend/src ./src
# server.ts가 import.meta.url 기준 ../../frontend/src로 정적 파일을 찾는다 — 이 상대 경로를
# 컨테이너 안에서도 그대로 유지해야 한다(WORKDIR가 /app/backend이므로 /app/frontend/src).
COPY packages/frontend/src ../frontend/src

ENV WEBCRAFTOPS_BACKEND_AUTO_START=true
# 기본 SQLite 감사 로그 경로(data/webcraftops.sqlite)는 WORKDIR 기준 상대경로 — 컨테이너
# 재생성 시에도 남기려면 /app/backend/data를 볼륨으로 마운트할 것.
VOLUME ["/app/backend/data"]

EXPOSE 4000

CMD ["npx", "tsx", "src/index.ts"]
