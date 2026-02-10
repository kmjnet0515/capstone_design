import React, { useMemo } from 'react';
import { X, DollarSign, Sparkles, Loader2, LineChart, MapPin, Building2, AlertTriangle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import SupportPrograms from './SupportPrograms';
import type { SupportProgram } from './SupportPrograms'; // type 키워드 명시
import { useAnalysisStore } from '../../store/useAnalysisStore';
interface AnalysisDashboardProps {
  isOpen: boolean;
  onClose: () => void;
  address: string;
  radius: number;
  aiReport: string;
  isReportLoading: boolean;
  supportPrograms: SupportProgram[];
  isSupportLoading: boolean;
  setSupportPrograms: React.Dispatch<React.SetStateAction<SupportProgram[]>>;
}

const AnalysisDashboard: React.FC<AnalysisDashboardProps> = ({ 
  isOpen, onClose, address, radius, aiReport, isReportLoading, supportPrograms, isSupportLoading, setSupportPrograms
}) => {
  if (!isOpen) return null;
  const handleSummaryUpdate = (id: string, newSummary: string) => {
    setSupportPrograms(prev => 
      prev.map(prog => prog.id === id ? { ...prog, summary: newSummary } : prog)
    );
  };

  // ====== 전역 분석 데이터 가져오기 ======
  const landPrices = useAnalysisStore((s) => s.landPrices);
  const shops = useAnalysisStore((s) => s.shops);
  const blocks = useAnalysisStore((s) => s.blocks);
  const majorDistricts = useAnalysisStore((s) => s.majorDistricts);
  const recentTrades = useAnalysisStore((s) => s.recentTrades);
  const selectedSmall = useAnalysisStore((s) => s.selectedCategory.small);
  const coords = useAnalysisStore((s) => s.coords);

  // 안전 가드
  const hasBaseData = landPrices && landPrices.length > 0 && radius > 0;

  // ====== 1. 공시지가 인사이트 (입지 레벨 / 핵심 vs 주변) ======
  const landStats = useMemo(() => {
    if (!Array.isArray(landPrices) || landPrices.length === 0) {
      return null;
    }
    const valid = landPrices.filter((lp: any) => lp && Number(lp.jiga) > 0);
    if (valid.length === 0) return null;

    const sorted = [...valid].sort((a, b) => Number(a.jiga) - Number(b.jiga));
    const total = sorted.length;
    const tercile = (k: number) => sorted[Math.floor((total * k) / 3)]?.jiga ?? sorted[total - 1].jiga;
    const lowCut = Number(tercile(1));
    const midCut = Number(tercile(2));

    let low = 0, mid = 0, high = 0;
    sorted.forEach((item) => {
      const v = Number(item.jiga);
      if (v <= lowCut) low += 1;
      else if (v <= midCut) mid += 1;
      else high += 1;
    });

    // 핵심축 vs 주변부 평균
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const latRad = toRad(coords.lat);
    let coreSum = 0, coreCount = 0;
    let outerSum = 0, outerCount = 0;

    valid.forEach((item: any) => {
      const dLat = (item.lat - coords.lat) * 111000;
      const dLng = (item.lng - coords.lng) * 111000 * Math.cos(latRad);
      const dist = Math.sqrt(dLat * dLat + dLng * dLng);
      if (dist > radius) return;
      if (dist <= radius / 2) {
        coreSum += Number(item.jiga);
        coreCount += 1;
      } else {
        outerSum += Number(item.jiga);
        outerCount += 1;
      }
    });

    const coreAvg = coreCount ? Math.round(coreSum / coreCount / 10000) : 0;
    const outerAvg = outerCount ? Math.round(outerSum / outerCount / 10000) : 0;

    return {
      total,
      bands: {
        lowRatio: Math.round((low / total) * 100),
        midRatio: Math.round((mid / total) * 100),
        highRatio: Math.round((high / total) * 100),
      },
      coreAvg,
      outerAvg,
    };
  }, [landPrices, coords.lat, coords.lng, radius]);

  // ====== 2. 인근 상가 경쟁 구조 ======
  const competitionStats = useMemo(() => {
    if (!Array.isArray(shops) || shops.length === 0 || !radius) return null;
    const total = shops.length;
    const sameCat = selectedSmall
      ? shops.filter((s: any) => s.category_small_name === selectedSmall).length
      : 0;

    // 거리 기반 경쟁 압력
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const latRad = toRad(coords.lat);
    const bins = [
      { label: `0-${Math.round(radius / 3)}m`, min: 0, max: radius / 3, count: 0 },
      { label: `${Math.round(radius / 3)}-${Math.round((2 * radius) / 3)}m`, min: radius / 3, max: (2 * radius) / 3, count: 0 },
      { label: `${Math.round((2 * radius) / 3)}-${radius}m`, min: (2 * radius) / 3, max: radius, count: 0 },
    ];

    shops.forEach((s: any) => {
      const lat = Number(s.lat);
      const lng = Number(s.lon ?? s.lng);
      if (!lat || !lng) return;
      const dLat = (lat - coords.lat) * 111000;
      const dLng = (lng - coords.lng) * 111000 * Math.cos(latRad);
      const dist = Math.sqrt(dLat * dLat + dLng * dLng);
      if (dist > radius) return;
      bins.forEach((b) => {
        if (dist >= b.min && dist < b.max) b.count += 1;
      });
    });

    return {
      total,
      sameCat,
      sameCatRatio: total ? Math.round((sameCat / total) * 100) : 0,
      bins,
    };
  }, [shops, selectedSmall, coords.lat, coords.lng, radius]);

  // ====== 3. 실거래 가격대 밴드 ======
  const tradeBands = useMemo(() => {
    if (!Array.isArray(recentTrades) || recentTrades.length === 0) return null;

    const parsed = recentTrades
      .map((t: any) => {
        const n = Number(String(t.dealAmount).replace(/,/g, ''));
        return isNaN(n) ? null : n;
      })
      .filter((v) => v !== null) as number[];
    if (!parsed.length) return null;

    let low = 0, mid = 0, high = 0;
    parsed.forEach((v) => {
      if (v < 10000) low += 1; // < 1억
      else if (v < 30000) mid += 1; // 1~3억
      else high += 1; // 3억 이상
    });
    const total = low + mid + high || 1;

    return {
      low, mid, high,
      lowRatio: Math.round((low / total) * 100),
      midRatio: Math.round((mid / total) * 100),
      highRatio: Math.round((high / total) * 100),
    };
  }, [recentTrades]);

  // ====== 4. 주요상권 겹침 정도 ======
  const districtStats = useMemo(() => {
    if (!Array.isArray(majorDistricts) || majorDistricts.length === 0) return null;
    const names = majorDistricts
      .map((d: any) => d.name)
      .filter((n: any) => typeof n === 'string') as string[];
    const uniqueNames = Array.from(new Set(names));
    const count = uniqueNames.length;
    // 단순히 상권 개수 기반으로 "커버리지"를 점수화 (0~100)
    const coverageScore = Math.min(100, count * 25); // 상권 4개 이상이면 100
    return { names: uniqueNames, count, coverageScore };
  }, [majorDistricts]);

  // ====== 5. 폐업/활력도 블록 ======
  const vitalityStats = useMemo(() => {
    if (!Array.isArray(blocks) || blocks.length === 0) return null;
    let totalActive = 0;
    let totalClosed = 0;

    let hotBlocks = 0;
    let stableBlocks = 0;
    let riskyBlocks = 0;

    blocks.forEach((b: any) => {
      const a = Number(b?.properties?.activeCount || 0);
      const c = Number(b?.properties?.closedCount || 0);
      totalActive += a;
      totalClosed += c;

      if (a > 0 && c === 0) {
        hotBlocks += 1; // 신규만 있는 안정/핫 블록
      } else if (a === 0 && c === 0) {
        // 완전 비어있는 블록은 스킵
      } else if (c > a) {
        riskyBlocks += 1; // 폐업 우위 블록
      } else {
        stableBlocks += 1; // 혼합/보합 블록
      }
    });

    const totalPoints = totalActive + totalClosed || 1;
    const closureRatio = Math.round((totalClosed / totalPoints) * 100);

    return {
      totalActive,
      totalClosed,
      closureRatio,
      hotBlocks,
      stableBlocks,
      riskyBlocks,
    };
  }, [blocks]);
  return (
    <div className={`absolute top-6 right-12 bottom-6 w-200 bg-white/95 backdrop-blur-md shadow-2xl rounded-[40px] z-30 border border-slate-200 flex flex-col overflow-hidden transition-all duration-500 transform ${isOpen ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'}`}>
      {/* 헤더 */}
      <div className="p-8 border-b border-slate-100 flex justify-between items-start bg-slate-50/50">
        <div>
          <h3 className="text-xl font-black text-blue-950 flex items-center gap-2">
            상권 분석 리포트
          </h3>
          <p className="text-[11px] font-bold text-blue-600 uppercase mt-1 tracking-wider">{address} 반경 {radius}m</p>
        </div>
        <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-full transition-colors">
          <X size={20} className="text-slate-400" />
        </button>
      </div>
      {/* 컨텐츠 영역 */}
      <div className="flex-1 overflow-y-auto p-8 space-y-10 custom-scrollbar">
        {/* AI 컨설팅 섹션 (신규) */}
        <section className="relative">
          <div className="flex items-center gap-2 mb-4">
            <Sparkles size={18} className="text-purple-600" />
            <h4 className="text-sm font-black text-slate-800 uppercase tracking-tight">AI 전문 컨설팅</h4>
          </div>

          {isReportLoading ? (
            <div className="h-64 bg-slate-50 rounded-3xl flex flex-col items-center justify-center p-6 text-center border border-slate-100">
              <Loader2 size={32} className="text-purple-600 animate-spin mb-4" />
              <p className="text-sm font-bold text-slate-600">빅데이터 분석 모델 가동 중...</p>
              <p className="text-[11px] text-slate-400 mt-2">입지 조건과 공시지가, 실거래가를 바탕으로<br/>최적의 진입 전략을 수립하고 있습니다.</p>
            </div>
          ) : aiReport ? (
            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm mt-4 text-left"> 
              {/* text-left를 넣어 App.css의 center 정렬을 상쇄합니다 */}
              
              <div className="prose prose-slate max-w-none 
                prose-headings:text-slate-900 prose-headings:font-bold
                prose-p:text-slate-600 prose-strong:text-blue-600">
                
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {aiReport}
                </ReactMarkdown>
                
              </div>
            </div>
          ) : (
            <div className="h-32 bg-slate-50 rounded-3xl flex items-center justify-center border border-dashed border-slate-200">
              <p className="text-xs font-bold text-slate-400 font-mono">분석 버튼을 눌러 리포트를 생성하세요</p>
            </div>
          )}
        </section>
        <SupportPrograms 
            programs={supportPrograms} 
            isLoading={isSupportLoading} 
            onSummaryUpdate={handleSummaryUpdate}
        />
        {/* 1. 공시지가 – 입지 레벨 / 핵심축 vs 주변부 */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <DollarSign size={18} className="text-emerald-600" />
            <h4 className="text-sm font-black text-slate-800 uppercase tracking-tight">입지 가치 레벨 (공시지가)</h4>
          </div>
          {landStats ? (
            <div className="bg-slate-50 rounded-3xl p-6 border border-slate-100 space-y-4">
              {/* 지가 밴드 */}
              <div>
                <p className="text-[11px] font-semibold text-slate-500 mb-2">반경 내 지가 분포 (Low / Mid / High)</p>
                <div className="w-full h-3 rounded-full overflow-hidden bg-slate-200 flex">
                  <div
                    className="h-full bg-emerald-300"
                    style={{ width: `${landStats.bands.lowRatio}%` }}
                  />
                  <div
                    className="h-full bg-emerald-500"
                    style={{ width: `${landStats.bands.midRatio}%` }}
                  />
                  <div
                    className="h-full bg-emerald-700"
                    style={{ width: `${landStats.bands.highRatio}%` }}
                  />
                </div>
                <div className="flex justify-between mt-1 text-[10px] text-slate-500 font-semibold">
                  <span>Low {landStats.bands.lowRatio}%</span>
                  <span>Mid {landStats.bands.midRatio}%</span>
                  <span>High {landStats.bands.highRatio}%</span>
                </div>
              </div>

              {/* 핵심축 vs 주변부 */}
              <div className="grid grid-cols-2 gap-4 mt-3">
                <div className="bg-white rounded-2xl border border-slate-100 p-3">
                  <p className="text-[10px] font-bold text-slate-500 mb-1">핵심축 평균 지가</p>
                  <p className="text-lg font-black text-emerald-600">
                    {landStats.coreAvg.toLocaleString()}만/㎡
                  </p>
                  <p className="text-[10px] text-slate-400 mt-1">반경 {Math.round(radius / 2)}m 이내</p>
                </div>
                <div className="bg-white rounded-2xl border border-slate-100 p-3">
                  <p className="text-[10px] font-bold text-slate-500 mb-1">주변부 평균 지가</p>
                  <p className="text-lg font-black text-slate-700">
                    {landStats.outerAvg.toLocaleString()}만/㎡
                  </p>
                  <p className="text-[10px] text-slate-400 mt-1">반경 {Math.round(radius / 2)}~{radius}m</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="h-24 bg-slate-50 rounded-3xl border border-dashed border-slate-200 flex items-center justify-center text-[11px] text-slate-400">
              공시지가 데이터가 없어 입지 레벨을 계산할 수 없습니다.
            </div>
          )}
        </section>

        {/* 2. 인근 상가 – 경쟁 밀집도 / 거리별 경쟁 압력 */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Building2 size={18} className="text-blue-600" />
            <h4 className="text-sm font-black text-slate-800 uppercase tracking-tight">경쟁 구조 (인근 상가)</h4>
          </div>
          {competitionStats ? (
            <div className="bg-slate-50 rounded-3xl p-6 border border-slate-100 space-y-4">
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-[10px] font-bold text-slate-500 mb-1">
                    동종업 비율
                  </p>
                  <p className="text-2xl font-black text-blue-600">
                    {competitionStats.sameCatRatio}%
                  </p>
                  <p className="text-[11px] text-slate-500 mt-1">
                    전체 {competitionStats.total}개 중 동종업 {competitionStats.sameCat}개
                  </p>
                </div>
                <div className="w-20 h-20 rounded-full border-4 border-blue-100 flex items-center justify-center relative">
                  <div
                    className="w-14 h-14 rounded-full flex items-center justify-center text-xs font-black"
                    style={{
                      background:
                        competitionStats.sameCatRatio > 60
                          ? '#fee2e2'
                          : competitionStats.sameCatRatio > 30
                          ? '#fef9c3'
                          : '#dcfce7',
                      color:
                        competitionStats.sameCatRatio > 60
                          ? '#b91c1c'
                          : competitionStats.sameCatRatio > 30
                          ? '#92400e'
                          : '#166534',
                    }}
                  >
                    {competitionStats.sameCatRatio > 60
                      ? '과밀'
                      : competitionStats.sameCatRatio > 30
                      ? '보통'
                      : '여유'}
                  </div>
                </div>
              </div>

              <div className="mt-4">
                <p className="text-[11px] font-semibold text-slate-500 mb-2">
                  거리별 경쟁 압력 (동종 + 이종 상가 수)
                </p>
                <div className="space-y-2">
                  {competitionStats.bins.map((b) => (
                    <div key={b.label} className="flex items-center gap-2">
                      <span className="w-28 text-[10px] text-slate-500 font-semibold">
                        {b.label}
                      </span>
                      <div className="flex-1 h-2 rounded-full bg-slate-200 overflow-hidden">
                        <div
                          className="h-full bg-blue-500"
                          style={{
                            width: `${Math.min(100, (b.count / (competitionStats.total || 1)) * 300)}%`,
                          }}
                        />
                      </div>
                      <span className="w-6 text-[10px] text-slate-500 text-right">
                        {b.count}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="h-24 bg-slate-50 rounded-3xl border border-dashed border-slate-200 flex items-center justify-center text-[11px] text-slate-400">
              인근 상가 데이터가 없어 경쟁 구조를 계산할 수 없습니다.
            </div>
          )}
        </section>

        {/* 3. 실거래 정보 – 가격대 밴드 */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <LineChart size={18} className="text-indigo-600" />
            <h4 className="text-sm font-black text-slate-800 uppercase tracking-tight">점포 가격대 밴드 (실거래)</h4>
          </div>
          {tradeBands ? (
            <div className="bg-slate-50 rounded-3xl p-6 border border-slate-100 space-y-3">
              <div className="space-y-2">
                {[
                  { label: '< 1억', value: tradeBands.low, ratio: tradeBands.lowRatio, color: 'bg-sky-400' },
                  { label: '1~3억', value: tradeBands.mid, ratio: tradeBands.midRatio, color: 'bg-sky-600' },
                  { label: '3억 이상', value: tradeBands.high, ratio: tradeBands.highRatio, color: 'bg-sky-900' },
                ].map((b) => (
                  <div key={b.label} className="flex items-center gap-2">
                    <span className="w-16 text-[10px] text-slate-500 font-semibold">
                      {b.label}
                    </span>
                    <div className="flex-1 h-2 rounded-full bg-slate-200 overflow-hidden">
                      <div
                        className={`h-full ${b.color}`}
                        style={{ width: `${b.ratio}%` }}
                      />
                    </div>
                    <span className="w-10 text-[10px] text-slate-500 text-right">
                      {b.value}건
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-slate-500 mt-2">
                최근 실거래 금액 분포를 기준으로, 이 상권에 진입하기 위한 대략적인 자본 규모를 가늠할 수 있습니다.
              </p>
            </div>
          ) : (
            <div className="h-24 bg-slate-50 rounded-3xl border border-dashed border-slate-200 flex items-center justify-center text-[11px] text-slate-400">
              실거래 데이터가 없어 가격대 밴드를 계산할 수 없습니다.
            </div>
          )}
        </section>

        {/* 4. 주요상권 – 공식 상권과의 겹침 정도 */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <MapPin size={18} className="text-rose-600" />
            <h4 className="text-sm font-black text-slate-800 uppercase tracking-tight">공식 상권 커버리지</h4>
          </div>
          {districtStats ? (
            <div className="bg-slate-50 rounded-3xl p-6 border border-slate-100 space-y-3">
              <div>
                <p className="text-[10px] font-bold text-slate-500 mb-1">
                  반경 내 포함된 주요 상권
                </p>
                <div className="flex flex-wrap gap-1">
                  {districtStats.names.map((name) => (
                    <span
                      key={name}
                      className="px-2 py-0.5 rounded-full bg-rose-50 text-rose-600 text-[10px] font-semibold border border-rose-100"
                    >
                      #{name}
                    </span>
                  ))}
                </div>
              </div>
              <div className="mt-3">
                <p className="text-[10px] font-bold text-slate-500 mb-1">
                  상권 커버리지 점수
                </p>
                <div className="w-full h-2 rounded-full bg-slate-200 overflow-hidden">
                  <div
                    className="h-full bg-rose-500"
                    style={{ width: `${districtStats.coverageScore}%` }}
                  />
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  공식 상권 {districtStats.count}개가 반경 안에 겹쳐져 있어, 브랜드 인지도가 높은 입지입니다.
                </p>
              </div>
            </div>
          ) : (
            <div className="h-24 bg-slate-50 rounded-3xl border border-dashed border-slate-200 flex items-center justify-center text-[11px] text-slate-400">
              반경 내에 등록된 공식 상권 정보가 없습니다.
            </div>
          )}
        </section>

        {/* 5. 폐업 상가 – 신규 vs 폐업 비율 / 안정·핫블록 식별 */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle size={18} className="text-amber-600" />
            <h4 className="text-sm font-black text-slate-800 uppercase tracking-tight">신규 vs 폐업 흐름 (활력도)</h4>
          </div>
          {vitalityStats ? (
            <div className="bg-slate-50 rounded-3xl p-6 border border-slate-100 space-y-4">
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-[10px] font-bold text-slate-500 mb-1">
                    신규 vs 폐업 비율
                  </p>
                  <p className="text-2xl font-black text-slate-800">
                    {vitalityStats.totalActive} : {vitalityStats.totalClosed}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-1">
                    폐업 비율 {vitalityStats.closureRatio}% (
                    신규 {vitalityStats.totalActive}곳 / 폐업 {vitalityStats.totalClosed}곳)
                  </p>
                </div>
                <div className="w-20 h-20 rounded-full border-4 border-amber-100 flex items-center justify-center">
                  <span
                    className="text-xs font-black"
                    style={{
                      color:
                        vitalityStats.closureRatio > 60
                          ? '#b91c1c'
                          : vitalityStats.closureRatio > 40
                          ? '#92400e'
                          : '#166534',
                    }}
                  >
                    {vitalityStats.closureRatio > 60
                      ? '위축'
                      : vitalityStats.closureRatio > 40
                      ? '주의'
                      : '성장/안정'}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 mt-2">
                <div className="bg-white rounded-2xl border border-slate-100 p-3 text-center">
                  <p className="text-[10px] font-bold text-emerald-600 mb-1">안정/핫 블록</p>
                  <p className="text-lg font-black text-emerald-700">
                    {vitalityStats.hotBlocks}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-1">폐업 없이 신규만 있는 블록</p>
                </div>
                <div className="bg-white rounded-2xl border border-slate-100 p-3 text-center">
                  <p className="text-[10px] font-bold text-slate-600 mb-1">보합 블록</p>
                  <p className="text-lg font-black text-slate-700">
                    {vitalityStats.stableBlocks}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-1">신규·폐업이 혼재된 블록</p>
                </div>
                <div className="bg-white rounded-2xl border border-slate-100 p-3 text-center">
                  <p className="text-[10px] font-bold text-rose-600 mb-1">위험 블록</p>
                  <p className="text-lg font-black text-rose-700">
                    {vitalityStats.riskyBlocks}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-1">폐업이 더 많은 블록</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="h-24 bg-slate-50 rounded-3xl border border-dashed border-slate-200 flex items-center justify-center text-[11px] text-slate-400">
              폐업/신규 데이터가 없어 활력도를 계산할 수 없습니다.
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default AnalysisDashboard;