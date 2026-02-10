import { useEffect, useState, useRef } from 'react';
import { useAnalysisStore } from '../store/useAnalysisStore';
import { 
  Trophy, AlertCircle, 
  CheckCircle2, BarChart3, Info
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
const API_BASE_URL = "http://localhost:3000/api";

const RecommendationPage = () => {
  // 1. 스토어에서 데이터 가져오기 (비구조화 할당)
  const { coords, radius, address, selectedCategory, blocks } = useAnalysisStore();
  
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<any>(null);
  const selectedPolygonRef = useRef<any>(null); 
  
  const [candidates, setCandidates] = useState<any[]>([]);
  const [selectedBlock, setSelectedBlock] = useState<any>(null);
  const [recommendCount, setRecommendCount] = useState<number>(10);
  const [scenario, setScenario] = useState<'balanced' | 'safe' | 'growth'>('balanced');

  // 비교용 선택 블록 (최대 3개) - 후보 리스트의 인덱스로 관리
  const [compareIds, setCompareIds] = useState<number[]>([]);
  const [compareReport, setCompareReport] = useState<string>('');
  const [isCompareLoading, setIsCompareLoading] = useState(false);
  const [showComparePanel, setShowComparePanel] = useState(false);

  // 리포트 패널 토글 및 탭 상태
  const [showBlockPanel, setShowBlockPanel] = useState(true);
  const [activeReportTab, setActiveReportTab] = useState<'block' | 'compare'>('block');

  // 개별 블록 상세 리포트
  const [blockReport, setBlockReport] = useState<string>('');
  const [isBlockReportLoading, setIsBlockReportLoading] = useState(false);

  // 지번 주소 캐시 (center 좌표 -> 지번)
  const [jibunMap, setJibunMap] = useState<Record<string, string>>({});

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
      const totalAC = active + closed;
      const closureRatio = totalAC > 0 ? closed / totalAC : 0;

      // 기본 점수 계산
      const vitalityScore = Math.round((vitalityRaw + 1) * 40); // 활력 점수 (최대 80)
      const densityScore = Math.min(active * 5, 20);            // 밀집도 점수 (최대 20)

      // 시나리오별 최종 점수 가중치
      let totalScore = vitalityScore + densityScore; // balanced 기본값
      if (scenario === 'safe') {
        // 안정 우선: 폐업 비율 페널티를 크게, 활력 가중치는 완만하게
        totalScore = vitalityScore * 0.6 + densityScore * 0.2 - closureRatio * 80;
      } else if (scenario === 'growth') {
        // 성장 우선: 활력/밀집도에 더 큰 가중치, 폐업 리스크는 어느 정도 허용
        totalScore = vitalityScore * 1.0 + densityScore * 0.4 - closureRatio * 30;
      }

      // 상권 상태 태그
      let statusTag = '보합 상권';
      if (vitalityRaw > 0.2) statusTag = '성장형 상권';
      else if (vitalityRaw < -0.2) statusTag = '위축 상권';

      // 폐업 리스크 태그
      const closurePct = Math.round(closureRatio * 100);
      let riskTag = '폐업 리스크 낮음';
      if (closurePct >= 40) riskTag = '폐업 리스크 높음';
      else if (closurePct >= 20) riskTag = '폐업 리스크 보통';

      return { 
        ...block, 
        totalScore,
        analysis: {
          vitalityScore,
          densityScore,
          active,
          closed,
          closureRatio,
          closurePct,
          statusTag,
          riskTag,
          // 다른 지역 대비 강점 텍스트 생성
          reasons: generateReasons(active, closed, vitalityRaw)
        }
      };
    })
    .sort((a, b) => b.totalScore - a.totalScore)
    .slice(0, recommendCount); // TOP N (사용자 설정)

    setCandidates(ranked);
  }, [blocks, recommendCount, scenario]);

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

  // 추천 시나리오 버튼 핸들러
  const handleScenarioChange = (next: 'balanced' | 'safe' | 'growth') => {
    setScenario(next);
  };

  // 비교 선택 토글 (리스트 인덱스 기준)
  const toggleCompare = (index: number) => {
    if (index < 0) return;
    setCompareIds((prev) => {
      const exists = prev.includes(index);
      if (exists) {
        return prev.filter((id) => id !== index);
      }
      if (prev.length >= 3) {
        // 최대 3개까지만 허용
        return prev;
      }
      return [...prev, index];
    });
  };

  // 선택된 블록들로 비교 리포트 생성
  const handleGenerateCompareReport = async () => {
    if (compareIds.length < 2) {
      alert('비교할 구역을 두 개 이상 선택해주세요. (최대 3개)');
      return;
    }
    try {
      setIsCompareLoading(true);
      setCompareReport('');

      // 선택 순서(compareIds 순서)를 기준으로 블록 정리
      const selectedBlocks = compareIds
        .map((idx, order) => {
          const b = candidates[idx];
          if (!b) return null;

          const center = b.center;
          const key =
            center && typeof center.lat === 'number' && typeof center.lng === 'number'
              ? `${Math.round(center.lat * 1e6)},${Math.round(center.lng * 1e6)}`
              : null;
          const resolvedJibun = b.jibun || (key ? jibunMap[key] : null);

          return {
            label: `후보 ${order + 1}`,
            id: b.id,
            jibun: resolvedJibun,
            active: b.analysis.active,
            closed: b.analysis.closed,
            vitality: b.properties?.vitality ?? 0,
            totalScore: b.totalScore,
            closureRatio: b.analysis.closureRatio,
          };
        })
        .filter((b) => !!b);
      const response = await fetch(`${API_BASE_URL}/analysis/compare-blocks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address,
          radius,
          category: selectedCategory.small,
          blocks: selectedBlocks,
        }),
      });

      if (!response.ok) {
        console.error('Compare report response error:', response.status, response.statusText);
        setCompareReport('비교 리포트 생성 중 서버 오류가 발생했습니다.');
        return;
      }

      const data = await response.json();
      if (data.report) {
        setCompareReport(data.report);
      } else {
        setCompareReport('비교 리포트를 생성하지 못했습니다.');
      }
    } catch (err) {
      console.error('Compare report error:', err);
      setCompareReport('비교 리포트 생성 중 오류가 발생했습니다.');
    } finally {
      setIsCompareLoading(false);
    }
  };

  // 개별 블록 상세 리포트 생성
  const handleGenerateBlockReport = async () => {
    if (!selectedBlock) return;
    try {
      setIsBlockReportLoading(true);
      setBlockReport('');

      const response = await fetch(`${API_BASE_URL}/analysis/block-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address,
          radius,
          category: selectedCategory.small,
          block: {
            id: selectedBlock.id,
            jibun: selectedBlock.jibun,
            active: selectedBlock.analysis.active,
            closed: selectedBlock.analysis.closed,
            vitality: selectedBlock.properties?.vitality ?? 0,
            totalScore: selectedBlock.totalScore,
            closureRatio: selectedBlock.analysis.closureRatio,
          },
        }),
      });

      if (!response.ok) {
        console.error('Block report response error:', response.status, response.statusText);
        setBlockReport('상세 보고서 생성 중 서버 오류가 발생했습니다.');
        return;
      }

      const data = await response.json();
      if (data.report) {
        setBlockReport(data.report);
      } else {
        setBlockReport('상세 보고서를 생성하지 못했습니다.');
      }
    } catch (err) {
      console.error('Block report error:', err);
      setBlockReport('상세 보고서 생성 중 오류가 발생했습니다.');
    } finally {
      setIsBlockReportLoading(false);
    }
  };

  // 블록이 변경되면 블록 리포트는 새로 생성하도록 초기화
  useEffect(() => {
    if (!selectedBlock) return;
    setShowBlockPanel(true);
    setActiveReportTab('block');
    setBlockReport('');
  }, [selectedBlock?.id]);

  // 추천 시나리오 / 추천 개수 변경 시, 비교 선택 초기화
  useEffect(() => {
    setCompareIds([]);
    setCompareReport('');
    setShowComparePanel(false);
  }, [scenario, recommendCount]);

  // 비교 대상 조합이 바뀔 때마다 이전 비교 리포트는 초기화
  useEffect(() => {
    if (compareIds.length === 0) {
      setCompareReport('');
      setShowComparePanel(false);
      return;
    }
    // 다른 조합으로 다시 선택한 경우, 기존 리포트 폐기 후 다시 생성하도록 비움
    setCompareReport('');
  }, [compareIds]);

  // 후보 블록들에 대해 지번 지오코딩 (Kakao coord2Address)
  useEffect(() => {
    const { kakao } = window as any;
    if (!kakao || !candidates.length) return;
    if (!kakao.maps?.services) return;

    const geocoder = new kakao.maps.services.Geocoder();

    candidates.forEach((block: any) => {
      const center = block.center;
      if (!center) return;
      const key = `${Math.round(center.lat * 1e6)},${Math.round(center.lng * 1e6)}`;
      if (jibunMap[key] || block.jibun) return;

      geocoder.coord2Address(center.lng, center.lat, (result: any, status: any) => {
        if (status === kakao.maps.services.Status.OK && result[0]?.address?.address_name) {
          const addrName = result[0].address.address_name as string;
          setJibunMap((prev) => (prev[key] ? prev : { ...prev, [key]: addrName }));
        }
      });
    });
  }, [candidates, jibunMap]);

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

  // 비교용으로 선택된 후보 블록들 (선택 순서 기준)
  const selectedForCompare = compareIds
    .map((idx) => candidates[idx])
    .filter((b) => !!b);

  return (
    <div className="relative flex h-full w-full bg-[#f1f5f9] overflow-hidden">
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

          {/* 추천 시나리오 버튼 */}
          <div className="mt-3 flex gap-2">
            {[
              { id: 'balanced', label: '균형 추천' },
              { id: 'safe', label: '안정 우선' },
              { id: 'growth', label: '성장 우선' },
            ].map((opt) => (
              <button
                key={opt.id}
                onClick={() => handleScenarioChange(opt.id as any)}
                className={`px-2.5 py-1 rounded-full text-[10px] font-bold border transition-colors ${
                  scenario === opt.id
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-slate-50 text-slate-600 border-slate-200 hover:border-blue-300'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* 추천 개수 조절 슬라이더 */}
        <div className="px-6 pt-3 pb-4 border-b border-slate-100 bg-slate-50/60">
          <label className="flex items-center justify-between text-[11px] font-semibold text-slate-500">
            <span>추천 개수</span>
            <span className="text-blue-600">{recommendCount}개</span>
          </label>
          <input
            type="range"
            min={3}
            max={20}
            value={recommendCount}
            onChange={(e) => setRecommendCount(Number(e.target.value))}
            className="w-full mt-2 accent-blue-600"
          />
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
              {(() => {
                const center = item.center;
                const key =
                  center && typeof center.lat === 'number' && typeof center.lng === 'number'
                    ? `${Math.round(center.lat * 1e6)},${Math.round(center.lng * 1e6)}`
                    : null;
                const displayJibun = item.jibun || (key ? jibunMap[key] : null);
                return (
                  <h3 className="font-bold truncate">
                    {displayJibun || '주소 계산 중...'}
                  </h3>
                );
              })()}

              {/* 상태/리스크 태그 */}
              <div className="mt-2 flex flex-wrap gap-1 text-[10px]">
                <span className={`px-2 py-0.5 rounded-full font-bold ${
                  selectedBlock?.id === item.id
                    ? 'bg-white/10 border border-white/30'
                    : 'bg-slate-100 text-slate-600'
                }`}>
                  {item.analysis.statusTag}
                </span>
                <span className={`px-2 py-0.5 rounded-full font-bold ${
                  item.analysis.closurePct >= 40
                    ? selectedBlock?.id === item.id
                      ? 'bg-red-500/20 border border-red-200 text-red-50'
                      : 'bg-red-50 text-red-700'
                    : item.analysis.closurePct >= 20
                    ? selectedBlock?.id === item.id
                      ? 'bg-amber-500/20 border border-amber-200 text-amber-50'
                      : 'bg-amber-50 text-amber-700'
                    : selectedBlock?.id === item.id
                    ? 'bg-emerald-500/20 border border-emerald-200 text-emerald-50'
                    : 'bg-emerald-50 text-emerald-700'
                }`}>
                  {item.analysis.riskTag}
                </span>
              </div>

              {/* 수치 요약 */}
              <div className="flex justify-between items-center mt-3 text-[11px] opacity-80">
                <div className="flex items-center gap-3">
                  <span>신규 {item.analysis.active}</span>
                  <span className="w-px h-3 bg-current opacity-20" />
                  <span>폐업 {item.analysis.closed}</span>
                </div>
                <span className="text-[10px]">
                  폐업비율 {item.analysis.closurePct}%
                </span>
              </div>
              {/* 비교 선택 체크박스 */}
              <div className="mt-2 flex items-center justify-between text-[10px]">
                <label className="flex items-center gap-1 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={compareIds.includes(idx)}
                      onChange={(e) => {
                        e.stopPropagation();
                        toggleCompare(idx);
                      }}
                      className="w-3 h-3 accent-blue-600"
                    />
                  <span className={selectedBlock?.id === item.id ? 'text-blue-100' : 'text-slate-500'}>
                    비교 대상에 추가
                  </span>
                </label>
                {compareIds.includes(idx) && (
                  <span className="text-[10px] font-bold text-blue-500">
                    #{compareIds.indexOf(idx) + 1} 선택
                  </span>
                )}
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
                        <div>
                            <div className="flex justify-between text-xs font-bold mb-1.5 text-slate-500">
                                <span>폐업 비율</span>
                                <span>{selectedBlock.analysis.closurePct}%</span>
                            </div>
                            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                                <div
                                  className="h-full transition-all duration-1000"
                                  style={{
                                    width: `${selectedBlock.analysis.closurePct}%`,
                                    backgroundColor:
                                      selectedBlock.analysis.closurePct > 40
                                        ? '#ef4444'
                                        : selectedBlock.analysis.closurePct > 20
                                        ? '#fbbf24'
                                        : '#22c55e',
                                  }}
                                />
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
                    <button
                      className="w-full py-3 bg-slate-900 text-white rounded-xl font-bold text-xs hover:bg-slate-800 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                      onClick={() => {
                        setShowBlockPanel(true);
                        setActiveReportTab('block');
                        handleGenerateBlockReport();
                      }}
                      disabled={isBlockReportLoading}
                    >
                      {isBlockReportLoading ? '보고서 생성 중...' : '상세 보고서 보기'}
                    </button>
                </div>
            </div>
        )}
      </div>

      {/* 비교 대상 요약 (우측 상단 작은 패널) */}
      {selectedForCompare.length > 0 && (
        <div className="absolute top-4 right-4 w-[340px] bg-white/95 border border-slate-200 rounded-3xl shadow-lg p-3 space-y-2 z-30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BarChart3 className="text-slate-700" size={16} />
              <h4 className="text-[11px] font-black text-slate-800 uppercase tracking-tight">
                비교 대상 ({selectedForCompare.length}/3)
              </h4>
            </div>
            <button
              onClick={() => {
                setShowComparePanel(true);
                setActiveReportTab('compare');
                if (!compareReport) {
                  handleGenerateCompareReport();
                }
              }}
              disabled={selectedForCompare.length < 2 || isCompareLoading}
              className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isCompareLoading ? '분석 중...' : '비교 분석'}
            </button>
          </div>
          <div className="flex flex-wrap gap-1">
            {selectedForCompare.map((b, idx) => {
              const center = b.center;
              const key =
                center && typeof center.lat === 'number' && typeof center.lng === 'number'
                  ? `${Math.round(center.lat * 1e6)},${Math.round(center.lng * 1e6)}`
                  : null;
              const displayJibun = (() => {
                if (!center) return b.jibun;
                const k = key;
                return b.jibun || (k ? jibunMap[k] : null);
              })();

              return (
                <span
                  key={b.id || idx}
                  className="px-2 py-0.5 rounded-full bg-slate-100 text-[10px] text-slate-700 border border-slate-200 max-w-[210px] truncate"
                  title={
                    displayJibun
                      ? `${displayJibun} · ${Math.round(b.totalScore)}점`
                      : '주소 계산 중...'
                  }
                >
                  #{idx + 1} · {Math.round(b.totalScore)}점 · {displayJibun || '주소 계산 중...'}
                </span>
              );
            })}
          </div>
          {selectedForCompare.length < 2 && (
            <p className="text-[10px] text-slate-400">
              최소 2곳 이상 선택해야 비교 분석을 진행할 수 있습니다.
            </p>
          )}
        </div>
      )}

      {/* 지도 위에 뜨는 리포트 패널 (탭 전환) - 비교 대상 패널 바로 아래 배치 */}
      {((showBlockPanel && selectedBlock) || (showComparePanel && compareIds.length >= 2)) && (
        <div className="absolute top-40 right-4 w-[420px] max-h-[57vh] bg-white/95 border border-slate-200 rounded-3xl shadow-xl flex flex-col z-30 overflow-y-auto">
          {/* 헤더: 탭 + 닫기 */}
          <div className="px-4 pt-3 pb-2 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-1">
              {showBlockPanel && selectedBlock && (
                <button
                  onClick={() => setActiveReportTab('block')}
                  className={`px-3 py-1.5 rounded-full text-[11px] font-bold ${
                    activeReportTab === 'block'
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  이 구역 리포트
                </button>
              )}
              {showComparePanel && compareIds.length >= 2 && (
                <button
                  onClick={() => setActiveReportTab('compare')}
                  className={`px-3 py-1.5 rounded-full text-[11px] font-bold ${
                    activeReportTab === 'compare'
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  비교 리포트
                </button>
              )}
            </div>
            <button
              onClick={() => {
                if (activeReportTab === 'block' && showBlockPanel && selectedBlock) {
                  setShowBlockPanel(false);
                } else if (activeReportTab === 'compare' && showComparePanel && compareIds.length >= 2) {
                  setShowComparePanel(false);
                }
              }}
              className="text-[11px] text-slate-400 hover:text-slate-600 px-2"
            >
              ✕
            </button>
          </div>

          {/* 바디: 탭에 따른 내용 */}
          <div className="flex-1 p-3 bg-slate-50">
            {activeReportTab === 'block' && showBlockPanel && selectedBlock && (
              <div className="h-full bg-white rounded-2xl border border-slate-100 p-3 overflow-y-auto text-[11px] text-slate-700">
                {blockReport ? (
                  <div className="prose prose-slate max-w-none prose-headings:text-slate-900 prose-headings:font-bold prose-p:text-slate-600 prose-strong:text-blue-600 prose-ul:my-1 prose-li:my-0.5">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {blockReport}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-400">
                    상세 보고서 보기를 누르면, 이 구역의 상권 구조와 리스크를 요약한 리포트가 생성됩니다.
                  </p>
                )}
              </div>
            )}

            {activeReportTab === 'compare' && showComparePanel && compareIds.length >= 2 && (
              <div className="h-full bg-white rounded-2xl border border-slate-100 p-3 overflow-y-auto text-[11px] text-slate-700">
                {compareReport ? (
                  <div className="prose prose-slate max-w-none prose-headings:text-slate-900 prose-headings:font-bold prose-p:text-slate-600 prose-strong:text-blue-600 prose-ul:my-1 prose-li:my-0.5">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {compareReport}
                    </ReactMarkdown>
                  </div>
                ) : isCompareLoading ? (
                  <p className="text-[11px] text-slate-400">비교 리포트를 생성 중입니다...</p>
                ) : (
                  <p className="text-[11px] text-slate-400">
                    아직 비교 리포트가 없습니다. 우측 상단 패널에서 비교 분석 버튼을 눌러 리포트를 생성하세요.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default RecommendationPage;