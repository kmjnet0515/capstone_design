#!/usr/bin/env bash
#
# EC2(Ubuntu/Amazon Linux 2023) 배포 직후 한 번만 실행.
# 신청서 작성 에이전트의 Python 분석 모듈에 필요한 venv + 의존성 구성.
#
# 사용:
#   cd /path/to/capstone-project/backend
#   bash scripts/setup_python_env.sh
#
# 옵션 환경변수:
#   PYTHON_BIN   기본: python3 — 사용할 Python 인터프리터 절대경로
#   VENV_DIR     기본: ./venv

set -euo pipefail

PYTHON_BIN="${PYTHON_BIN:-python3}"
VENV_DIR="${VENV_DIR:-./venv}"

cd "$(dirname "$0")/.."   # backend 디렉터리

echo "[setup_python_env] Python 인터프리터: $PYTHON_BIN"
"$PYTHON_BIN" --version

# OS 패키지 (lxml/cryptography 빌드용) 설치 시도 (sudo 권한 있을 때만)
if command -v apt-get >/dev/null 2>&1; then
    echo "[setup_python_env] apt 빌드 의존성 설치 시도 (sudo)"
    sudo apt-get update -y || true
    sudo apt-get install -y --no-install-recommends \
        build-essential libxml2-dev libxslt1-dev \
        libffi-dev libssl-dev python3-dev || true
elif command -v dnf >/dev/null 2>&1; then
    echo "[setup_python_env] dnf 빌드 의존성 설치 시도 (sudo)"
    sudo dnf install -y \
        gcc gcc-c++ libxml2-devel libxslt-devel \
        libffi-devel openssl-devel python3-devel || true
fi

# 1) venv 생성
if [ ! -d "$VENV_DIR" ]; then
    echo "[setup_python_env] venv 생성: $VENV_DIR"
    "$PYTHON_BIN" -m venv "$VENV_DIR"
fi

# 2) pip 업그레이드 + 의존성 설치
"$VENV_DIR/bin/pip" install -U pip wheel
"$VENV_DIR/bin/pip" install -r requirements.txt

# 3) 동작 확인
echo "[setup_python_env] hwp_analysis import 테스트…"
"$VENV_DIR/bin/python" - <<'PY'
import sys
print('Python:', sys.version)
import hwp5; print('hwp5 OK')
import olefile; print('olefile OK')
import lxml.etree; print('lxml OK')
PY

echo
echo "✅ Python 환경 구성 완료"
echo "   PYTHON_PATH 환경변수를 다음 값으로 설정하면 Node 가 자동 사용:"
echo "     export PYTHON_PATH=$(pwd)/$VENV_DIR/bin/python"
