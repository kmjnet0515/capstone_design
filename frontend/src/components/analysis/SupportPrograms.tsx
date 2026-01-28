import React from 'react';
import { ExternalLink, Calendar, Gift, FileText, Download } from 'lucide-react';

// 인터페이스에 새 필드 추가 (백엔드와 일치시킴)
export interface SupportProgram {
  id: string;
  title: string;
  agency: string;
  summary: string;
  period: string;
  url: string;
  type: string;
  fileUrl?: string;  // 추가
  fileName?: string; // 추가
}

interface SupportProgramsProps {
  programs: SupportProgram[];
  isLoading: boolean;
}

const SupportPrograms: React.FC<SupportProgramsProps> = ({ programs, isLoading }) => {
  return (
    <section className="mt-8">
      <div className="flex items-center gap-2 mb-4">
        <Gift size={18} className="text-pink-500" />
        <h4 className="text-sm font-black text-slate-800 uppercase tracking-tight">
          소상공인 맞춤 지원제도
        </h4>
        <span className="text-[10px] bg-pink-100 text-pink-600 px-2 py-0.5 rounded-full font-bold">
          {programs.length}건
        </span>
      </div>

      <div className="space-y-3">
        {isLoading ? (
          [1, 2].map((i) => (
            <div key={i} className="animate-pulse bg-slate-50 p-4 rounded-2xl border border-slate-100 h-24" />
          ))
        ) : programs.length > 0 ? (
          programs.map((program) => (
            <div 
              key={program.id} 
              className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all group"
            >
              <div className="flex justify-between items-start mb-2">
                <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded-md mb-1 inline-block">
                  {program.type} | {program.agency}
                </span>
                <a 
                  href={program.url} 
                  target="_blank" 
                  rel="noreferrer"
                  className="text-slate-400 hover:text-blue-500 transition-colors"
                >
                  <ExternalLink size={16} />
                </a>
              </div>
              
              <h5 className="text-sm font-bold text-slate-800 mb-2 leading-tight group-hover:text-blue-700 transition-colors">
                {program.title}
              </h5>
              
              {/* summary 전체 공개 */}
              <p className="text-xs text-slate-500 mb-4 leading-relaxed whitespace-pre-wrap">
                {program.summary}
              </p>

              {/* 하단 정보 영역: 기간 및 다운로드 */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1.5 text-[11px] text-slate-400 bg-slate-50 px-3 py-1.5 rounded-lg">
                  <Calendar size={12} />
                  <span className="font-medium">{program.period}</span>
                </div>

                {/* 파일 다운로드 버튼 (URL이 있을 때만 렌더링) */}
                {program.fileUrl && (
                  <a 
                    href={program.fileUrl}
                    download={program.fileName || '공고문'}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 text-[11px] text-blue-600 bg-blue-50 px-3 py-1.5 rounded-lg hover:bg-blue-100 transition-colors"
                  >
                    <FileText size={12} />
                    <span className="font-bold truncate max-w-[150px]">
                      {program.fileName || '공고문 다운로드'}
                    </span>
                    <Download size={10} />
                  </a>
                )}
              </div>
            </div>
          ))
        ) : (
          <div className="bg-slate-50 rounded-2xl p-6 text-center border border-dashed border-slate-200">
            <p className="text-xs text-slate-400 font-bold">현재 조건에 맞는 지원사업이 없습니다.</p>
          </div>
        )}
      </div>
    </section>
  );
};

export default SupportPrograms;