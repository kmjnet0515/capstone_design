import { useEffect, useState, useRef, useMemo } from 'react';
import { useAnalysisStore } from '../store/useAnalysisStore';
import { 
  Trophy, TrendingUp, TrendingDown, AlertCircle, 
  CheckCircle2, BarChart3, Info, MapPin, Building2 
} from 'lucide-react';

const RecommendationPage = () => {
  // 1. 스토어에서 데이터 가져오기 (비구조화 할당)
  const { coords, radius, address, selectedCategory, blocks } = useAnalysisStore();
  
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<any>(null);
  const selectedPolygonRef = useRef<any>(null); 
  
  const [candidates, setCandidates] = useState<any[]>([]);
  const [selectedBlock, setSelectedBlock] = useState<any>(null);

  // 2. 지도 초기화 (coords가 바뀔 때 실행)
  useEffect(() => {
    const { kakao } = window;
    if (!mapContainer.current || !kakao) return;

    // 지도가 없으면 생성, 있으면 중심 이동
    if (!mapInstance.current) {
      mapInstance.current = new kakao.maps.Map(mapContainer.current, {
        center: new kakao.maps.LatLng(coords.lat, coords.lng),
        level: 3,
      });
    } else {
      mapInstance.current.setCenter(new kakao.maps.LatLng(coords.lat, coords.lng));
    }
  }, [coords]);

  // 3. 추천 알고리즘 및 점수 산정
  useEffect(() => {
    if (!blocks || blocks.length === 0) return;

    // 점수 산정 로직
    const ranked = [...blocks].map(block => {
      const active = block.properties?.activeCount || 0;
      const closed = block.properties?.closedCount || 0;
      const vitalityRaw = block.properties?.vitality || 0;
      
      // 세부 점수 계산
      const vitalityScore = Math.round((vitalityRaw + 1) * 40); // 활력 점수 (최대 80)
      const densityScore = Math.min(active * 5, 20);           // 밀집도 점수 (최대 20)
      const totalScore = vitalityScore + densityScore;

      return { 
        ...block, 
        totalScore,
        analysis: {
          vitalityScore,
          densityScore,
          active,
          closed,
          // 다른 지역 대비 강점 텍스트 생성
          reasons: generateReasons(active, closed, vitalityRaw)
        }
      };
    })
    .sort((a, b) => b.totalScore - a.totalScore)
    .slice(0, 10); // TOP 10

    setCandidates(ranked);
  }, [blocks]);

  // 사유 생성 헬퍼 함수
  const generateReasons = (active: number, closed: number, vitality: number) => {
    const res = [];
    if (vitality > 0.3) res.push("폐업 대비 신규 개업이 활발한 성장형 상권입니다.");
    if (closed === 0 && active > 0) res.push("최근 5년간 폐업 사례가 없어 업종 유지력이 매우 뛰어납니다.");
    if (active > 10) res.push("동일 업종 밀집도가 높아 집객 효과가 우수한 입지입니다.");
    if (res.length === 0) res.push("상권 변동성이 낮아 안정적인 운영이 가능한 구역입니다.");
    return res;
  };

  // 4. 블록 클릭 핸들러
  const handleBlockClick = (block: any) => {
    const { kakao } = window;
    if (!kakao || !mapInstance.current) return;
    
    setSelectedBlock(block);

    // 이전 폴리곤 지우기
    if (selectedPolygonRef.current) {
      selectedPolygonRef.current.setMap(null);
    }

    // 지도 중심 이동
    const moveLatLon = new kakao.maps.LatLng(block.center.lat, block.center.lng);
    mapInstance.current.panTo(moveLatLon);

    // 폴리곤 그리기
    const rawPaths = block.geometry.type === 'Polygon' 
      ? block.geometry.coordinates[0] 
      : block.geometry.coordinates[0][0];
    
    const path = rawPaths.map((p: any) => new kakao.maps.LatLng(p[1], p[0]));

    const polygon = new kakao.maps.Polygon({
      path: path,
      strokeWeight: 4,
      strokeColor: '#2563EB',
      strokeOpacity: 1,
      fillColor: '#3B82F6',
      fillOpacity: 0.4
    });

    polygon.setMap(mapInstance.current);
    selectedPolygonRef.current = polygon;
  };

  // ★ 방어 코드: 데이터가 없을 때 흰 화면 대신 안내 메시지 표시
  if (!blocks || blocks.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-slate-50">
        <AlertCircle className="w-16 h-16 text-slate-200 mb-4" />
        <h2 className="text-xl font-bold text-slate-400">분석된 상권 데이터가 없습니다.</h2>
        <p className="text-slate-400 mt-2">상권 분석 페이지에서 '분석하기'를 먼저 완료해주세요.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full bg-[#f1f5f9] overflow-hidden">
      {/* 왼쪽: 순위 리스트 */}
      <div className="w-[380px] h-full bg-white border-r flex flex-col z-10 shadow-xl">
        <div className="p-6 border-b bg-white">
          <div className="flex items-center gap-2 mb-1">
            <Trophy className="text-yellow-500" size={20} />
            <h2 className="text-xl font-black text-slate-800">추천 입지 TOP 10</h2>
          </div>
          <p className="text-xs text-slate-400 font-bold uppercase tracking-tighter">
            {address || "선택된 지역"} • {selectedCategory.small || "전체 업종"}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/50">
          {candidates.map((item, idx) => (
            <div 
              key={item.id || idx}
              onClick={() => handleBlockClick(item)}
              className={`p-5 rounded-2xl cursor-pointer border transition-all duration-300 ${
                selectedBlock?.id === item.id 
                ? 'bg-blue-600 border-blue-600 text-white shadow-lg -translate-y-1' 
                : 'bg-white border-slate-200 hover:border-blue-300 text-slate-700'
              }`}
            >
              <div className="flex justify-between items-start mb-2">
                <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                    selectedBlock?.id === item.id ? 'bg-blue-400 text-white' : 'bg-slate-100 text-slate-500'
                }`}>
                    RANK {idx + 1}
                </span>
                <div className="text-right">
                    <span className="text-2xl font-black">{Math.round(item.totalScore)}</span>
                    <span className="text-[10px] opacity-60 ml-1">점</span>
                </div>
              </div>
              <h3 className="font-bold truncate">{item.jibun || "상세 주소 분석 중"}</h3>
              <div className="flex gap-3 mt-3 text-[11px] opacity-80">
                 <span>신규 {item.analysis.active}</span>
                 <span className="w-px h-3 bg-current opacity-20" />
                 <span>폐업 {item.analysis.closed}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 오른쪽: 지도 및 상세 분석 */}
      <div className="flex-1 relative flex flex-col">
        <div className="flex-1 relative">
            <div ref={mapContainer} className="w-full h-full" />
            
            {/* 선택 안 했을 때 안내 문구 */}
            {!selectedBlock && (
              <div className="absolute top-6 left-1/2 -translate-x-1/2 bg-white/90 backdrop-blur px-6 py-3 rounded-full shadow-md border border-slate-200 z-20 flex items-center gap-2">
                <Info size={16} className="text-blue-500" />
                <span className="text-sm font-bold text-slate-600">리스트에서 구역을 선택하여 상세 분석을 확인하세요.</span>
              </div>
            )}
        </div>

        {/* 하단 상세 분석 정보 (선택 시 슬라이드 업) */}
        {selectedBlock && (
            <div className="h-[320px] bg-white border-t p-8 flex gap-10 animate-in slide-in-from-bottom-full duration-500 z-20">
                {/* 점수 요약 */}
                <div className="w-[280px] shrink-0">
                    <div className="flex items-center gap-2 mb-6">
                        <BarChart3 className="text-blue-600" />
                        <h4 className="font-extrabold text-slate-800">입지 분석 지표</h4>
                    </div>
                    <div className="space-y-5">
                        <div>
                            <div className="flex justify-between text-xs font-bold mb-1.5 text-slate-500">
                                <span>상권 성장 활력</span>
                                <span>{selectedBlock.analysis.vitalityScore} / 80</span>
                            </div>
                            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                                <div className="h-full bg-blue-500 transition-all duration-1000" style={{ width: `${(selectedBlock.analysis.vitalityScore / 80) * 100}%` }} />
                            </div>
                        </div>
                        <div>
                            <div className="flex justify-between text-xs font-bold mb-1.5 text-slate-500">
                                <span>업종 밀집도</span>
                                <span>{selectedBlock.analysis.densityScore} / 20</span>
                            </div>
                            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                                <div className="h-full bg-indigo-500 transition-all duration-1000" style={{ width: `${(selectedBlock.analysis.densityScore / 20) * 100}%` }} />
                            </div>
                        </div>
                    </div>
                </div>

                {/* 상세 코멘트 */}
                <div className="flex-1">
                    <div className="flex items-center gap-2 mb-4 text-emerald-600">
                        <CheckCircle2 size={20} />
                        <h4 className="font-extrabold">이 구역이 선정된 이유</h4>
                    </div>
                    <div className="space-y-3">
                        {selectedBlock.analysis.reasons.map((reason: string, i: number) => (
                            <div key={i} className="flex items-center gap-3 bg-emerald-50/50 p-4 rounded-xl border border-emerald-100">
                                <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full" />
                                <p className="text-sm font-bold text-slate-700">{reason}</p>
                            </div>
                        ))}
                    </div>
                </div>

                {/* 추가 정보 */}
                <div className="w-[200px] flex flex-col justify-center border-l pl-10">
                    <div className="mb-4">
                        <p className="text-[10px] font-bold text-slate-400 mb-1">예상 추천도</p>
                        <p className="text-3xl font-black text-blue-600">
                            {selectedBlock.totalScore > 80 ? "S등급" : selectedBlock.totalScore > 60 ? "A등급" : "B등급"}
                        </p>
                    </div>
                    <button className="w-full py-3 bg-slate-900 text-white rounded-xl font-bold text-xs hover:bg-slate-800 transition-colors">
                        상세 보고서 보기
                    </button>
                </div>
            </div>
        )}
      </div>
    </div>
  );
};

export default RecommendationPage;