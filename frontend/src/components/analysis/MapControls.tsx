import React from 'react';


interface Props {
  showLandPrice: boolean;
  showShops: boolean;
  showTrades: boolean;
  showDashboard : boolean;
  showPrincipalCommercialZone : boolean;
  showClosed : boolean;
  toggleLandPrice: () => void; 
  toggleShops: () => void; 
  toggleTrades: () => void;
  toggleDashboard : () => void;
  togglePrincipalCommercialZone : () => void;
  toggleClosed : () => void;

}


const MapControls: React.FC<Props> = (p) => (
  <div className="absolute top-6 right-6 z-20 flex flex-col gap-3">
    {[
      { label: '공시지가', state: p.showLandPrice, toggle: p.toggleLandPrice, color: 'bg-blue-600', border: 'border-blue-400' },
      { label: '인근 상가', state: p.showShops, toggle: p.toggleShops, color: 'bg-cyan-600', border: 'border-cyan-400' },
      { label: '실거래 정보', state: p.showTrades, toggle: p.toggleTrades, color: 'bg-orange-500', border: 'border-orange-300' },
      { label: '상세 리포트', state: p.showDashboard, toggle: p.toggleDashboard, color: 'bg-indigo-600', border: 'border-indigo-400' },
      { label: '주요 상권', state: p.showPrincipalCommercialZone, toggle: p.togglePrincipalCommercialZone, color: 'bg-green-600', border: 'border-green-400' },
      { label: '폐업 상가', state: p.showClosed, toggle: p.toggleClosed, color: 'bg-gray-600', border: 'border-gray-400' }


    ].map(btn => (
      <button key={btn.label} onClick={btn.toggle} className={`w-35 h-12 px-5 py-3 rounded-2xl font-black text-[11px] shadow-xl border-2 flex items-center gap-2 transition-all ${btn.state ? `${btn.color} text-white ${btn.border}` : 'bg-white text-slate-400 border-slate-100'}`}>
        <div className={`w-3 h-3 rounded-full ${btn.state ? 'bg-white animate-pulse' : 'bg-slate-300'}`} />
        {btn.label} {btn.state ? 'ON' : 'OFF'}
      </button>
    ))}
  </div>
);

export default MapControls;