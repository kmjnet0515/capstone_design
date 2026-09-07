import { useEffect, useRef, useState } from 'react';
import { MapPin, MousePointer2 } from 'lucide-react';
import AnalysisSidebar from "../components/analysis/AnalysisSidebar"
import MapControls from '../components/analysis/MapControls';
import AnalysisDashboard from '../components/analysis/AnalysisDashboard';
import type {SupportProgram}  from '../components/analysis/SupportPrograms';
import { useAnalysisStore } from '../store/useAnalysisStore';
import { API_BASE_URL } from '../config/apiBase';

const calculateBBox = (lat: number, lng: number, r: number) => {
  const latDegree = r / 111000;
  const lngDegree = r / (111000 * Math.cos(lat * Math.PI / 180));
  return `${lat - latDegree},${lng - lngDegree},${lat + latDegree},${lng + lngDegree}`;
};

/** 카카오 지도 레벨: 숫자가 작을수록 확대. 최대 확대(1)에서만 개별 라벨 표시 */
const LAND_PRICE_LEVEL_INDIVIDUAL_MAX = 1;
const LAND_PRICE_IDLE_DEBOUNCE_MS = 120;

const landPriceCellSizePx = (level: number): number | undefined => {
  if (level <= LAND_PRICE_LEVEL_INDIVIDUAL_MAX) return undefined;
  if (level <= 3) return 64;
  if (level <= 6) return 88;
  if (level <= 9) return 104;
  return 136;
};

