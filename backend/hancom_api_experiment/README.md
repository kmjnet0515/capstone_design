# Hancom DocsConverter API 실험

## 준비된 파일
- `testhwp.hwp` (원본 복사본)
- `test_hancom_converter_api.js` (API 호출 테스트 스크립트)

## 실행
```bash
node "./hancom_api_experiment/test_hancom_converter_api.js"
```

## 환경변수 (선택)
- `HANCOM_BASE_URL` (기본: `http://127.0.0.1:8101`)
- `HANCOM_MODULE` (기본: `hwp2pdf`)
- `HANCOM_SHOW_TYPE` (기본: `json`)
- `HANCOM_FUNCTION` (기본: 빈 문자열)
- `HANCOM_TIMEOUT_MS` (기본: `15000`)

예시:
```bash
HANCOM_BASE_URL=http://<docsconverter-host>:8101 \
HANCOM_MODULE=hwp2pdf \
node "./hancom_api_experiment/test_hancom_converter_api.js"
```
