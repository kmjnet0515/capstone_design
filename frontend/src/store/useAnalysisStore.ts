import { create } from 'zustand';

interface AnalysisData {
  coords: { lat: number; lng: number };
  radius: number;
  address: string;
  selectedCategory: { large: string; mid: string; small: string };

  // 위치 정보 동의 상태
  // 'unknown' : 아직 묻지 않음 / 초기 진입
  // 'allowed' : 사용자 위치 사용 허용
  // 'denied'  : 사용자 위치 사용 거절
  locationConsent: 'allowed' | 'denied' | 'unknown';

  // 인구 통계 요약 (선택된 주소 기준)
  population: {
    averageAge: number | null;
    totalPopulation: number;
  } | null;

  // 데이터 섹션
  shops: any[];
  closedShops: any[];
  landPrices: any[];
  majorDistricts: any[];

   // AI 리포트 텍스트 (최근 분석 결과)
  aiReport: string;

  // 지원제도 리스트 (상세 리포트 패널)
  supportPrograms: any[];

  // 최근 실거래 요약 (리포트/그래프용)
  recentTrades: any[];
  
  // ★ 추가된 부분: 가공된 블록 데이터 (geometry, properties 포함)
  blocks: any[]; 

  setAnalysisResult: (data: Partial<AnalysisData>) => void;
  setLocationConsent: (status: 'allowed' | 'denied') => void;
  resetAnalysis: () => void;
}

export const useAnalysisStore = create<AnalysisData>((set) => ({
  coords: { lat: 37.498095, lng: 127.027610 },
  radius: 0,
  address: '',
  selectedCategory: { large: '', mid: '', small: '' },

  locationConsent: 'unknown',
  population: null,
  
  shops: [],
  closedShops: [],
  landPrices: [],
  majorDistricts: [],
  aiReport: '',
  supportPrograms: [],
  recentTrades: [],
  blocks: [], // 초기화

  setAnalysisResult: (data) => set((state) => ({ ...state, ...data })),

  setLocationConsent: (status) =>
    set((state) => ({
      ...state,
      locationConsent: status,
    })),

  resetAnalysis: () =>
    set((state) => ({
      ...state,
      radius: 0,
      shops: [],
      closedShops: [],
      landPrices: [],
      majorDistricts: [],
      blocks: [],
      population: null,
      aiReport: '',
      supportPrograms: [],
      recentTrades: [],
    })),
}));