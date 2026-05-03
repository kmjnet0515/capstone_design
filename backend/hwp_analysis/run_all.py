#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
단일 진입점: backend 폴더 밖에서 실행할 때도 동작하도록 path 보정.

  cd capstone-project/backend
  ./venv/bin/python hwp_analysis/run_all.py
  ./venv/bin/python hwp_analysis/run_all.py /path/to/file.hwp --json

  # 여러 HWP 일괄 검증 (코퍼스)
  ./venv/bin/python hwp_analysis/run_all.py --corpus /path/to/hwp_folder --corpus-recursive --corpus-json-out report.json
"""

from __future__ import annotations

import sys
from pathlib import Path

# 프로젝트 backend 를 import 경로에 추가
_BACKEND = Path(__file__).resolve().parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from hwp_analysis.main import main  # noqa: E402

if __name__ == "__main__":
    main()
