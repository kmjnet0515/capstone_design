import React from 'react';
import {Loader2, MapPin } from 'lucide-react';

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
}

const AnalysisSidebar: React.FC<AnalysisSidebarProps> = (p) => {
  return (
  <aside className="w-95 bg-white border-r border-slate-100 p-8 flex flex-col shadow-xl z-10 overflow-y-auto shrink-0">
    <header className="mb-10"><h1 className="text-3xl font-black text-blue-950 italic">SBC 365</h1><p className="text-[11px] text-blue-600 font-bold uppercase mt-1.5">Market Analysis Tool</p></header>
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