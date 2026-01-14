import { useEffect, useRef, useState } from 'react';
import { MapPin, MousePointer2 } from 'lucide-react';
import AnalysisSidebar from "../components/analysis/AnalysisSidebar"
import MapControls from '../components/analysis/MapControls';
const API_BASE_URL = "http://localhost:3000/api";

const calculateBBox = (lat: number, lng: number, r: number) => {
  const latDegree = r / 111000;
  const lngDegree = r / (111000 * Math.cos(lat * Math.PI / 180));
  return `${lat - latDegree},${lng - lngDegree},${lat + latDegree},${lng + lngDegree}`;
};


const AnalysisPage = () => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<any>(null);
  const currentMarker = useRef<any>(null);
  const currentCircle = useRef<any>(null);
  const isDragging = useRef(false);
  const centerLatLng = useRef<any>(null);
  const infoWindowRef = useRef<any>(null);
  const activeMarkerRef = useRef<any>(null);

  const markersRef = useRef<any[]>([]); 
  const estateMarkersRef = useRef<any[]>([]); 
  const landPriceOverlaysRef = useRef<any[]>([]); 
  const landDataRef = useRef<any[]>([]);

  const [showPrompt, setShowPrompt] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [address, setAddress] = useState("지도에서 위치를 선택하세요");
  const [radius, setRadius] = useState(0);
  const [coords, setCoords] = useState({ lat: 37.498095, lng: 127.027610 });

  const [largeCats, setLargeCats] = useState<string[]>([]);
  const [midCats, setMidCats] = useState<string[]>([]);
  const [smallCats, setSmallCats] = useState<string[]>([]);
  const [selectedLarge, setSelectedLarge] = useState("");
  const [selectedMid, setSelectedMid] = useState("");
  const [selectedSmall, setSelectedSmall] = useState("");

  const [showLandPrice, setShowLandPrice] = useState(true); 
  const [showShops, setShowShops] = useState(true);         
  const [showTrades, setShowTrades] = useState(true);       

  useEffect(() => {
    fetch(`${API_BASE_URL}/categories/large`)
      .then(res => res.json())
      .then(data => setLargeCats(data))
      .catch(err => console.error("대분류 로드 실패:", err));
  }, []);

  const handleAllowLocation = () => {
    setShowPrompt(false); setIsLoading(true);
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (p) => initMap(p.coords.latitude, p.coords.longitude),
        () => handleDenyLocation()
      );
    } else handleDenyLocation();
  };

  const handleDenyLocation = () => {
    setShowPrompt(false); setIsLoading(true);
    setTimeout(() => initMap(37.498095, 127.027610), 500);
  };

  const initMap = (lat: number, lng: number) => {
    const { kakao } = window;
    if (!mapContainer.current || mapInstance.current) return;
    const map = new kakao.maps.Map(mapContainer.current, { center: new kakao.maps.LatLng(lat, lng), level: 4 });
    mapInstance.current = map;
    infoWindowRef.current = new kakao.maps.InfoWindow({ zIndex: 999 });

    kakao.maps.event.addListener(map, 'rightclick', (mouseEvent: any) => {
      isDragging.current = true;
      const clickLatLng = mouseEvent.latLng;
      centerLatLng.current = clickLatLng;
      map.panTo(clickLatLng);
      updateAddress(clickLatLng.getLat(), clickLatLng.getLng());

      if (currentMarker.current) currentMarker.current.setMap(null);
      if (currentCircle.current) currentCircle.current.setMap(null);
      
      clearAllData(); 
      infoWindowRef.current.close();
      activeMarkerRef.current = null;
      setRadius(0);

      currentMarker.current = new kakao.maps.Marker({
        position: clickLatLng, map: map,
        image: new kakao.maps.MarkerImage('https://t1.daumcdn.net/localimg/localimages/07/mapapidoc/marker_red.png', new kakao.maps.Size(32, 34))
      });
      currentCircle.current = new kakao.maps.Circle({
        center: clickLatLng, radius: 0, strokeWeight: 2, strokeColor: '#2563eb', strokeOpacity: 0.8, fillColor: '#3b82f6', fillOpacity: 0.2, map: map
      });
    });

    kakao.maps.event.addListener(map, 'mousemove', (mouseEvent: any) => {
      if (isDragging.current && currentCircle.current) {
        const polyline = new kakao.maps.Polyline({ path: [centerLatLng.current, mouseEvent.latLng] });
        let dist = Math.min(Math.round(polyline.getLength()), 1500);
        currentCircle.current.setRadius(dist);
        setRadius(dist);
      }
    });
    window.addEventListener('mouseup', () => { isDragging.current = false; });
    setIsLoading(false);
  };

  const clearAllData = () => {
    markersRef.current.forEach(m => m.setMap(null)); markersRef.current = [];
    estateMarkersRef.current.forEach(m => m.setMap(null)); estateMarkersRef.current = [];
    landPriceOverlaysRef.current.forEach(o => o.setMap(null)); landPriceOverlaysRef.current = [];
  };

  const updateAddress = (lat: number, lng: number) => {
    const { kakao } = window;
    const geocoder = new kakao.maps.services.Geocoder();
    geocoder.coord2Address(lng, lat, (result: any, status: any) => {
      if (status === kakao.maps.services.Status.OK) {
        setAddress(result[0].road_address?.address_name || result[0].address.address_name);
        setCoords({ lat, lng });
      }
    });
  };

  const handleMarkerInteraction = (marker: any, content: string) => {
    if (activeMarkerRef.current === marker) {
      infoWindowRef.current.close();
      marker.setZIndex(1);
      activeMarkerRef.current = null;
      return;
    }
    if (activeMarkerRef.current) activeMarkerRef.current.setZIndex(1);
    marker.setZIndex(100); 
    infoWindowRef.current.setContent(content);
    infoWindowRef.current.open(mapInstance.current, marker);
    activeMarkerRef.current = marker;
  };

  const displayEstateMarker = (item: any, lat: number, lng: number) => {
    const { kakao } = window;
    const marker = new kakao.maps.Marker({
      position: new kakao.maps.LatLng(lat, lng),
      map: showTrades ? mapInstance.current : null,
      image: new kakao.maps.MarkerImage('https://t1.daumcdn.net/localimg/localimages/07/mapapidoc/markerStar.png', new kakao.maps.Size(24, 35)),
      zIndex: 1
    });

    kakao.maps.event.addListener(marker, 'click', () => {
      const rawAmount = parseInt(String(item.dealAmount).replace(/,/g, ''));
      const formattedAmount = rawAmount >= 10000 ? `${Math.floor(rawAmount / 10000)}억 ${(rawAmount % 10000).toLocaleString()}` : `${rawAmount.toLocaleString()}`;
      const content = `<div style="padding:15px; min-width:200px; border-radius:12px; font-family: sans-serif;">
          <div style="margin-bottom:10px; border-bottom: 1px solid #eee; padding-bottom:8px;">
            <span style="background:#2563eb; color:white; padding:2px 6px; border-radius:4px; font-size:10px; font-weight:bold; margin-right:5px;">실거래</span>
            <strong style="font-size:14px; color:#1e293b;">${item.buildingUse}</strong>
          </div>
          <div style="font-size:12px; color:#475569; line-height:1.6;">
            <b>거래금액:</b> <span style="color:#e11d48; font-weight:bold;">${formattedAmount} 만원</span><br/>
            <b>계약일:</b> ${item.dealYear}년 ${item.dealMonth}월
          </div>
        </div>`;
      handleMarkerInteraction(marker, content);
    });
    estateMarkersRef.current.push(marker);
  };

  const displayLandPriceMarkers = (landData: any[]) => {
    const { kakao } = window;
    const center = new kakao.maps.LatLng(coords.lat, coords.lng);

    // 1. 현재 반경 내에 있는 데이터들만 먼저 필터링하여 가격 순으로 정렬
    const validData = landData
      .filter((item) => {
        const itemPos = new kakao.maps.LatLng(item.lat, item.lng);
        const distance = new kakao.maps.Polyline({ path: [center, itemPos] }).getLength();
        return distance <= radius && item.jiga > 0;
      })
      .sort((a, b) => a.jiga - b.jiga);

    if (validData.length === 0) return;

    // 2. 3등분 지점의 가격(임계값) 계산
    const lowThreshold = validData[Math.floor(validData.length * 0.33)].jiga;
    const highThreshold = validData[Math.floor(validData.length * 0.66)].jiga;

    validData.forEach((item) => {
      const itemPos = new kakao.maps.LatLng(item.lat, item.lng);
      const priceDisplay = Math.round(item.jiga / 10000);

      // 3. 가격대에 따른 색상 결정 (초록, 노랑, 빨강)
      let borderColor = "#22c55e"; // 기본 초록 (Low)
      let textColor = "#166534";
      
      if (item.jiga > highThreshold) {
        borderColor = "#ef4444"; // 빨강 (High)
        textColor = "#991b1b";
      } else if (item.jiga > lowThreshold) {
        borderColor = "#eab308"; // 노랑 (Mid)
        textColor = "#854d0e";
      }

      const content = document.createElement('div');
      content.style.cssText = `
        background: white; 
        border: 2px solid ${borderColor}; 
        padding: 2px 6px; 
        border-radius: 6px; 
        font-size: 11px; 
        font-weight: 800; 
        color: ${textColor}; 
        box-shadow: 0 2px 5px rgba(0,0,0,0.2); 
        white-space: nowrap;
      `;
      content.innerHTML = `${priceDisplay.toLocaleString()}<span style="font-size:9px; margin-left:1px;">만</span>`;

      const overlay = new kakao.maps.CustomOverlay({
        position: itemPos,
        content: content,
        xAnchor: 0.5,
        yAnchor: 0.5,
        zIndex: 1
      });

      overlay.setMap(showLandPrice ? mapInstance.current : null);
      landPriceOverlaysRef.current.push(overlay);
    });
  };

  const handleStartAnalysis = async () => {
    if (!selectedSmall || radius === 0) return;
    setIsLoading(true); clearAllData();
    infoWindowRef.current.close();
    activeMarkerRef.current = null;

    try {
      await fetchRealEstateData(coords.lat, coords.lng, radius);
      const bbox = calculateBBox(coords.lat, coords.lng, radius);
      const landRes = await fetch(`${API_BASE_URL}/real-estate/land-price?bbox=${bbox}`);
      const landData = await landRes.json();
      landDataRef.current = landData;
      displayLandPriceMarkers(landData);
      
      const response = await fetch(`${API_BASE_URL}/market/search?lat=${coords.lat}&lng=${coords.lng}&radius=${radius}&smallCat=${encodeURIComponent(selectedSmall)}`);
      const data = await response.json();

      if (data.length > 0) {
        markersRef.current = data.map((shop: any) => {
          const marker = new kakao.maps.Marker({ 
            position: new kakao.maps.LatLng(shop.lat, shop.lon), 
            map: showShops ? mapInstance.current : null,
            zIndex: 1
          });
          kakao.maps.event.addListener(marker, 'click', () => {
            const content = `<div style="padding:15px;"><strong>${shop.store_name}</strong><br/>${shop.category_small_name}</div>`;
            handleMarkerInteraction(marker, content);
          });
          return marker;
        });
      }
    } catch (err) { console.error("분석 중 오류:", err); } finally { setIsLoading(false); }
  };

  const fetchRealEstateData = (centerLat: number, centerLng: number, searchRadius: number) => {
    return new Promise<void>((resolve) => {
      const { kakao } = window;
      const geocoder = new kakao.maps.services.Geocoder();
      geocoder.coord2RegionCode(centerLng, centerLat, async (result: any, status: any) => {
        if (status === kakao.maps.services.Status.OK) {
          const region = result.find((r: any) => r.region_type === 'B');
          if (!region) return resolve();
          try {
            const res = await fetch(`${API_BASE_URL}/real-estate/trade?lawdCd=${region.code.substring(0, 5)}&umdNm=${encodeURIComponent(region.region_3depth_name)}`);
            const rawData = await res.json();
            if (rawData) {
              rawData.forEach((item: any) => {
                // 안전하게 문자열로 변환 후 체크 (item.jibun 에러 해결)
                const jibunStr = item.jibun ? String(item.jibun) : "";
                if (!jibunStr || jibunStr.includes('*')) return;

                geocoder.addressSearch(`${item.sggNm} ${item.umdNm} ${jibunStr}`, (addrResult: any, addrStatus: any) => {
                  if (addrStatus === kakao.maps.services.Status.OK) {
                    const itemPoint = new kakao.maps.LatLng(parseFloat(addrResult[0].y), parseFloat(addrResult[0].x));
                    if (new kakao.maps.Polyline({ path: [new kakao.maps.LatLng(centerLat, centerLng), itemPoint] }).getLength() <= searchRadius) {
                      displayEstateMarker(item, itemPoint.getLat(), itemPoint.getLng());
                    }
                  }
                });
              });
            }
          } catch (e) { console.error(e); }
        }
        resolve();
      });
    });
  };

  // ... (기타 토글 함수들 동일)
  const toggleLandPrice = () => {
    const n = !showLandPrice; setShowLandPrice(n);
    landPriceOverlaysRef.current.forEach(o => o.setMap(n ? mapInstance.current : null)); 
  };
  const toggleShops = () => {
    const n = !showShops; 
    setShowShops(n); 
    markersRef.current.forEach(m => m.setMap(n ? mapInstance.current : null)); 
    if(!n && activeMarkerRef.current && markersRef.current.includes(activeMarkerRef.current)){ 
      infoWindowRef.current.close(); activeMarkerRef.current = null; 
    } 
  };
  const toggleTrades = () => {
    const n = !showTrades;
    setShowTrades(n);
    estateMarkersRef.current.forEach(m => m.setMap(n ? mapInstance.current : null));
    if(!n && activeMarkerRef.current && estateMarkersRef.current.includes(activeMarkerRef.current)) {
      infoWindowRef.current.close(); activeMarkerRef.current = null; 
    }
  };
  const handleLargeChange = async (cat: string) => {
    setSelectedLarge(cat);
    setSelectedMid("");
    setSelectedSmall("");
    setSmallCats([]); 
    try { 
      const res = await fetch(`${API_BASE_URL}/categories/mid/${encodeURIComponent(cat)}`); 
      setMidCats(await res.json()); 
    } catch (err) { 
      console.error(err); 
    } 
  };
  const handleMidChange = async (mCat: string) => {
    setSelectedMid(mCat); 
    setSelectedSmall(""); 
    try {
      const res = await fetch(`${API_BASE_URL}/categories/small/${encodeURIComponent(mCat)}`);
      setSmallCats(await res.json());
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    const { kakao } = window;
    if (kakao) kakao.maps.load(() => {});
    window.addEventListener('contextmenu', (e) => e.preventDefault());
  }, []);

  return (
    <div className="relative flex h-full w-full overflow-hidden bg-white text-slate-900">
      {showPrompt && (
        <div className="absolute inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white p-8 rounded-3xl shadow-2xl max-w-sm w-full text-center border border-slate-100">
            <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-6"><MapPin size={32} /></div>
            <h2 className="text-2xl font-black mb-2 tracking-tight">상권 분석 시작</h2>
            <p className="text-slate-500 mb-8 text-sm leading-relaxed">위치 권한을 허용하시겠습니까?</p>
            <div className="flex gap-3">
              <button onClick={handleDenyLocation} className="flex-1 py-4 bg-slate-100 text-slate-600 rounded-2xl font-bold">거절</button>
              <button onClick={handleAllowLocation} className="flex-1 py-4 bg-blue-600 text-white rounded-2xl font-bold">허용</button>
            </div>
          </div>
        </div>
      )}
      <AnalysisSidebar
        address={address}
        radius={radius}
        largeCategories={largeCats}
        midCategories={midCats}
        smallCategories={smallCats}
        selectedLarge={selectedLarge}
        selectedMid={selectedMid}
        selectedSmall={selectedSmall}
        isLoading={isLoading}
        onSelectLarge={handleLargeChange}
        onSelectMid={handleMidChange}
        onSelectSmall={setSelectedSmall}
        onStartAnalysis={handleStartAnalysis}
      />
      

      <section className="flex-1 relative overflow-hidden">
        <div ref={mapContainer} className="absolute inset-0 w-full h-full" />
        <MapControls
          showLandPrice={showLandPrice}
          showShops={showShops}
          showTrades={showTrades}
          toggleLandPrice={toggleLandPrice}
          toggleShops={toggleShops}
          toggleTrades={toggleTrades}
        />
        <div className="absolute top-8 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 bg-blue-950/90 backdrop-blur-md text-white px-8 py-3 rounded-full shadow-2xl border border-white/10">
          <MousePointer2 size={16} className="text-yellow-400 animate-pulse" />
          <span className="text-[13px] font-bold tracking-tight">우클릭 후 드래그하여 범위를 설정하세요</span>
        </div>
      </section>
    </div>
  );
};

export default AnalysisPage;