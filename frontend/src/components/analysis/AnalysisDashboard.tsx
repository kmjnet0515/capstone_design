import React from 'react';
import { X, Users, TrendingUp, DollarSign, Sparkles, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import SupportPrograms from './SupportPrograms';
import type { SupportProgram } from './SupportPrograms'; // type 키워드 명시
interface AnalysisDashboardProps {
  isOpen: boolean;
  onClose: () => void;
  address: string;
  radius: number;
  aiReport: string;
  isReportLoading: boolean;
  supportPrograms: SupportProgram[];
  isSupportLoading: boolean;
}

const AnalysisDashboard: React.FC<AnalysisDashboardProps> = ({ 
  isOpen, onClose, address, radius, aiReport, isReportLoading, supportPrograms, isSupportLoading
}) => {
  if (!isOpen) return null;

  return (
    <div className={`absolute top-6 right-12 bottom-6 w-[400px] bg-white/95 backdrop-blur-md shadow-2xl rounded-[40px] z-30 border border-slate-200 flex flex-col overflow-hidden transition-all duration-500 transform ${isOpen ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'}`}>
      
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
        />
        {/* 유동인구 섹션 (기존) */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Users size={18} className="text-blue-600" />
            <h4 className="text-sm font-black text-slate-800 uppercase tracking-tight">유동인구 분석</h4>
          </div>
          <div className="h-40 bg-blue-50/50 rounded-3xl border-2 border-dashed border-blue-100 flex flex-col items-center justify-center p-6 text-center text-[11px] text-slate-400">
             데이터 연동 준비 중
          </div>
        </section>

        {/* 매출 예측 섹션 (기존) */}
        <section>
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp size={18} className="text-red-500" />
            <h4 className="text-sm font-black text-slate-800 uppercase tracking-tight">예상 매출 추정</h4>
          </div>
          <div className="bg-red-50 rounded-3xl p-6 border border-red-100">
            <div className="flex justify-between items-end">
              <div>
                <p className="text-[10px] font-black text-red-400 uppercase mb-1">Estimated Monthly Sales</p>
                <span className="text-2xl font-black text-red-600 italic">Analysis Required</span>
              </div>
              <DollarSign size={32} className="text-red-200 mb-1" />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default AnalysisDashboard;