#!/usr/bin/env bash
# Docker Hub에 linux/amd64 이미지 빌드·푸시 (로컬/Mac에서 실행 후 EC2에서 pull)
#
# 사용 전:
#   docker login   (Docker Hub)
#
# 환경변수로 태그·저장소 이름 조정 가능:
#   DOCKER_USER=kimminjae0515
#   TAG_SUFFIX=hard-attachment-mode-20260430
#   VITE_API_BASE_URL=https://sbc365.co.kr/api   # 프론트가 호출할 공개 API 베이스 (반드시 빌드 시 주입)

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DOCKER_USER="${DOCKER_USER:-kimminjae0515}"
TAG_SUFFIX="${TAG_SUFFIX:-hard-attachment-mode-$(date +%Y%m%d)-amd64}"
VITE_API_BASE_URL="${VITE_API_BASE_URL:-https://sbc365.co.kr/api}"

echo "=== Backend → ${DOCKER_USER}/backend-app ==="
docker buildx build --platform linux/amd64 \
  -t "${DOCKER_USER}/backend-app:latest" \
  -t "${DOCKER_USER}/backend-app:${TAG_SUFFIX}" \
  -f backend/Dockerfile --push backend

echo "=== Frontend → ${DOCKER_USER}/frontend-app (VITE_API_BASE_URL=${VITE_API_BASE_URL}) ==="
docker buildx build --platform linux/amd64 \
  --build-arg "VITE_API_BASE_URL=${VITE_API_BASE_URL}" \
  -t "${DOCKER_USER}/frontend-app:latest" \
  -t "${DOCKER_USER}/frontend-app:${TAG_SUFFIX}" \
  -f frontend/Dockerfile --push frontend

echo "OK. EC2에서 pull 후 아래 scripts/ec2-dockerhub-restart.sh 참고."
