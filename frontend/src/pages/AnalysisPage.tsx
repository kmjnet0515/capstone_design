import { useEffect, useRef, useState } from 'react';
import { ChevronRight, Loader2, MapPin, MousePointer2 } from 'lucide-react';

// --- 타입 정의 (생략 없이 유지) ---
interface LatLng { getLat(): number; getLng(): number; }
interface KakaoMapInstance { setCenter(latlng: LatLng): void; panTo(latlng: LatLng): void; relayout(): void; }
interface KakaoMaps {
  LatLng: new (lat: number, lng: number) => LatLng;
  Map: new (container: HTMLElement, options: any) => KakaoMapInstance;
  Marker: new (options: any) => any;
  MarkerImage: new (src: string, size: any) => any;
  Size: new (w: number, h: number) => any;
  Circle: new (options: any) => any;
  Polyline: new (options: any) => { getLength(): number };
  InfoWindow: new (options: any) => any;
  load: (callback: () => void) => void;
  event: { addListener(target: any, type: string, callback: (mouseEvent?: any) => void): void; };
  services: { Geocoder: new () => any; Status: { OK: string }; };
}
declare global { interface Window { kakao: { maps: KakaoMaps }; } }

const API_BASE_URL = "http://localhost:3000/api"; // 백엔드 주소

