# 배포 가이드

## 한 줄 요약

| 하고 싶은 것 | 명령 |
|--------------|------|
| 로컬에서 이미지 빌드 + Docker Hub 푸시 | `docker login` 후 저장소 루트에서 **`npm run deploy:dockerhub`** |
| EC2에서만 재시작 (이미 푸시됨) | 서버에서 **`bash scripts/ec2-dockerhub-restart.sh`** |
| 로컬에서 SSH로 EC2 재시작까지 | `EC2_HOST` `EC2_KEY` 설정 후 **`npm run deploy:ec2`** |
| CI에서 자동 푸시 | GitHub Secrets에 `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN` 추가 후 `main` 푸시 또는 Actions 수동 실행 (`.github/workflows/docker-hub-push.yml`) |

Docker Hub·EC2 계정은 제가 대신 쓸 수 없으므로, 위 명령은 **본인 PC 또는 GitHub**에서 실행해야 합니다.

---

## 운영 방식 요약 (Docker Hub + EC2 단일 서버)

많은 경우 아래 흐름으로 배포합니다.

1. **개발 머신(Mac 등)** 에서 `linux/amd64` 이미지를 빌드해 **Docker Hub**에 푸시  
2. **EC2** 에서 `docker pull` → 기존 컨테이너 종료/삭제 → `docker run` 으로 재기동  
3. 백엔드: `-p 3000:3000` + `--env-file .../backend.env`  
4. 프론트: `-p 8080:80` (nginx 정적 파일)

저장소에 동일 패턴을 스크립트로 넣어 두었습니다.

| 파일 | 용도 |
|------|------|
| [`scripts/dockerhub-build-push.sh`](../scripts/dockerhub-build-push.sh) | 로컬에서 buildx 빌드·푸시 |
| [`scripts/ec2-dockerhub-restart.sh`](../scripts/ec2-dockerhub-restart.sh) | 서버에서 pull 후 컨테이너 교체 |

스크립트 실행 전 `chmod +x scripts/*.sh`.

### 한 줄에 가까운 명령 (기존에 쓰던 형태)

저장소 루트(`capstone-project`)에서:

```bash
# Docker Hub 로그인 후
export DOCKER_USER=kimminjae0515
export VITE_API_BASE_URL='https://sbc365.co.kr/api'   # 운영 API (도메인 변경 시 수정 후 프론트 재빌드)

docker buildx build --platform linux/amd64 \
  -t ${DOCKER_USER}/backend-app:latest \
  -t ${DOCKER_USER}/backend-app:hard-attachment-mode-$(date +%Y%m%d)-amd64 \
  -f backend/Dockerfile --push backend

docker buildx build --platform linux/amd64 \
  --build-arg VITE_API_BASE_URL="$VITE_API_BASE_URL" \
  -t ${DOCKER_USER}/frontend-app:latest \
  -t ${DOCKER_USER}/frontend-app:hard-attachment-mode-$(date +%Y%m%d) \
  -f frontend/Dockerfile --push frontend
```

**중요:** 프론트 이미지는 빌드 시점에 `VITE_API_BASE_URL`이 박힙니다. API 도메인을 바꾼 뒤에는 **프론트 이미지를 다시 빌드·푸시**해야 브라우저 요청 주소가 바뀝니다.

### EC2에서 실행 (예시)

```bash
docker pull kimminjae0515/backend-app:latest
docker pull kimminjae0515/frontend-app:latest

docker stop capstone-backend capstone-frontend 2>/dev/null || true
docker rm capstone-backend capstone-frontend 2>/dev/null || true

docker run -d --name capstone-backend --restart unless-stopped -p 3000:3000 \
  --env-file /home/ubuntu/backend.env \
  kimminjae0515/backend-app:latest

docker run -d --name capstone-frontend --restart unless-stopped -p 8080:80 \
  kimminjae0515/frontend-app:latest
```

`backend.env`에는 `DB_*`, `OPENAI_API_KEY`, `AWS_*`, `S3_*`, 선택적으로 `USE_BLOCK_PIPELINE=1` 등을 넣습니다.

---

## 대안: docker-compose (동일 서버에서 한 번에)

루트의 [`docker-compose.prod.yml`](../docker-compose.prod.yml) 과 [`.env.production.example`](../.env.production.example) 참고.

---

## 대안: GitHub Actions → Amazon ECR

`.github/workflows/docker-ecr-push.yml` — AWS ECR 사용 시.

---

## 블록 파이프라인(HWPX)

백엔드 환경변수 `USE_BLOCK_PIPELINE=1` 시 토폴로지 기반 분류 (`backend.env`에 추가).
