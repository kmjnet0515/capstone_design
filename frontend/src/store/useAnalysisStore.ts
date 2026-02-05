import { create } from 'zustand';

interface AnalysisData {
  coords: { lat: number; lng: number };
  radius: number;
  address: string;
  selectedCategory: { large: string; mid: string; small: string };

  // 데이터 섹션
  shops: any[];
  closedShops: any[];
  landPrices: any[];
  majorDistricts: any[];
  
  // ★ 추가된 부분: 가공된 블록 데이터 (geometry, properties 포함)
  blocks: any[]; 

  setAnalysisResult: (data: Partial<AnalysisData>) => void;
  resetAnalysis: () => void;
}

export const useAnalysisStore = create<AnalysisData>((set) => ({
  coords: { lat: 37.498095, lng: 127.027610 },
  radius: 0,
  address: '',
  selectedCategory: { large: '', mid: '', small: '' },
  
  shops: [],
  closedShops: [],
  landPrices: [],
  majorDistricts: [],
  blocks: [], // 초기화

  setAnalysisResult: (data) => set((state) => ({ ...state, ...data })),
  resetAnalysis: () => set({
    radius: 0, shops: [], closedShops: [], landPrices: [], majorDistricts: [], blocks: []
  }),
}));