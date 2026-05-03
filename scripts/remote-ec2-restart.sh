#!/usr/bin/env bash
# 로컬에서 EC2로 SSH 접속해 pull + 컨테이너 재시작 (키 페어 필요)
#
# 사용 예:
#   export EC2_HOST=ubuntu@13.xxx.xxx.xxx
#   export EC2_KEY="$HOME/.ssh/my-key.pem"
#   npm run deploy:ec2
#
# 원격 서버에 Docker 설치·Docker Hub 로그인(docker pull 허용)이 되어 있어야 합니다.

set -euo pipefail

: "${EC2_HOST:?EC2_HOST 를 설정하세요 (예: ubuntu@1.2.3.4)}"
: "${EC2_KEY:?EC2_KEY 에 .pem 경로를 설정하세요}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export DOCKER_USER="${DOCKER_USER:-kimminjae0515}"

echo "→ SSH $EC2_HOST 로 ec2-dockerhub-restart.sh 실행"
ssh -i "$EC2_KEY" -o StrictHostKeyChecking=accept-new "$EC2_HOST" \
  "DOCKER_USER=$DOCKER_USER bash -s" < "$ROOT/scripts/ec2-dockerhub-restart.sh"

echo "OK."
