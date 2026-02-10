import React, { useState } from 'react'; // useState 추가
import { MapPin, Search, Loader2, Navigation } from 'lucide-react'; // Navigation 아이콘 추가
interface AnalysisSidebarProps {
  address: string;
  radius: number;
  largeCategories: string[];
  midCategories: string[];
  smallCategories: string[];
  selectedLarge: string | "";
  selectedMid: string | "";
  selectedSmall: string | "";
  isLoading: boolean;
  onSelectLarge: (cat: string) => void;
  onSelectMid: (cat: string) => void;
  onSelectSmall: (cat: string) => void;
  onStartAnalysis: () => void;
  onAutoSelect: (hierarchy: { large: string; mid: string; small: string }) => void; // 자동 선택 함수 추가
  onLocationSelect: (lat: number, lng: number, address: string) => void; // 추가
}

const AnalysisSidebar: React.FC<AnalysisSidebarProps> = (p) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);

  // 주소 검색용 state
  const [locQuery, setLocQuery] = useState("");
  const [locResults, setLocResults] = useState<any[]>([]);
  const [isLocSearching, setIsLocSearching] = useState(false);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    try {
      const res = await fetch(`http://localhost:3000/api/categories/search?query=${encodeURIComponent(searchQuery)}`);
      const data = await res.json();
      
      if (data && data.hierarchy) {
        p.onAutoSelect(data.hierarchy); // 부모 컴포넌트로 데이터 전달
        setSearchQuery(""); // 검색창 초기화
      } else {
        alert("일치하는 업종을 찾을 수 없습니다.");
      }
    } catch (err) {
      console.error("검색 실패:", err);
    } finally {
      setIsSearching(false);
    }
  };
  
  const searchLocation = () => {
    if (!locQuery.trim()) return;
    const { kakao } = window;
    if (!kakao) return;

    setIsLocSearching(true);
    
    const geocoder = new kakao.maps.services.Geocoder();
    const ps = new kakao.maps.services.Places();

    // 1. 먼저 주소(행정구역) 검색을 시도합니다.
    geocoder.addressSearch(locQuery, (addrData: any, addrStatus: any) => {
      let results: any[] = [];

      // 주소 검색 결과가 있는 경우 (행정구역 우선)
      if (addrStatus === kakao.maps.services.Status.OK) {
        results = addrData.map((item: any) => ({
          display_name: item.address_name,
          category: item.address_type === 'REGION' ? '지역명' : '주소',
          y: item.y,
          x: item.x,
          address: item.address_name
        }));
      }

      // 2. 장소 검색으로 보완합니다. (주소 결과가 적을 때를 대비)
      ps.keywordSearch(locQuery, (placeData: any, placeStatus: any) => {
        if (placeStatus === kakao.maps.services.Status.OK) {
          const placeResults = placeData.map((item: any) => ({
            display_name: item.place_name,
            category: item.category_name.split(' > ').reverse()[0], // 마지막 카테고리 추출
            y: item.y,
            x: item.x,
            address: item.address_name
          }));
          
          // 주소 결과와 장소 결과를 합치되, 중복은 제거 (선택 사항)
          const combined = [...results, ...placeResults];
          setLocResults(combined.slice(0, 8)); // 상위 8개만 표시
        } else {
          setLocResults(results);
        }
        setIsLocSearching(false);
      });
    });
  };
  return (
  <aside className="w-95 bg-white border-r border-slate-100 p-8 flex flex-col shadow-xl z-10 overflow-y-auto shrink-0">
    <header className="mb-10"><h1 className="text-3xl font-black text-blue-950 italic">SBC 365</h1><p className="text-[11px] text-blue-600 font-bold uppercase mt-1.5">Market Analysis Tool</p></header>
    <section className="mb-10">
      <label className="text-[11px] font-black text-slate-400 mb-3 block uppercase tracking-widest">
        지점 위치 검색
      </label>
      <div className="relative mb-2">
        <input
          type="text"
          value={locQuery}
          onChange={(e) => setLocQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && searchLocation()}
          placeholder="예 : 부산광역시 강서구"
          className="w-full p-4 pr-12 border-2 placeholder:text-slate-300 border-slate-100 rounded-2xl text-sm font-bold focus:border-blue-600 outline-none transition-all"
        />
        <button onClick={searchLocation} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400">
          {isLocSearching ? <Loader2 className="animate-spin" size={20} /> : <Search size={20} />}
        </button>
      </div>

      {/* 검색 결과 리스트 */}
      {locResults.length > 0 && (
        <div className="mt-2 max-h-72 overflow-y-auto border-2 border-slate-100 rounded-2xl bg-white shadow-xl">
          {locResults.map((item, idx) => (
            <div 
              key={idx}
              onClick={() => {
                // 부모 컴포넌트(AnalysisPage)의 좌표 및 주소 업데이트 함수 호출
                p.onLocationSelect(parseFloat(item.y), parseFloat(item.x), item.address);
                setLocResults([]);
                setLocQuery(item.display_name);
              }}
              className="p-4 hover:bg-blue-50 cursor-pointer border-b border-slate-50 last:border-none group transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="text-[14px] font-bold text-slate-800 group-hover:text-blue-600">
                  {item.display_name}
                </span>
                <span className="text-[10px] px-2 py-0.5 bg-slate-100 text-slate-400 rounded-md font-bold">
                  {item.category}
                </span>
              </div>
              <div className="text-[11px] text-slate-400 mt-1 truncate">
                {item.address}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
    <section className="mb-10">
        <label className="text-[11px] font-black text-slate-400 mb-3 block uppercase tracking-widest">
          AI 업종 빠른 검색
        </label>
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="예: 커피, 삼겹살, 세탁소..."
            className="w-full p-4 pr-12 border-2 border-slate-100 rounded-2xl text-sm font-bold focus:border-blue-600 outline-none transition-all placeholder:text-slate-300"
          />
          <button 
            onClick={handleSearch}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-blue-600 transition-colors"
          >
            {isSearching ? <Loader2 className="animate-spin" size={20} /> : <Search size={20} />}
          </button>
        </div>
      </section>
    <div className="space-y-10 flex-1">
      <section>
        <label className="text-[11px] font-black text-slate-400 mb-3 block uppercase tracking-widest">Selected Location</label>
        <div className="p-5 border-2 border-blue-600 rounded-3xl bg-blue-50/30">
          <div className="flex items-start gap-3"><MapPin size={18} className="text-blue-600 mt-1" />
            <div><span className="text-sm font-black text-blue-950 block leading-snug mb-1">{p.address}</span><span className="text-[11px] font-bold text-blue-500">분석 반경: {p.radius}m</span></div>
          </div>
        </div>
      </section>
      <section className="space-y-6">
        <div><label className="text-[11px] font-black text-slate-400 mb-3 block uppercase tracking-widest">Step 1. 대분류</label>
          <div className="grid grid-cols-2 gap-2">{p.largeCategories.map(cat => (<button key={cat} onClick={() => p.onSelectLarge(cat)} className={`py-3.5 rounded-2xl text-xs font-black transition-all ${p.selectedLarge === cat ? 'bg-blue-950 text-white shadow-lg' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'}`}>{cat}</button>))}</div>
        </div>
        {p.selectedLarge && (<div><label className="text-[11px] font-black text-slate-400 mb-3 block uppercase tracking-widest">Step 2. 중분류</label>
          <div className="flex flex-wrap gap-2">{p.midCategories.map(mCat => (<button key={mCat} onClick={() => p.onSelectMid(mCat)} className={`px-4 py-2.5 rounded-full text-[11px] font-black border-2 transition-all ${p.selectedMid === mCat ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-100 text-slate-400 hover:border-slate-200'}`}>{mCat}</button>))}</div>
        </div>)}
        {p.selectedMid && (<div><label className="text-[11px] font-black text-slate-400 mb-3 block uppercase tracking-widest">Step 3. 소분류</label>
          <select value={p.selectedSmall} onChange={(e) => p.onSelectSmall(e.target.value)} className="w-full p-4 border-2 border-slate-100 rounded-2xl text-sm font-bold focus:border-blue-600 outline-none bg-slate-50"><option value="">소분류 선택</option>{p.smallCategories.map(sCat => (<option key={sCat} value={sCat}>{sCat}</option>))}</select>
        </div>)}
      </section>
    </div>
    
    {/* 버튼 로딩 중앙 정렬 수정 */}
    <button 
      disabled={!p.selectedSmall || p.radius === 0 || p.isLoading} 
      className={`mt-12 py-5 rounded-3xl text-lg font-black transition-all shadow-2xl flex items-center justify-center gap-2 ${p.selectedSmall && p.radius > 0 ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-slate-100 text-slate-300 cursor-not-allowed'}`} 
      onClick={p.onStartAnalysis}
    >
      {p.isLoading ? (
        <Loader2 className="animate-spin" size={24} />
      ) : (
        p.selectedSmall && p.radius > 0 ? "데이터 분석 시작" : "분석 조건을 완성하세요"
      )}
    </button>
  </aside>
  );
};


export default AnalysisSidebar;