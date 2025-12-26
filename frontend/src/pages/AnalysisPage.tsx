import { useEffect, useRef } from 'react';
import { Map as MapIcon, ChevronRight } from 'lucide-react';

// TypeScript에서 window 객체에 kakao가 있음을 알리기 위한 선언
declare global {
  interface Window {
    kakao: any;
  }
}

const AnalysisPage = () => {
  // 지도를 담을 DOM 요소에 접근하기 위한 ref
  const mapContainer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const { kakao } = window;
    if (!kakao) return;

    // v3 스크립트를 수동으로 초기화
    kakao.maps.load(() => {
        if (!mapContainer.current) return;

        const options = {
        center: new kakao.maps.LatLng(37.498095, 127.027610),
        level: 3
        };

        const map = new kakao.maps.Map(mapContainer.current, options);
    });
    }, []);

  return (
    <div className="flex h-full w-full">
      {/* 좌측 필터 사이드바 (기존과 동일) */}
      <aside className="w-[360px] bg-white border-r border-gray-200 p-6 flex flex-col shadow-sm z-10">
        <h3 className="text-lg font-bold mb-6 text-gray-800 border-b pb-2">분석 설정</h3>
        
        <div className="space-y-6">
          <section>
            <label className="text-xs font-bold text-gray-400 mb-2 block uppercase">지역 선택</label>
            <div className="p-3 border rounded-lg bg-gray-50 text-sm font-medium hover:border-blue-500 cursor-pointer flex justify-between items-center transition-all">
              서울특별시 강남구 역삼동
              <ChevronRight size={16} className="text-gray-400" />
            </div>
          </section>

          <section>
            <label className="text-xs font-bold text-gray-400 mb-2 block uppercase">업종 대분류</label>
            <div className="grid grid-cols-3 gap-2">
              <button className="py-2 bg-[#002c5f] text-white rounded-md text-sm font-bold shadow-sm">음식</button>
              <button className="py-2 border border-gray-200 rounded-md text-sm text-gray-500 hover:bg-gray-50 transition-colors">소매</button>
              <button className="py-2 border border-gray-200 rounded-md text-sm text-gray-500 hover:bg-gray-50 transition-colors">서비스</button>
            </div>
          </section>

          <section>
            <label className="text-xs font-bold text-gray-400 mb-2 block uppercase">상세 업종</label>
            <select className="w-full p-3 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
              <option>한식 음식점</option>
              <option>커피전문점 / 카페</option>
              <option>치킨 전문점</option>
            </select>
          </section>
        </div>

        <button 
          className="mt-auto py-4 bg-red-500 text-white font-black rounded-xl hover:bg-red-600 transition-all shadow-lg active:scale-95"
          onClick={() => alert('AWS RDS 데이터를 조회합니다.')}
        >
          데이터 분석 시작
        </button>
      </aside>

      {/* 우측 실제 지도 영역 */}
      <section 
        ref={mapContainer} 
        className="flex-1 relative" 
        style={{ width: '100%', height: '100%', minHeight: '500px', backgroundColor: '#eee' }} // 배경색을 눈에 띄게 변경
        >
        {/* 지도가 뜨는지 확인하기 위해 안내 문구를 잠시 주석 처리하거나 제거해 보세요 */}
      </section>
    </div>
  );
};

export default AnalysisPage;