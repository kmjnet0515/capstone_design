# 1단계: 빌드
FROM node:18-alpine AS build

WORKDIR /app
COPY package*.json ./
RUN npm install

COPY . .

# 프로덕션 API 베이스 (운영: https://sbc365.co.kr/api) — 미설정 시 apiBase.ts와 동일 폴백
ARG VITE_API_BASE_URL=
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

RUN npm run build

# 2단계: nginx 로 정적 서빙
FROM nginx:alpine

# Vite: dist / CRA: build 로 폴더명 맞춰서 변경
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]