const medianNum = (values: number[]): number => {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
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
  const districtPolygonsRef = useRef<any[]>([]); // 폴리곤 객체 저장용
  const closedMarkersRef = useRef<any[]>([]); // 폐업 마커 저장용
  const closedPolygonsRef = useRef<any[]>([]); // 블록 폴리곤 저장용 Ref
  const hasHydratedFromStore = useRef(false); // 전역 상태에서 한 번만 복원
  const hasRestoredOverlays = useRef(false);  // 지도 오버레이 복원 여부
  const landPriceIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rebuildLandPriceOverlaysRef = useRef<() => void>(() => {});
  
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
  const coordsRef = useRef(coords);
  const radiusRef = useRef(radius);
  const showLandPriceRef = useRef(showLandPrice);
  const [showShops, setShowShops] = useState(true);         
  const [showTrades, setShowTrades] = useState(true);
  const [showDashboard, setShowDashboard] = useState(false);
  const [showDistricts, setShowDistricts] = useState(true); // 상권 영역 표시 여부
  const aiReport = useAnalysisStore((state) => state.aiReport);
  const supportPrograms = useAnalysisStore((state) => state.supportPrograms) as SupportProgram[];
  const [isReportLoading, setIsReportLoading] = useState(false);
  const [showClosed, setShowClosed] = useState(true); // 폐업 마커 표시 여부
  const [isSupportLoading, setIsSupportLoading] = useState(false);
  const setAnalysisResult = useAnalysisStore((state) => state.setAnalysisResult);
  const locationConsent = useAnalysisStore((state) => state.locationConsent);
  const setLocationConsent = useAnalysisStore((state) => state.setLocationConsent);
  const storedCoords = useAnalysisStore((state) => state.coords);
  const storedRadius = useAnalysisStore((state) => state.radius);
  const storedAddress = useAnalysisStore((state) => state.address);
  const storedCategory = useAnalysisStore((state) => state.selectedCategory);

  coordsRef.current = coords;
  radiusRef.current = radius;
  showLandPriceRef.current = showLandPrice;

  // zustand 기반 지원제도 setter (useState API와 동일하게 동작하도록 래핑)
  const setSupportPrograms = (
    updater: React.SetStateAction<SupportProgram[]>
  ) => {
    setAnalysisResult({
      supportPrograms:
        typeof updater === 'function'
          ? (updater as (prev: SupportProgram[]) => SupportProgram[])(supportPrograms)
          : updater,
    });
  };

  useEffect(() => {
    fetch(`${API_BASE_URL}/categories/large`)
      .then(res => res.json())
      .then(data => setLargeCats(data))
      .catch(err => console.error("대분류 로드 실패:", err));
  }, []);

  // 전역 분석 결과가 있으면 사이드바/대시보드 상태를 한 번 복원
  useEffect(() => {
    if (hasHydratedFromStore.current) return;

    if ((storedRadius && storedRadius > 0) || storedCategory?.small) {
      hasHydratedFromStore.current = true;

      setCoords(storedCoords);
      if (storedAddress) setAddress(storedAddress);
      setRadius(storedRadius);

      if (storedCategory.large) setSelectedLarge(storedCategory.large);
      if (storedCategory.mid) setSelectedMid(storedCategory.mid);
      if (storedCategory.small) setSelectedSmall(storedCategory.small);

      setShowDashboard(true);
      setShowPrompt(false);
    }
  }, [storedCoords, storedRadius, storedAddress, storedCategory]);

  // 지도 객체가 준비된 뒤, 스토어에 저장된 데이터로 오버레이/마커 복원
  useEffect(() => {
    const { kakao } = window as any;
    if (!kakao || !mapInstance.current) return;
    if (!hasHydratedFromStore.current) return;
    if (hasRestoredOverlays.current) return;
    if (!storedCoords || !storedRadius || storedRadius === 0) return;

    // coords/radius 상태가 스토어 값과 동기화된 이후에만 복원 수행
    if (
      coords.lat !== storedCoords.lat ||
      coords.lng !== storedCoords.lng ||
      radius !== storedRadius
    ) {
      return;
    }

    hasRestoredOverlays.current = true;

    // 1) 중심 마커 & 반경 원은 다른 effect에서 복원
    // 2) 공시지가(landPrices)
    if (useAnalysisStore.getState().landPrices.length > 0) {
      const land = useAnalysisStore.getState().landPrices;
      landDataRef.current = land;
      displayLandPriceMarkers(land);
    }

    // 3) 인근 상가(shops) – 기존 그룹화 로직 재사용
    const storedShops = useAnalysisStore.getState().shops;
    if (Array.isArray(storedShops) && storedShops.length > 0) {
      const storeGroups = new Map<string, any[]>();
      storedShops.forEach((shop: any) => {
        const key = `${shop.lat},${shop.lon}`;
        if (!storeGroups.has(key)) storeGroups.set(key, []);
        storeGroups.get(key)?.push(shop);
      });

      markersRef.current = [];
      storeGroups.forEach((shops, key) => {
        const [lat, lon] = key.split(',').map(Number);
        const marker = new kakao.maps.Marker({
          position: new kakao.maps.LatLng(lat, lon),
          map: showShops ? mapInstance.current : null,
          zIndex: 1,
        });

        kakao.maps.event.addListener(marker, 'click', () => {
          let content = '';
          if (shops.length === 1) {
            const shop = shops[0];
            content = `<div style="padding:15px; min-width:150px;">
              <strong style="font-size:11px;">${shop.store_name}</strong><br/>
              <span style="font-size:12px; color:#666;">${shop.category_small_name}</span>
            </div>`;
          } else {
            const listHtml = shops
              .map(
                (s: any, index: number) => `
                <li style="padding: 6px 0; border-bottom: ${
                  index === shops.length - 1 ? 'none' : '1px solid #eee'
                };">
                  <div style="font-weight:bold; font-size:13px; color:#333;">${s.store_name}</div>
                  <div style="font-size:11px; color:#888;">${s.category_small_name}</div>
                </li>`
              )
              .join('');
            content = `<div style="padding:15px; min-width:220px; max-height:250px; overflow-y:auto;">
              <div style="margin-bottom:8px; font-weight:bold; border-bottom:2px solid #3b82f6; padding-bottom:6px;">🏢 이 건물의 상가 (${shops.length})</div>
              <ul style="list-style:none; padding:0; margin:0;">${listHtml}</ul>
            </div>`;
          }
          handleMarkerInteraction(marker, content);
        });
        markersRef.current.push(marker);
      });
    }

    // 4) 주요 상권 폴리곤(majorDistricts)
    const storedDistricts = useAnalysisStore.getState().majorDistricts;
    if (Array.isArray(storedDistricts) && storedDistricts.length > 0) {
      displayMajorDistricts(storedDistricts);
    }

    // 5) 폐업/활력도 블록(Blocks)
    const storedBlocks = useAnalysisStore.getState().blocks;
    if (Array.isArray(storedBlocks) && storedBlocks.length > 0) {
      drawClosedBlocks(storedBlocks);
    }

    // 6) 실거래 데이터는 원래 로직과 동일하게 재요청 (주소/반경 기반)
    fetchRealEstateData(storedCoords.lat, storedCoords.lng, storedRadius);
  }, [coords.lat, coords.lng, radius]);

  // 이전 세션에서 위치 권한 여부를 기억하고 있으면, 재진입 시 바로 지도 초기화
  useEffect(() => {
    const { kakao } = window as any;
    if (!kakao) return;

    kakao.maps.load(() => {
      if (locationConsent === 'unknown' || mapInstance.current) return;

      setShowPrompt(false);
      setIsLoading(true);

      const base = storedCoords || coords;
      initMap(base.lat, base.lng);
    });
    // 최초 진입 때만 확인하면 되므로 dependency 배열은 비워둔다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAllowLocation = () => {
    setLocationConsent('allowed');
    setShowPrompt(false); setIsLoading(true);
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (p) => initMap(p.coords.latitude, p.coords.longitude),
        () => handleDenyLocation()
      );
    } else handleDenyLocation();
  };

  const handleDenyLocation = () => {
    setLocationConsent('denied');
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
        let dist = Math.min(Math.round(polyline.getLength()), 750);
        currentCircle.current.setRadius(dist);
        setRadius(dist);
      }
    });
    window.addEventListener('mouseup', () => { isDragging.current = false; });
    kakao.maps.event.addListener(map, 'idle', () => {
      if (landPriceIdleTimerRef.current) clearTimeout(landPriceIdleTimerRef.current);
      landPriceIdleTimerRef.current = setTimeout(() => {
        rebuildLandPriceOverlaysRef.current();
      }, LAND_PRICE_IDLE_DEBOUNCE_MS);
    });
    setIsLoading(false);
  };

  const clearAllData = () => {
    markersRef.current.forEach(m => m.setMap(null)); markersRef.current = [];
    estateMarkersRef.current.forEach(m => m.setMap(null)); estateMarkersRef.current = [];
    landPriceOverlaysRef.current.forEach(o => o.setMap(null)); landPriceOverlaysRef.current = [];
    closedMarkersRef.current.forEach(m => m.setMap(null)); 
    closedMarkersRef.current = [];
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
    (marker as any).data = item;
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

  rebuildLandPriceOverlaysRef.current = () => {
    const kakao = (window as any).kakao;
    if (!kakao || !mapInstance.current) return;

    const map = mapInstance.current;
    landPriceOverlaysRef.current.forEach((o) => o.setMap(null));
    landPriceOverlaysRef.current = [];

    const landData = landDataRef.current;
    if (!showLandPriceRef.current || !Array.isArray(landData) || landData.length === 0) return;

    const cx = coordsRef.current;
    const rad = radiusRef.current;
    const center = new kakao.maps.LatLng(cx.lat, cx.lng);

    const validData = landData
      .filter((item: any) => {
        const itemPos = new kakao.maps.LatLng(item.lat, item.lng);
        const distance = new kakao.maps.Polyline({ path: [center, itemPos] }).getLength();
        return distance <= rad && item.jiga > 0;
      })
      .sort((a: any, b: any) => a.jiga - b.jiga);

    if (validData.length === 0) return;

    const totalPlots = validData.length;
    const lowIdx = Math.max(0, Math.floor(totalPlots * 0.33));
    const highIdx = Math.max(0, Math.floor(totalPlots * 0.66));
    const lowThreshold = validData[lowIdx].jiga;
    const highThreshold = validData[highIdx].jiga;

    const pickColors = (jiga: number) => {
      let borderColor = '#22c55e';
      let textColor = '#166534';
      if (jiga >= highThreshold && totalPlots >= 3) {
        borderColor = '#ef4444';
        textColor = '#991b1b';
      } else if (jiga >= lowThreshold && totalPlots >= 2) {
        borderColor = '#eab308';
        textColor = '#854d0e';
      }
      return { borderColor, textColor };
    };

    const manifold = '<span style="font-size:9px;margin-left:1px">만</span>';

    const addOverlay = (lat: number, lng: number, innerHtml: string, fontSizePx: string, jigaForColor: number) => {
      const { borderColor, textColor } = pickColors(jigaForColor);
      const content = document.createElement('div');
      content.style.cssText = `
        background: white;
        border: 2px solid ${borderColor};
        padding: 2px 6px;
        border-radius: 6px;
        font-size: ${fontSizePx};
        font-weight: 800;
        color: ${textColor};
        box-shadow: 0 2px 5px rgba(0,0,0,0.2);
        white-space: nowrap;
      `;
      content.innerHTML = innerHtml;
      const overlay = new kakao.maps.CustomOverlay({
        position: new kakao.maps.LatLng(lat, lng),
        content,
        xAnchor: 0.5,
        yAnchor: 0.5,
        zIndex: 1,
      });
      overlay.setMap(map);
      landPriceOverlaysRef.current.push(overlay);
    };

    const buildLabelSingle = (jiga: number) => {
      const priceDisplay = Math.round(jiga / 10000);
      return `${priceDisplay.toLocaleString()}${manifold}`;
    };

    const buildLabelCluster = (items: any[]) => {
      const jigas = items.map((i) => i.jiga);
      const avgJ = jigas.reduce((a, b) => a + b, 0) / jigas.length;
      const mins = Math.min(...jigas);
      const maxs = Math.max(...jigas);
      const avgD = Math.round(avgJ / 10000);
      const minD = Math.round(mins / 10000);
      const maxD = Math.round(maxs / 10000);
      if (items.length === 1 || minD === maxD) {
        return { html: `${avgD.toLocaleString()}${manifold}`, jigaForColor: avgJ };
      }
      return {
        html: `${avgD.toLocaleString()} <span style="font-weight:700">(${minD.toLocaleString()}~${maxD.toLocaleString()})</span>${manifold}`,
        jigaForColor: avgJ,
      };
    };

    const level = typeof map.getLevel === 'function' ? map.getLevel() : LAND_PRICE_LEVEL_INDIVIDUAL_MAX;
    const cellPx = landPriceCellSizePx(level);

    if (!cellPx || typeof map.getProjection !== 'function') {
      validData.forEach((item: any) => {
        addOverlay(item.lat, item.lng, buildLabelSingle(item.jiga), '11px', item.jiga);
      });
      return;
    }

    const projection = map.getProjection();
    if (!projection?.pointFromCoords) {
      validData.forEach((item: any) => {
        addOverlay(item.lat, item.lng, buildLabelSingle(item.jiga), '11px', item.jiga);
      });
      return;
    }

    const buckets = new Map<string, any[]>();

    validData.forEach((item: any) => {
      const itemPos = new kakao.maps.LatLng(item.lat, item.lng);
      let gx = 0;
      let gy = 0;
      try {
        const pt = projection.pointFromCoords(itemPos);
        gx = Math.floor(pt.x / cellPx);
        gy = Math.floor(pt.y / cellPx);
      } catch {
        gx = Math.floor(item.lat * 10000);
        gy = Math.floor(item.lng * 10000);
      }
      const key = `${gx},${gy}`;
      const cur = buckets.get(key);
      if (cur) cur.push(item);
      else buckets.set(key, [item]);
    });

    buckets.forEach((items) => {
      const { html, jigaForColor } = buildLabelCluster(items);
      const latM = medianNum(items.map((i: any) => i.lat));
      const lngM = medianNum(items.map((i: any) => i.lng));
      const fontSize = items.length > 1 ? '10px' : '11px';
      addOverlay(latM, lngM, html, fontSize, jigaForColor);
    });
  };

  const displayLandPriceMarkers = (landData: any[]) => {
    landDataRef.current = landData;
    rebuildLandPriceOverlaysRef.current();
  };

  // 시작
  const handleStartAnalysis = async () => {
    const { kakao } = window;
    // 필수 데이터 체크
    if (!selectedSmall || radius === 0) {
      alert("업종과 분석 반경을 설정해주세요.");
      return;
    }
    console.log(`주소 : ${address}`);
    setIsLoading(true);
    clearAllData(); // 기존 마커/데이터 삭제 로직 호출
    if (infoWindowRef.current) infoWindowRef.current.close();
    activeMarkerRef.current = null;

    // 브이월드 에러 방지용 750m 제한
    const analysisRadius = Math.min(radius, 750);
    const bbox = calculateBBox(coords.lat, coords.lng, radius);
    const [minLat, minLng, maxLat, maxLng] = bbox.split(',').map(Number);

    try {
      // 1. API 동시 호출
      const [distRes, landRes, shopRes, closedRes, popRes] = await Promise.all([
        fetch(`${API_BASE_URL}/market/major-districts?lat=${coords.lat}&lng=${coords.lng}&radius=${radius}`),
        fetch(`${API_BASE_URL}/real-estate/land-price?bbox=${bbox}`),
        fetch(`${API_BASE_URL}/market/search?lat=${coords.lat}&lng=${coords.lng}&radius=${radius}&smallCat=${encodeURIComponent(selectedSmall)}`),
        fetch(`${API_BASE_URL}/analysis/closed-blocks?minLat=${minLat}&maxLat=${maxLat}&minLng=${minLng}&maxLng=${maxLng}&radius=${analysisRadius}`),
        fetch(`${API_BASE_URL}/analysis/population?address=${address}`)

      ]);

      // 2. 주요 상권 데이터 처리
      const distData = await distRes.json();
      displayMajorDistricts(distData);

      // 3. 실거래가 & 공시지가 처리
      await fetchRealEstateData(coords.lat, coords.lng, radius);
      const landData = await landRes.json();
      landDataRef.current = landData;
      displayLandPriceMarkers(landData);

      // 4. 상가 마커 및 그룹화 로직
      const shopData = await shopRes.json();
      if (shopData && shopData.length > 0) {
        const storeGroups = new Map<string, any[]>();
        shopData.forEach((shop: any) => {
          const key = `${shop.lat},${shop.lon}`;
          if (!storeGroups.has(key)) storeGroups.set(key, []);
          storeGroups.get(key)?.push(shop);
        });

        markersRef.current = [];
        storeGroups.forEach((shops, key) => {
          const [lat, lon] = key.split(',').map(Number);
          const marker = new kakao.maps.Marker({
            position: new kakao.maps.LatLng(lat, lon),
            map: showShops ? mapInstance.current : null,
            zIndex: 1
          });

          kakao.maps.event.addListener(marker, 'click', () => {
            let content = '';
            if (shops.length === 1) {
              const shop = shops[0];
              content = `<div style="padding:15px; min-width:150px;">
                <strong style="font-size:11px;">${shop.store_name}</strong><br/>
                <span style="font-size:12px; color:#666;">${shop.category_small_name}</span>
              </div>`;
            } else {
              const listHtml = shops.map((s, index) => 
                `<li style="padding: 6px 0; border-bottom: ${index === shops.length - 1 ? 'none' : '1px solid #eee'};">
                  <div style="font-weight:bold; font-size:13px; color:#333;">${s.store_name}</div>
                  <div style="font-size:11px; color:#888;">${s.category_small_name}</div>
                </li>`
              ).join('');
              content = `<div style="padding:15px; min-width:220px; max-height:250px; overflow-y:auto;">
                <div style="margin-bottom:8px; font-weight:bold; border-bottom:2px solid #3b82f6; padding-bottom:6px;">🏢 이 건물의 상가 (${shops.length})</div>
                <ul style="list-style:none; padding:0; margin:0;">${listHtml}</ul>
              </div>`;
            }
            handleMarkerInteraction(marker, content);
          });
          markersRef.current.push(marker);
        });
      }

      // 5. 폐업/활력도 (블록 데이터) 가공
      const closedData = await closedRes.json();
      // closedData가 { allFeatures, statusCountMap } 구조이거나 배열인 경우에 대응
      const features = Array.isArray(closedData) ? closedData : (closedData.allFeatures || []);
      
      if (features.length > 0) {
        drawClosedBlocks(features);
      }

      // 추천 페이지에서 사용할 블록 데이터 생성
      const processedBlocks = features.map((feature: any) => {
          const paths = feature.geometry.type === 'Polygon' 
              ? feature.geometry.coordinates[0] 
              : feature.geometry.coordinates[0][0];
          
          let latSum = 0, lngSum = 0;
          paths.forEach((p: any) => { 
            lngSum += p[0]; // GeoJSON은 [lng, lat] 순서
            latSum += p[1]; 
          });
          
          const center = { lat: latSum / paths.length, lng: lngSum / paths.length };

          return {
              id: feature.properties.pnu || feature.id,
              jibun: feature.properties.jibun,
              geometry: feature.geometry,
              center: center,
              properties: {
                activeCount: feature.properties.activeCount || 0,
                closedCount: feature.properties.closedCount || 0,
                vitality: feature.properties.vitality || 0
              }
          };
      });
      const popData = await popRes.json();
      console.log("pop res : ");
      console.log(popData);

      // 인구 통계: 연령대별 인구를 이용해 대략적인 평균 연령 계산
      const ageBuckets = popData?.data || {};
      const ageGroups = [
        { key: 'age_eq_10', mid: 15 },
        { key: 'age_eq_20', mid: 25 },
        { key: 'age_eq_30', mid: 35 },
        { key: 'age_eq_40', mid: 45 },
        { key: 'age_eq_50', mid: 55 },
        { key: 'age_eq_60', mid: 65 },
        { key: 'age_gte_70', mid: 75 },
      ];
      let ageWeightedSum = 0;
      let ageTotalCount = 0;
      ageGroups.forEach(({ key, mid }) => {
        const cnt = Number(ageBuckets[key] || 0);
        if (cnt > 0) {
          ageWeightedSum += cnt * mid;
          ageTotalCount += cnt;
        }
      });
      const averageAge =
        ageTotalCount > 0 ? Math.round(ageWeightedSum / ageTotalCount) : null;

      const populationSummary = {
        averageAge,
        totalPopulation: Number(popData?.total_sum || 0),
      };

      // 신규 / 폐업 블록 요약
      const blockSummary =
        Array.isArray(features) && features.length > 0
          ? (() => {
              let totalActive = 0;
              let totalClosed = 0;
              let vitalitySum = 0;
              let vitalityCount = 0;

              features.forEach((f: any) => {
                const props = f.properties || {};
                const a = Number(props.activeCount || 0);
                const c = Number(props.closedCount || 0);
                const v = props.vitality;

                totalActive += a;
                totalClosed += c;
                if (typeof v === 'number') {
                  vitalitySum += v;
                  vitalityCount += 1;
                }
              });

              return {
                totalActive,
                totalClosed,
                averageVitality:
                  vitalityCount > 0
                    ? Number((vitalitySum / vitalityCount).toFixed(2))
                    : 0,
              };
            })()
          : null;

      // 방향/거리 기반 상가 요약
      const spatialShops = summarizeShopsByDirection(
        shopData,
        coords.lat,
        coords.lng,
        radius
      );

      // ★ 6. Zustand 스토어에 데이터 업데이트
      setAnalysisResult({
          coords: { lat: coords.lat, lng: coords.lng },
          radius: radius,
          address: address, // 현재 AnalysisPage의 주소 state
          selectedCategory: {
              large: selectedLarge, // 현재 AnalysisPage의 대분류 state
              mid: selectedMid,     // 현재 AnalysisPage의 중분류 state
              small: selectedSmall   // 현재 AnalysisPage의 소분류 state
          },
          shops: shopData,
          closedShops: features,
          landPrices: landData,
          majorDistricts: distData,
          blocks: processedBlocks,
          population: populationSummary,
      });
      
      console.log("✅ 데이터가 Store에 저장되었습니다.");
      
      // 후속 작업
      fetchSupportPrograms();
      generateAIReport({
        population: populationSummary,
        spatialShops,
        blockSummary,
        blocks: processedBlocks,
      });
      setShowDashboard(true);

    } catch (err) {
      console.error("분석 중 오류 발생:", err);
      alert("데이터 분석 중 오류가 발생했습니다. 다시 시도해 주세요.");
    } finally {
      setIsLoading(false);
    }
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
              // 리포트/그래프용으로 최근 실거래 요약을 전역 스토어에 저장
              try {
                const summarized = (Array.isArray(rawData) ? rawData : [])
                  .slice(0, 100) // 최대 100건만 사용
                  .map((item: any) => ({
                    dealAmount: item.dealAmount,
                    dealYear: item.dealYear,
                    dealMonth: item.dealMonth,
                    dealDay: item.dealDay,
                    jibun: item.jibun,
                  }));
                setAnalysisResult({ recentTrades: summarized });
              } catch (e) {
                console.error('recentTrades 요약 중 오류:', e);
              }

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
  const displayMajorDistricts = (districts: any[]) => {
    const { kakao } = window;
    if (!Array.isArray(districts)) return;

    // 기존 폴리곤 및 오버레이 제거
    districtPolygonsRef.current.forEach(p => p.setMap(null));
    districtPolygonsRef.current = [];
    
    // 이름 표시용 오버레이 객체 (하나만 생성해서 재활용)
    const nameOverlay = new kakao.maps.CustomOverlay({
      zIndex: 3,
      xAnchor: 0.5,
      yAnchor: 1.5
    });

    districts.forEach(dist => {
      const path = dist.path.map((p: any) => new kakao.maps.LatLng(p.lat, p.lng));

      // 1. 다각형 생성 및 zIndex 설정
      const polygon = new kakao.maps.Polygon({
        path: path,
        strokeWeight: 2,
        strokeColor: '#f97316',
        strokeOpacity: 0.8,
        fillColor: '#fb923c',
        fillOpacity: 0.3,
        zIndex: 1 // 가장 낮은 숫자로 설정하여 마커(기본 zIndex 높음) 아래로 배치
      });

      // 2. 마우스 호버(mouseover) 이벤트: 이름 표시
      kakao.maps.event.addListener(polygon, 'mouseover', function(mouseEvent: any) {
        polygon.setOptions({ fillOpacity: 0.7 }); // 호버 시 강조 효과

        const content = `
          <div style="
            padding: 5px 10px; 
            background: rgba(0, 0, 0, 0.8); 
            color: #fff; 
            border-radius: 5px; 
            font-size: 12px; 
            pointer-events: none; /* 핵심: 마우스 이벤트를 통과시킴 */
            user-select: none;
            white-space: nowrap;
            border: 1px solid rgba(255, 255, 255, 0.2);
            box-shadow: 0 2px 4px rgba(0,0,0,0.3);
          ">
            ${dist.name}
          </div>`;
        
        nameOverlay.setContent(content);
        nameOverlay.setPosition(mouseEvent.latLng);
        nameOverlay.setMap(mapInstance.current);
      });
      (polygon as any).name = dist.name;
      // 3. 마우스 이동(mousemove) 이벤트: 이름표가 마우스를 따라다니게 함
      kakao.maps.event.addListener(polygon, 'mousemove', function(mouseEvent: any) {
        nameOverlay.setPosition(mouseEvent.latLng);
      });

      // 4. 마우스 아웃(mouseout) 이벤트: 이름 제거
      kakao.maps.event.addListener(polygon, 'mouseout', function() {
        polygon.setOptions({ fillOpacity: 0.3 }); // 원래 투명도로 복구
        nameOverlay.setMap(null);
      });

      // 현재 토글 상태(showDistricts)에 따라 표시 여부 결정
      polygon.setMap(showDistricts ? mapInstance.current : null);
      districtPolygonsRef.current.push(polygon);
    });
  };

  const calculateLandPriceStats = () => {
    // 1. 유효한 데이터만 필터링 (지가가 0보다 큰 데이터만)
    const data = landDataRef.current.filter(item => item && item.jiga > 0);
    
    if (!data || data.length === 0) {
        console.warn("⚠️ 계산할 지가 데이터가 없습니다.");
        return { midAvg: 0, highAvg: 0 };
    }

    // 2. 가격 내림차순 정렬 (높은 가격이 위로)
    const sorted = [...data].sort((a, b) => b.jiga - a.jiga);
    const total = sorted.length;

    // 3. 그룹 분리 (데이터가 적을 경우 최소 1개는 포함되도록 처리)
    const highCount = Math.max(1, Math.floor(total / 3));
    const midCount = Math.max(1, Math.floor(total / 3));

    const highGroup = sorted.slice(0, highCount);
    const midGroup = sorted.slice(highCount, highCount + midCount);

    // 4. 평균 계산 함수 (단위: 만원/㎡)
    const getAvg = (arr: any[]) => {
        if (!arr || arr.length === 0) return 0;
        const sum = arr.reduce((acc, cur) => acc + Number(cur.jiga), 0);
        return Math.round(sum / arr.length / 10000); // 마지막에 만원 단위 변환
    };

    const stats = { 
        midAvg: getAvg(midGroup), 
        highAvg: getAvg(highGroup) 
    };

    console.log(`📊 지가 통계 계산 완료 (총 ${total}건):`, stats);
    return stats;
  };

  // 상가 데이터의 방향/거리 요약
  const summarizeShopsByDirection = (
    shops: any[],
    centerLat: number,
    centerLng: number,
    maxRadius: number
  ) => {
    if (!Array.isArray(shops) || shops.length === 0) return [];

    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dirLabels = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'];

    const buckets: Record<
      string,
      { direction: string; count: number; totalDistance: number }
    > = {};

    shops.forEach((shop) => {
      const lat = Number(shop.lat);
      const lng = Number(shop.lon ?? shop.lng);
      if (!lat || !lng) return;

      const dLat = (lat - centerLat) * 111000;
      const dLng =
        (lng - centerLng) * 111000 * Math.cos(toRad(centerLat));
      const dist = Math.sqrt(dLat * dLat + dLng * dLng);

      if (maxRadius > 0 && dist > maxRadius) return;

      const angle = (Math.atan2(dLng, dLat) * 180) / Math.PI; // 0도 = 북
      const idx = Math.round(((angle + 360) % 360) / 45) % 8;
      const key = dirLabels[idx];

      if (!buckets[key]) {
        buckets[key] = { direction: key, count: 0, totalDistance: 0 };
      }
      buckets[key].count += 1;
      buckets[key].totalDistance += dist;
    });

    return Object.values(buckets).map((b) => ({
      direction: b.direction,
      count: b.count,
      avgDistance: b.count > 0 ? Math.round(b.totalDistance / b.count) : 0,
    }));
  };

  const generateAIReport = async (options?: {
    population?: { averageAge: number | null; totalPopulation: number };
    spatialShops?: { direction: string; count: number; avgDistance: number }[];
    blockSummary?: {
      totalActive: number;
      totalClosed: number;
      averageVitality: number;
    } | null;
    blocks?: any[];
  }) => {
    if (!selectedSmall || radius === 0) return;
    
    setIsReportLoading(true);
    const { kakao } = window;
    const center = new kakao.maps.LatLng(coords.lat, coords.lng);
    const { midAvg, highAvg } = calculateLandPriceStats();
    const population = options?.population;
    const spatialShops = options?.spatialShops || [];
    const blockSummary = options?.blockSummary || null;
    const blocksForVitality = options?.blocks || [];

    // 1. 거리 및 통계 계산 헬퍼 함수
    const getDistanceStats = (markers: any[], isLngLat = false) => {
      const validData = markers
        .map(m => {
          const pos = isLngLat 
            ? new kakao.maps.LatLng(m.lat, m.lon || m.lng) 
            : m.getPosition();
          const dist = new kakao.maps.Polyline({ path: [center, pos] }).getLength();
          return dist;
        })
        .filter(d => d <= radius);

      return {
        count: validData.length,
        avgDistance: validData.length > 0 
          ? Math.round(validData.reduce((a, b) => a + b, 0) / validData.length) 
          : 0
      };
    };

    // 2. 각 항목별 데이터 가공
    // (1) 선택 업종 상가 데이터 (현재 지도에 표시된 markersRef 기준)
    const shopStats = getDistanceStats(markersRef.current);

    // (2) 실거래 데이터 (estateMarkersRef 기준)
    const tradeStats = getDistanceStats(estateMarkersRef.current);
    const tradeDetails = estateMarkersRef.current
      .map(m => m.data)
      .filter(d => d !== undefined)
      .slice(0, 5);

    // (3) 신규/폐업 상권 활력도: 블록 데이터(신규/폐업) 기준으로 다시 계산
    const computeVitalityFromBlocks = () => {
      if (!Array.isArray(blocksForVitality) || blocksForVitality.length === 0) {
        return null;
      }

      const toRad = (deg: number) => (deg * Math.PI) / 180;
      const latRad = toRad(coords.lat);

      let totalNew = 0;
      let totalClosed = 0;
      let sumNewDist = 0;
      let sumClosedDist = 0;

      blocksForVitality.forEach((b: any) => {
        const a = Number(b?.properties?.activeCount || 0);
        const c = Number(b?.properties?.closedCount || 0);
        const clat = Number(b?.center?.lat);
        const clng = Number(b?.center?.lng);
        if (!clat || !clng) return;

        const dLat = (clat - coords.lat) * 111000;
        const dLng = (clng - coords.lng) * 111000 * Math.cos(latRad);
        const dist = Math.sqrt(dLat * dLat + dLng * dLng);
        if (dist > radius) return;

        if (a > 0) {
          totalNew += a;
          sumNewDist += a * dist;
        }
        if (c > 0) {
          totalClosed += c;
          sumClosedDist += c * dist;
        }
      });

      return {
        newStats: {
          count: totalNew,
          avgDistance:
            totalNew > 0 ? Math.round(sumNewDist / totalNew) : 0,
        },
        closedStats: {
          count: totalClosed,
          avgDistance:
            totalClosed > 0 ? Math.round(sumClosedDist / totalClosed) : 0,
        },
      };
    };

    const vitalityFromBlocks = computeVitalityFromBlocks();

    // (4) 폐업 데이터 (블록 기반이 우선, 없으면 마커 기반)
    const closedStats = vitalityFromBlocks
      ? vitalityFromBlocks.closedStats
      : getDistanceStats(closedMarkersRef.current);

    const districtNames = districtPolygonsRef.current
      .map(p => p.name)
      .filter(name => typeof name === 'string');

    try {
      const response = await fetch(`${API_BASE_URL}/analysis/report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          smallCat: selectedSmall,
          radius: radius,
          districts: districtNames,
          landPriceStats: { midAvg, highAvg },
          // 고도화된 밀집도 및 거리 데이터
          // 신규 상가는 gov_permit 기반 블록(activeCount)의 합계를 우선 사용
          shops: vitalityFromBlocks
            ? {
                totalCount: vitalityFromBlocks.newStats.count,
                averageDistance: vitalityFromBlocks.newStats.avgDistance,
              }
            : {
                totalCount: shopStats.count,
                averageDistance: shopStats.avgDistance
              },
          trades: {
            totalCount: tradeStats.count,
            averageDistance: tradeStats.avgDistance,
            items: tradeDetails
          },
          closures: {
            totalCount: closedStats.count,
            averageDistance: closedStats.avgDistance
          },
          address: address,
          population,
          spatialShops,
          blockSummary,
        })
      });

      const data = await response.json();
      if (data.report) {
        setAnalysisResult({ aiReport: data.report });
      }
      
    } catch (err) {
      console.error("AI Report Error:", err);
    } finally {
      setIsReportLoading(false);
    }
  };

  // 폐업 데이터 가져오기 및 마커 표시
  /*const fetchClosureData = async () => {
    const { kakao } = window;
    try {
      const res = await fetch(
      `${API_BASE_URL}/analysis/closure-data?smallCategory=${encodeURIComponent(selectedSmall)}&address=${address}`
    );
    const result = await res.json();
      
      if (!result.data || !Array.isArray(result.data)) return;

      // 기존 마커 제거
      closedMarkersRef.current.forEach(m => m.setMap(null));
      closedMarkersRef.current = [];

      const center = new kakao.maps.LatLng(coords.lat, coords.lng);

      const newMarkers = result.data.map((shop: any) => {
        if (!shop.lat || !shop.lng) return null;

        const shopPos = new kakao.maps.LatLng(shop.lat, shop.lng);
        
        // [중요] 프론트엔드 반경 필터링: 선택한 원 안에 있는 데이터만 표시
        const polyline = new kakao.maps.Polyline({
          path: [center, shopPos]
        });
        if (polyline.getLength() > radius) return null;

        const marker = new kakao.maps.Marker({
          position: shopPos,
          map: showClosed ? mapInstance.current : null,
          // 폐업임을 알리기 위해 회색 계열 마커 이미지 사용
          image: new kakao.maps.MarkerImage(
            '../../public/x.png', 
            new kakao.maps.Size(16, 16)
          )
        });

        kakao.maps.event.addListener(marker, 'click', () => {
          // 백엔드 응답 필드명(closeDate, address 등)에 맞게 구성
          const content = `
            <div style="padding:15px; min-width:180px;">
              <div style="margin-bottom:8px; border-bottom:1px solid #eee; padding-bottom:5px;">
                <span style="background:#64748b; color:white; padding:2px 6px; border-radius:4px; font-size:10px; margin-right:5px;">폐업</span>
                <strong style="font-size:13px;">${shop.name}</strong>
              </div>
              <div style="font-size:11px; color:#475569; line-height:1.5;">
                <b>폐업일:</b> ${shop.closeDate || '정보 없음'}<br/>
                <b>주소:</b> ${shop.address || '정보 없음'}
              </div>
            </div>`;
          handleMarkerInteraction(marker, content);
        });
        return marker;
      }).filter((m: any) => m !== null);

      closedMarkersRef.current = newMarkers;
      console.log(`✅ 반경 내 폐업 마커 ${newMarkers.length}개 표시 완료`);
    } catch (err) {
      console.error("폐업 데이터 로드 실패:", err);
    }
  };*/

  const updateAddress = (lat: number, lng: number) => {
    const { kakao } = window;
    const geocoder = new kakao.maps.services.Geocoder();
    
    geocoder.coord2Address(lng, lat, (result: any, status: any) => {
      if (status === kakao.maps.services.Status.OK) {
        console.log(`updateAddress 내부 address 결과 : `);
        console.log(result[0].road_address);
        console.log(result[0].address);
        setAddress(result[0].road_address?.address_name || result[0].address.address_name);
        setCoords({ lat, lng });
      }
    });
  };


  const handleAutoSelect = async (hierarchy: { large: string; mid: string; small: string }) => {
    try {
      console.log("AI 매칭 결과:", hierarchy);

      // 1. 대분류 상태 변경
      setSelectedLarge(hierarchy.large);

      // 2. 중분류 리스트 가져오기 (대분류 이름을 파라미터로 전달)
      // 백엔드: /api/categories/mid/:largeName
      const midRes = await fetch(`${API_BASE_URL}/categories/mid/${encodeURIComponent(hierarchy.large)}`);
      const midData = await midRes.json();
      setMidCats(midData); // 리스트 업데이트
      setSelectedMid(hierarchy.mid); // 값 선택

      // 3. 소분류 리스트 가져오기 (중분류 이름을 파라미터로 전달)
      // 백엔드: /api/categories/small/:midName
      const smallRes = await fetch(`${API_BASE_URL}/categories/small/${encodeURIComponent(hierarchy.mid)}`);
      const smallData = await smallRes.json();
      setSmallCats(smallData); // 리스트 업데이트
      setSelectedSmall(hierarchy.small); // 최종 소분류 선택

      console.log(`✅ ${hierarchy.small} 자동 세팅 완료`);
      console.log('데이터 불러오기');
      const res = await fetch(`${API_BASE_URL}/asy`);
      console.log(res);
    } catch (err) {
      console.error("분류 자동 선택 중 오류:", err);
    }
  };
  


  // 프론트엔드 함수
  const fetchSupportPrograms = async () => {
    setIsSupportLoading(true);
    // 현재 지도 중심의 주소에서 '지역명' (예: 부산, 서울) 추출 로직 필요
    // 간단하게 address state의 첫 단어를 사용하거나, '부산'으로 고정 테스트
    const currentRegion = address.split(" ")[0].substring(0,2) || "부산"; 
    
    try {
        const response = await fetch(`${API_BASE_URL}/get-support?region=${currentRegion}&category=소상공인`);
        const data = await response.json();
        
        if (Array.isArray(data)) {
            setSupportPrograms(data);
        }
    } catch (error) {
        console.error("지원사업 조회 실패:", error);
    } finally {
        setIsSupportLoading(false);
    }
  };

  // [AnalysisPage.tsx] drawClosedBlocks 수정

  const drawClosedBlocks = (blocks: any[]) => {
    const { kakao } = window;
    if (closedPolygonsRef.current) {
        closedPolygonsRef.current.forEach(p => p.setMap(null));
    }
    closedPolygonsRef.current = [];

    blocks.forEach(block => {
        const { activeCount, closedCount, vitality } = block.properties;
        //if (activeCount === 0 && closedCount === 0) return;

        // 색상 로직: 영업 우위(Blue), 폐업 우위(Red)
        // 진하기: 전체 데이터 양(active + closed)에 비례
        const total = activeCount + closedCount;
        const baseOpacity = (vitality == 0) ? 0.6 : Math.min(total * 0.1, 0.6); // 데이터가 많을수록 진함
        
        let fillColor = "#888888"; // 기본 회색
        if (vitality > 0) fillColor = "#3B82F6"; // 영업 우위 (파랑)
        else if (vitality < 0) fillColor = "#EF4444"; // 폐업 우위 (빨강)

        const geometry = block.geometry;
        const paths = geometry.type === 'Polygon' 
            ? [geometry.coordinates[0].map((c: any) => new kakao.maps.LatLng(c[1], c[0]))]
            : geometry.coordinates.map((p: any) => p[0].map((c: any) => new kakao.maps.LatLng(c[1], c[0])));

        paths.forEach((path: any) => {
            const polygon = new kakao.maps.Polygon({
                path,
                strokeWeight: 1,
                strokeColor: fillColor,
                strokeOpacity: 0.7,
                fillColor: fillColor,
                fillOpacity: baseOpacity,
                zIndex: 10
            });

            polygon.setMap(showClosed ? mapInstance.current : null);
            // 클릭 시 정보 창
            kakao.maps.event.addListener(polygon, 'click', (mouseEvent: any) => {
                const jibunLabel = block.jibun || (block.properties && block.properties.jibun) || '';
                const content = `
                    <div style="padding:4px 2px; font-size:12px; line-height:1.45;">
                        <div style="font-weight:bold; margin-bottom:5px;">${jibunLabel}</div>
                        <div style="color:#2563EB;">✔ 영업 중: ${activeCount}곳</div>
                        <div style="color:#DC2626;">✖ 폐업 완료: ${closedCount}곳</div>
                        <div style="margin-top:5px; padding-top:5px; border-top:1px dashed #eee; font-size:11px; color:#666;">
                            상태: ${vitality > 0 ? '상권 확장 중' : vitality < 0 ? '상권 위축 중' : '보합'}
                        </div>
                    </div>
                `;
                if (infoWindowRef.current) {
                    infoWindowRef.current.setContent(content);
                    infoWindowRef.current.setPosition(mouseEvent.latLng);
                    infoWindowRef.current.open(mapInstance.current);
                }
            });

            closedPolygonsRef.current.push(polygon);
        });
    });
  };

  const handleLocationSelect = (lat: number, lng: number, addressName: string) => {
    const { kakao } = window;
    if (!mapInstance.current) return;

    const moveLatLng = new kakao.maps.LatLng(lat, lng);

    // 1. 지도 이동
    mapInstance.current.panTo(moveLatLng);
    
    // 2. 상태 업데이트
    setCoords({ lat, lng });
    setAddress(addressName);
    setRadius(0); // 반경 초기화 (원한다면 유지 가능)

    // 3. 기존 데이터 및 마커 제거
    clearAllData();
    if (currentCircle.current) currentCircle.current.setMap(null);
    if (infoWindowRef.current) infoWindowRef.current.close();

    // 4. 빨간색 마커 표시 (현재 선택 위치 강조)
    if (currentMarker.current) currentMarker.current.setMap(null);
    currentMarker.current = new kakao.maps.Marker({
      position: moveLatLng,
      map: mapInstance.current,
      image: new kakao.maps.MarkerImage(
        'https://t1.daumcdn.net/localimg/localimages/07/mapapidoc/marker_red.png', 
        new kakao.maps.Size(32, 34)
      )
    });
    
    // 5. (선택사항) 중심점에 원 미리 생성
    currentCircle.current = new kakao.maps.Circle({
      center: moveLatLng,
      radius: 0,
      strokeWeight: 2,
      strokeColor: '#2563eb',
      strokeOpacity: 0.8,
      fillColor: '#3b82f6',
      fillOpacity: 0.2,
      map: mapInstance.current
    });

    // 행정동 코드 등 업데이트 (기존 updateAddress 로직 활용 권장)
    updateAddress(lat, lng); 
  };
  
  // ... (기타 토글 함수들)
  const toggleLandPrice = () => {
    const n = !showLandPrice;
    setShowLandPrice(n);
    showLandPriceRef.current = n;
    if (n) {
      rebuildLandPriceOverlaysRef.current();
    } else {
      landPriceOverlaysRef.current.forEach((o) => o.setMap(null));
    }
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
  const togglePrincipal = () => {
    const n = !showDistricts;
    setShowDistricts(n);
    if (districtPolygonsRef.current) {
      districtPolygonsRef.current.forEach((polygon: any) => {
        polygon.setMap(n ? mapInstance.current : null);
      });
    }
  }

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

  const toggleClosed = () => {
    setShowClosed(prev => !prev);
  };
  useEffect(() => {
    if (closedPolygonsRef.current) {
      closedPolygonsRef.current.forEach(polygon => {
        // 현재 버튼이 켜져있으면 지도에 표시, 꺼져있으면 null로 숨김
        polygon.setMap(showClosed ? mapInstance.current : null);
      });
    }
  }, [showClosed]);

  // 저장된 중심 좌표/반경이 있을 경우, 재진입 시 원과 마커를 다시 표시
  useEffect(() => {
    const { kakao } = window as any;
    if (!kakao || !mapInstance.current) return;
    if (!coords || radius === 0) return;

    const center = new kakao.maps.LatLng(coords.lat, coords.lng);

    // 중심 마커: 기존 것 제거 후 새로 생성 (기존 Kakao 객체 메서드 의존 최소화)
    if (currentMarker.current) {
      currentMarker.current.setMap(null);
    }
    currentMarker.current = new kakao.maps.Marker({
      position: center,
      map: mapInstance.current,
      image: new kakao.maps.MarkerImage(
        'https://t1.daumcdn.net/localimg/localimages/07/mapapidoc/marker_red.png',
        new kakao.maps.Size(32, 34)
      ),
    });

    // 분석 반경 원: 기존 것 제거 후 새로 생성 (setCenter 같은 미지원 메서드 사용 지양)
    if (currentCircle.current) {
      currentCircle.current.setMap(null);
    }
    currentCircle.current = new kakao.maps.Circle({
      center,
      radius,
      strokeWeight: 2,
      strokeColor: '#2563eb',
      strokeOpacity: 0.8,
      fillColor: '#3b82f6',
      fillOpacity: 0.2,
      map: mapInstance.current,
    });
  }, [coords, radius]);

  useEffect(() => {
    const { kakao } = window;
    if (kakao) kakao.maps.load(() => {});
    window.addEventListener('contextmenu', (e) => e.preventDefault());
  }, []);

  return (
    <div className="relative flex h-full w-full overflow-hidden bg-white text-slate-900">
      {showPrompt && (
        <div className="absolute inset-0 z-100 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm">
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
        onAutoSelect={handleAutoSelect}
        onLocationSelect={handleLocationSelect}
      />
      

      <section className="flex-1 relative overflow-hidden">
        <div ref={mapContainer} className="absolute inset-0 w-full h-full" />
        <AnalysisDashboard 
          isOpen={showDashboard} 
          onClose={() => setShowDashboard(false)}
          address={address}
          radius={radius}
          aiReport={aiReport}      
          isReportLoading={isReportLoading}
          supportPrograms={supportPrograms}
          isSupportLoading={isSupportLoading}
        />
        <MapControls
          showLandPrice={showLandPrice}
          showShops={showShops}
          showTrades={showTrades}
          showDashboard={showDashboard}
          showPrincipalCommercialZone={showDistricts}
          showClosed={showClosed}
          toggleLandPrice={toggleLandPrice}
          toggleShops={toggleShops}
          toggleTrades={toggleTrades}
          toggleDashboard={() => setShowDashboard(!showDashboard)}
          togglePrincipalCommercialZone={togglePrincipal}
          toggleClosed={toggleClosed}
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