# 1단계: 빌드
FROM node:18-alpine AS build

WORKDIR /app
COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build      # Vite면 dist, CRA면 build 폴더가 생성됨

# 2단계: nginx 로 정적 서빙
FROM nginx:alpine

# Vite: dist / CRA: build 로 폴더명 맞춰서 변경
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]