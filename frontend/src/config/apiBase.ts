/**
 * 프로덕션: Docker / CI 빌드 시 VITE_API_BASE_URL 로 주입
 * 미설정 시 운영 API (로컬에서 스테이징 API를 쓰려면 .env.local 에 VITE_API_BASE_URL 지정)
 */
const raw = import.meta.env.VITE_API_BASE_URL as string | undefined;
export const API_BASE_URL = (raw && raw.trim()) || 'https://sbc365.co.kr/api';