const AnalysisPage = () => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<any>(null);
  const currentMarker = useRef<any>(null);
  const currentCircle = useRef<any>(null);
  const isDragging = useRef(false);
  const centerLatLng = useRef<any>(null);
  const infoWindowRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);


  // 로딩 및 권한 상태
  const [showPrompt, setShowPrompt] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  
  // 위치 및 반경 상태
  const [address, setAddress] = useState("지도에서 위치를 선택하세요");
  const [radius, setRadius] = useState(0);

  // --- 카카오 맵 위치 좌표 저장용 (분석 시 필요) ---
  const [coords, setCoords] = useState({ lat: 37.498095, lng: 127.027610 });

  // --- 동적 카테고리 상태 ---
  const [largeCats, setLargeCats] = useState<string[]>([]);
  const [midCats, setMidCats] = useState<string[]>([]);
  const [smallCats, setSmallCats] = useState<string[]>([]);

  // 선택된 카테고리 값
  const [selectedLarge, setSelectedLarge] = useState("");
  const [selectedMid, setSelectedMid] = useState("");
  const [selectedSmall, setSelectedSmall] = useState("");

  
  // 1. 초기 대분류 로드
  useEffect(() => {
    fetch(`${API_BASE_URL}/categories/large`)
      .then(res => res.json())
      .then(data => setLargeCats(data))
      .catch(err => console.error("대분류 로드 실패:", err));
  }, []);

  // 2. 대분류 변경 시 중분류 로드
  const handleLargeChange = async (cat: string) => {
    setSelectedLarge(cat);
    setSelectedMid("");
    setSelectedSmall("");
    setSmallCats([]);
    
    try {
      const res = await fetch(`${API_BASE_URL}/categories/mid/${encodeURIComponent(cat)}`);
      const data = await res.json();
      setMidCats(data);
    } catch (err) {
      console.error("중분류 로드 실패:", err);
    }
  };

  // 3. 중분류 변경 시 소분류 로드
  const handleMidChange = async (mCat: string) => {
    setSelectedMid(mCat);
    setSelectedSmall("");
    
    try {
      const res = await fetch(`${API_BASE_URL}/categories/small/${encodeURIComponent(mCat)}`);
      const data = await res.json();
      setSmallCats(data);
    } catch (err) {
      console.error("소분류 로드 실패:", err);
    }
  };

  // 주소 변환 (좌표 -> 주소)
  const updateAddress = (lat: number, lng: number) => {
    const { kakao } = window;
    const geocoder = new kakao.maps.services.Geocoder();
    geocoder.coord2Address(lng, lat, (result: any, status: any) => {
      if (status === kakao.maps.services.Status.OK) {
        const addr = result[0].road_address?.address_name || result[0].address.address_name;
        setAddress(addr);
        setCoords({ lat, lng });
      }
    });
  };

  const initMap = (lat: number, lng: number) => {
    const { kakao } = window;
    if (!mapContainer.current || mapInstance.current) return;

    const options = { center: new kakao.maps.LatLng(lat, lng), level: 4 };
    const map = new kakao.maps.Map(mapContainer.current, options);
    mapInstance.current = map;

    kakao.maps.event.addListener(map, 'rightclick', (mouseEvent: any) => {
      isDragging.current = true;
      const clickLatLng = mouseEvent.latLng;
      centerLatLng.current = clickLatLng;
      
      map.panTo(clickLatLng);
      updateAddress(clickLatLng.getLat(), clickLatLng.getLng());

      // --- [추가] 새로운 위치를 잡을 때 기존 요소들 청소 ---
      if (currentMarker.current) currentMarker.current.setMap(null);
      if (currentCircle.current) currentCircle.current.setMap(null);
      
      // 1. 기존에 분석으로 생성된 매장 마커들 싹 지우기
      clearMarkers(); 

      // 2. 열려있는 인포윈도우 닫기
      if (infoWindowRef.current) {
        infoWindowRef.current.close();
      }
      
      // 3. 반경(radius) 초기화 (새로운 드래그를 위해)
      setRadius(0);
      // ----------------------------------------------

      currentMarker.current = new kakao.maps.Marker({
        position: clickLatLng,
        map: map,
        image: new kakao.maps.MarkerImage(
          'https://t1.daumcdn.net/localimg/localimages/07/mapapidoc/marker_red.png',
          new kakao.maps.Size(32, 34)
        )
      });

      currentCircle.current = new kakao.maps.Circle({
        center: clickLatLng, radius: 0, strokeWeight: 2, strokeColor: '#2563eb',
        strokeOpacity: 0.8, fillColor: '#3b82f6', fillOpacity: 0.2, map: map
      });
    });

    kakao.maps.event.addListener(map, 'mousemove', (mouseEvent: any) => {
      if (isDragging.current && currentCircle.current) {
        const moveLatLng = mouseEvent.latLng;
        const polyline = new kakao.maps.Polyline({ path: [centerLatLng.current, moveLatLng] });
        let dist = Math.round(polyline.getLength());
        if (dist > 1500) dist = 1500;
        currentCircle.current.setRadius(dist);
        setRadius(dist);
      }
    });

    const handleMouseUp = () => { isDragging.current = false; };
    window.addEventListener('mouseup', handleMouseUp);
    setIsLoading(false);
  };

  const handleAllowLocation = () => {
    setShowPrompt(false);
    setIsLoading(true);
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (p) => initMap(p.coords.latitude, p.coords.longitude),
        () => handleDenyLocation()
      );
    } else handleDenyLocation();
  };

  const handleDenyLocation = () => {
    setShowPrompt(false);
    setIsLoading(true);
    setTimeout(() => initMap(37.498095, 127.027610), 500);
  };

  const clearMarkers = () => {
    markersRef.current.forEach(marker => marker.setMap(null));
    markersRef.current = [];
  };

  // 실제 데이터 분석 및 지도 표시 함수
  const handleStartAnalysis = async () => {
    if (!selectedSmall || radius === 0) return;

    setIsLoading(true);
    clearMarkers();
    if (infoWindowRef.current) infoWindowRef.current.close();
    try {
      const response = await fetch(
        `${API_BASE_URL}/market/search?lat=${coords.lat}&lng=${coords.lng}&radius=${radius}&smallCat=${encodeURIComponent(selectedSmall)}`
      );
      const data = await response.json();

      if (data.length === 0) {
        alert("해당 조건에 맞는 상점이 이 지역에 없습니다.");
        return;
      }

      const { kakao } = window;

      // 인포윈도우 인스턴스가 없으면 하나 생성 (Ref로 관리하여 단 하나만 존재하게 함)
      if (!infoWindowRef.current) {
        infoWindowRef.current = new kakao.maps.InfoWindow({ zIndex: 1 });
      }

      const newMarkers = data.map((shop: any) => {
        const position = new kakao.maps.LatLng(shop.lat, shop.lon);
        
        const marker = new kakao.maps.Marker({
          position: position,
          map: mapInstance.current,
          title: shop.store_name
        });

        // 마커 클릭 이벤트 설정
        kakao.maps.event.addListener(marker, 'click', () => {
          const iw = infoWindowRef.current;
          
          const currentContent = iw.getContent();
          if (iw.getMap() && currentContent && currentContent.includes(shop.store_name)) {
            iw.close();
          } else {

            const content = `
              <div style="padding:15px; min-width:180px; border-radius:8px;">
                <div style="margin-bottom:8px;">
                  <strong style="display:block; font-size:15px; color:#1e293b;">${shop.store_name}</strong>
                  <span style="font-size:12px; color:#3b82f6; font-weight:600;">${shop.category_small_name}</span>
                </div>
                <div style="font-size:12px; color:#64748b; line-height:1.4; margin-bottom:10px;">
                  ${shop.address_road}
                </div>
              </div>
            `;
            
            iw.setContent(content);
            iw.open(mapInstance.current, marker);
          }
        });

        return marker;
      });

      markersRef.current = newMarkers;
      
      // 분석 요약 알림 (커스텀 UI로 대체 가능)
      console.log(`분석 결과: ${data.length}개의 매장 발견`);

    } catch (err) {
      console.error("데이터 조회 실패:", err);
      alert("데이터를 가져오는 중 오류가 발생했습니다.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const { kakao } = window;
    if (kakao) kakao.maps.load(() => {});
    const preventMenu = (e: MouseEvent) => e.preventDefault();
    window.addEventListener('contextmenu', preventMenu);
    return () => window.removeEventListener('contextmenu', preventMenu);
  }, []);

  return (
    <div className="relative flex h-screen w-full overflow-hidden bg-white text-slate-900">
      
      {/* 1. 권한 확인 팝업 (유지) */}
      {showPrompt && (
        <div className="absolute inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white p-8 rounded-3xl shadow-2xl max-w-sm w-full text-center border border-slate-100">
            <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <MapPin size={32} />
            </div>
            <h2 className="text-2xl font-black mb-2 tracking-tight">상권 분석 시작</h2>
            <p className="text-slate-500 mb-8 text-sm leading-relaxed">정확한 분석을 위해 현재 위치를 사용할까요?</p>
            <div className="flex gap-3">
              <button onClick={handleDenyLocation} className="flex-1 py-4 bg-slate-100 text-slate-600 rounded-2xl font-bold">거절</button>
              <button onClick={handleAllowLocation} className="flex-1 py-4 bg-blue-600 text-white rounded-2xl font-bold shadow-lg shadow-blue-200">허용</button>
            </div>
          </div>
        </div>
      )}

      {/* 좌측 사이드바 */}
      <aside className="w-[380px] bg-white border-r border-slate-100 p-8 flex flex-col shadow-xl z-10 overflow-y-auto shrink-0">
        <header className="mb-10">
            <h1 className="text-3xl font-black text-blue-950 italic">SBC 365</h1>
            <p className="text-[11px] text-blue-600 font-bold uppercase tracking-[0.25em] mt-1.5">Market Analysis Tool</p>
        </header>

        <div className="space-y-10 flex-1">
          {/* 선택 지점 정보 카드 */}
          <section>
            <label className="text-[11px] font-black text-slate-400 mb-3 block uppercase tracking-widest">Selected Location</label>
            <div className="p-5 border-2 border-blue-600 rounded-3xl bg-blue-50/30">
              <div className="flex items-start gap-3">
                <MapPin size={18} className="text-blue-600 mt-1" />
                <div>
                  <span className="text-sm font-black text-blue-950 block leading-snug mb-1">{address}</span>
                  <span className="text-[11px] font-bold text-blue-500">분석 반경: {radius}m</span>
                </div>
              </div>
            </div>
          </section>

          {/* 업종 계층 필터 (API 기반 동적 렌더링) */}
          <section className="space-y-6">
            <div>
              <label className="text-[11px] font-black text-slate-400 mb-3 block uppercase tracking-widest">Step 1. 대분류</label>
              <div className="grid grid-cols-2 gap-2">
                {largeCats.map(cat => (
                  <button
                    key={cat}
                    onClick={() => handleLargeChange(cat)}
                    className={`py-3.5 rounded-2xl text-xs font-black transition-all ${
                      selectedLarge === cat ? 'bg-blue-950 text-white shadow-lg' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {selectedLarge && (
              <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                <label className="text-[11px] font-black text-slate-400 mb-3 block uppercase tracking-widest">Step 2. 중분류</label>
                <div className="flex flex-wrap gap-2">
                  {midCats.map(mCat => (
                    <button
                      key={mCat}
                      onClick={() => handleMidChange(mCat)}
                      className={`px-4 py-2.5 rounded-full text-[11px] font-black border-2 transition-all ${
                        selectedMid === mCat ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-100 text-slate-400 hover:border-slate-200'
                      }`}
                    >
                      {mCat}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {selectedMid && (
              <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                <label className="text-[11px] font-black text-slate-400 mb-3 block uppercase tracking-widest">Step 3. 소분류</label>
                <div className="relative">
                  <select 
                    value={selectedSmall}
                    onChange={(e) => setSelectedSmall(e.target.value)}
                    className="w-full p-4 border-2 border-slate-100 rounded-2xl text-sm font-bold focus:border-blue-600 outline-none bg-slate-50 cursor-pointer appearance-none"
                  >
                    <option value="">소분류 업종 선택</option>
                    {smallCats.map(sCat => (
                      <option key={sCat} value={sCat}>{sCat}</option>
                    ))}
                  </select>
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                    <ChevronRight size={18} className="rotate-90" />
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>

        <button 
          disabled={!selectedSmall || radius === 0}
          className={`mt-12 py-5 rounded-3xl text-lg font-black transition-all shadow-2xl active:scale-95 flex items-center justify-center gap-2 ${
            selectedSmall && radius > 0 ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-slate-100 text-slate-300 cursor-not-allowed'
          }`}
          onClick={handleStartAnalysis}
        >
          {selectedSmall && radius > 0 ? "데이터 분석 시작" : "분석 조건을 완성하세요"}
        </button>
      </aside>

      {/* 우측 지도 영역 (유지) */}
      <section className="flex-1 relative overflow-hidden">
        <div ref={mapContainer} className="absolute inset-0 w-full h-full" />
        <div className="absolute top-8 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 bg-blue-950/90 backdrop-blur-md text-white px-8 py-3 rounded-full shadow-2xl border border-white/10">
             <MousePointer2 size={16} className="text-yellow-400 animate-pulse" />
             <span className="text-[13px] font-bold tracking-tight">
                원하는 위치를 <span className="text-yellow-400">우클릭 후 드래그</span>하여 범위를 설정하세요
             </span>
        </div>
      </section>
    </div>
  );
};

export default AnalysisPage;