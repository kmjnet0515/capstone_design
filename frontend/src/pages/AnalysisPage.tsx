import { useEffect, useRef, useState } from 'react';
import { ChevronRight, Loader2 } from 'lucide-react';

// --- 카카오 맵 타입 정의 확장 ---
interface LatLng {
  getLat(): number;
  getLng(): number;
}

interface MapOptions {
  center: LatLng;
  level: number;
}

interface KakaoMapInstance {
  setCenter(latlng: LatLng): void;
  panTo(latlng: LatLng): void;
  relayout(): void;
}

interface KakaoMaps {
  LatLng: new (lat: number, lng: number) => LatLng;
  Map: new (container: HTMLElement, options: MapOptions) => KakaoMapInstance;
  Marker: new (options: any) => { setMap(map: KakaoMapInstance | null): void };
  load: (callback: () => void) => void;
  services: {
    Geocoder: new () => {
      coord2Address(lng: number, lat: number, callback: (result: any, status: any) => void): void;
    };
    Status: { OK: string };
  };
}

declare global {
  interface Window {
    kakao: {
      maps: KakaoMaps;
    };
  }
}

const AnalysisPage = () => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<KakaoMapInstance | null>(null);
  
  // 상태 관리
  const [showPrompt, setShowPrompt] = useState(true); // 1. 위치 권한 확인 팝업
  const [isLoading, setIsLoading] = useState(false);  // 2. 로딩 표시
  const [address, setAddress] = useState("위치 확인 필요"); // 4. 주소 표시

  // 주소 변환 함수 (좌표 -> 도로명주소)
  const updateAddress = (lat: number, lng: number) => {
    const { kakao } = window;
    const geocoder = new kakao.maps.services.Geocoder();
    geocoder.coord2Address(lng, lat, (result, status) => {
      if (status === kakao.maps.services.Status.OK) {
        const addr = result[0].road_address?.address_name || result[0].address.address_name;
        setAddress(addr);
      }
    });
  };

  const initMap = (lat: number, lng: number, isDefault = false) => {
    const { kakao } = window;
    if (!mapContainer.current) return;

    const pos = new kakao.maps.LatLng(lat, lng);
    
    // 지도가 없을 때만 생성, 있으면 위치만 이동
    if (!mapInstance.current) {
      const map = new kakao.maps.Map(mapContainer.current, { center: pos, level: 3 });
      mapInstance.current = map;
      new kakao.maps.Marker({ position: pos, map: map });
    } else {
      mapInstance.current.setCenter(pos);
      new kakao.maps.Marker({ position: pos, map: mapInstance.current });
    }

    if (!isDefault) updateAddress(lat, lng);
    else setAddress("서울특별시 강남구 역삼동 (기본)");
    
    setIsLoading(false);
    setTimeout(() => mapInstance.current?.relayout(), 100);
  };

  // 사용자가 "내 위치 사용"을 눌렀을 때
  const handleAllowLocation = () => {
    setShowPrompt(false);
    setIsLoading(true);

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          initMap(position.coords.latitude, position.coords.longitude);
        },
        (error) => {
          console.warn("위치 거부됨:", error);
          handleDenyLocation(); // 거부 시 강남역으로
        },
        { timeout: 5000 }
      );
    } else {
      handleDenyLocation();
    }
  };

  // 사용자가 "거절"하거나 위치 정보를 가져올 수 없을 때
  const handleDenyLocation = () => {
    setShowPrompt(false);
    setIsLoading(true);
    // 3. 즉시 강남역 보여주기
    setTimeout(() => initMap(37.498095, 127.027610, true), 500);
  };

  useEffect(() => {
    const { kakao } = window;
    if (kakao) kakao.maps.load(() => {});
  }, []);

  return (
    <div className="relative flex h-screen w-full overflow-hidden bg-white">
      
      {/* 1. 위치 권한 요청 팝업 */}
      {showPrompt && (
        <div className="absolute inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white p-8 rounded-2xl shadow-2xl max-w-sm w-full text-center">
            <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" className="w-8 h-8"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            </div>
            <h2 className="text-xl font-bold mb-2">위치 정보 이용</h2>
            <p className="text-gray-500 mb-6 text-sm">정확한 상권 분석을 위해 현재 위치 정보를 사용하시겠습니까?</p>
            <div className="flex gap-3">
              <button onClick={handleDenyLocation} className="flex-1 py-3 bg-gray-100 text-gray-600 rounded-xl font-semibold hover:bg-gray-200 transition-all">거절</button>
              <button onClick={handleAllowLocation} className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-all">허용</button>
            </div>
          </div>
        </div>
      )}

      {/* 2. 로딩 오버레이 */}
      {isLoading && (
        <div className="absolute inset-0 z-[90] flex flex-col items-center justify-center bg-white/80">
          <Loader2 className="w-10 h-10 text-blue-600 animate-spin mb-4" />
          <p className="text-blue-900 font-bold tracking-tight">현재 위치를 분석 중입니다...</p>
        </div>
      )}

      {/* 좌측 사이드바 */}
      <aside className="w-[360px] bg-white border-r border-gray-200 p-6 flex flex-col shadow-sm z-10">
        <div className="mb-8">
          <h1 className="text-2xl font-black text-blue-900 tracking-tight">SBC 365</h1>
          <p className="text-xs text-gray-500 font-medium">Small Business Consulting 365</p>
        </div>

        <h3 className="text-lg font-bold mb-6 text-gray-800 border-b pb-2 text-[15px]">분석 설정</h3>
        
        <div className="space-y-6">
          <section>
            <label className="text-[11px] font-black text-gray-400 mb-2 block uppercase tracking-wider">지역 선택</label>
            <div className="p-3 border border-gray-200 rounded-xl bg-gray-50 text-sm font-semibold hover:border-blue-500 cursor-pointer flex justify-between items-center transition-all group">
              {/* 4. 도로명 주소 실시간 반영 */}
              <span className="truncate mr-2">{address}</span>
              <ChevronRight size={16} className="text-gray-400 group-hover:text-blue-500 flex-shrink-0" />
            </div>
          </section>

          <section>
            <label className="text-[11px] font-black text-gray-400 mb-2 block uppercase tracking-wider">업종 대분류</label>
            <div className="grid grid-cols-3 gap-2">
              <button className="py-2.5 bg-[#002c5f] text-white rounded-lg text-xs font-bold shadow-md transform active:scale-95 transition-all">음식</button>
              <button className="py-2.5 border border-gray-200 rounded-lg text-xs font-bold text-gray-500 hover:bg-gray-50">소매</button>
              <button className="py-2.5 border border-gray-200 rounded-lg text-xs font-bold text-gray-500 hover:bg-gray-50">서비스</button>
            </div>
          </section>

          <section>
            <label className="text-[11px] font-black text-gray-400 mb-2 block uppercase tracking-wider">상세 업종 선택</label>
            <select className="w-full p-3 border border-gray-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500 outline-none bg-white">
              <option>한식 음식점</option>
              <option>커피전문점 / 카페</option>
              <option>치킨 전문점</option>
              <option>일식 전문점</option>
            </select>
          </section>
        </div>

        <button 
          className="mt-auto py-4 bg-red-500 text-white text-base font-black rounded-2xl hover:bg-red-600 transition-all shadow-xl active:scale-95 hover:shadow-red-200"
          onClick={() => alert('AWS RDS 데이터를 조회합니다.')}
        >
          데이터 분석 시작
        </button>
      </aside>

      {/* 우측 지도 영역 */}
      <section className="flex-1 relative overflow-hidden">
        <div ref={mapContainer} className="absolute inset-0 w-full h-full" />
      </section>
    </div>
  );
};

export default AnalysisPage;