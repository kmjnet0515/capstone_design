#!/usr/bin/env bash
# EC2(ubuntu) 등에서 실행: 최신 이미지 pull 후 컨테이너 교체
#
# 사전 준비:
#   /home/ubuntu/backend.env  — DB, OPENAI_API_KEY, AWS 키, S3 등 (backend 컨테이너용)
#   docker login (Docker Hub, 해당 계정)
#
# 포트: 백엔드 3000, 프론트 8080→nginx 80

set -euo pipefail

DOCKER_USER="${DOCKER_USER:-kimminjae0515}"

docker pull "${DOCKER_USER}/backend-app:latest"
docker pull "${DOCKER_USER}/frontend-app:latest"

docker stop capstone-backend capstone-frontend 2>/dev/null || true
docker rm capstone-backend capstone-frontend 2>/dev/null || true

docker run -d --name capstone-backend --restart unless-stopped -p 3000:3000 \
  --env-file /home/ubuntu/backend.env \
  "${DOCKER_USER}/backend-app:latest"

docker run -d --name capstone-frontend --restart unless-stopped -p 8080:80 \
  "${DOCKER_USER}/frontend-app:latest"

echo "OK: backend :3000, frontend :8080"
