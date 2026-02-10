import React, { useState } from 'react';
import { ExternalLink, Calendar, Gift, FileText, Download, Bot, Sparkles } from 'lucide-react';
import axios from 'axios';

const API_BASE_URL = "http://localhost:3000/api";

export interface SupportProgram {
  id: string;
  title: string;
  agency: string;
  summary: string | null;
  period: string;
  url: string;
  type: string;
  fileUrl?: string;
  fileName?: string;
  meth : string;
}

interface SupportProgramsProps {
  programs: SupportProgram[];
  isLoading: boolean;
  onSummaryUpdate?: (id: string, newSummary: string) => void; 
}

const SupportPrograms: React.FC<SupportProgramsProps> = ({ programs, isLoading, onSummaryUpdate }) => {
  const [analyzingIds, setAnalyzingIds] = useState<Set<string>>(new Set());
  
  // 핵심: 각 프로그램 ID별로 생성된 AI 요약을 따로 저장하는 객체
  const [aiSummaries, setAiSummaries] = useState<Record<string, string>>({});

  const handleSummarize = async (program: SupportProgram) => {
    if (!program.fileUrl) {
      alert("분석할 공고문 파일이 없습니다.");
      return;
    }

    setAnalyzingIds(prev => new Set(prev).add(program.id));

    try {
      const response = await axios.post(`${API_BASE_URL}/support/summarize`, {
        id: program.id,
        fileUrl: program.fileUrl,
        fileName: program.fileName
      });

      if (response.data.success) {
        // 1. 현재 컴포넌트의 로컬 상태에 요약 내용 저장 (즉시 화면 표시)
        setAiSummaries(prev => ({
          ...prev,
          [program.id]: response.data.summary
        }));

      }
    } catch (error) {
      console.error("요약 실패", error);
      alert("요약에 실패했습니다.");
    } finally {
      setAnalyzingIds(prev => {
        const next = new Set(prev);
        next.delete(program.id);
        return next;
      });
    }
  };

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
          programs.map((program) => {
            const isAnalyzing = analyzingIds.has(program.id);
            // 해당 아이템에 생성된 AI 요약이 있는지 확인
            const currentAiSummary = aiSummaries[program.id];

            return (
              <div 
                key={program.id} 
                className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all group"
              >
                <div className="flex justify-between items-start mb-2">
                  <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded-md mb-1 inline-block">
                    {program.type} | {program.agency}
                  </span>
                  <a href={program.url} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-blue-500">
                    <ExternalLink size={16} />
                  </a>
                </div>
                
                <h5 className="text-sm font-bold text-slate-800 mb-2 leading-tight">
                  {program.title}
                </h5>
                
                <div className="mb-4 space-y-3">
                  {/* [항상 노출] 기존 원문 요약 */}
                  <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                    <p className="text-s text-slate-700 leading-relaxed whitespace-pre-wrap">
                      {program.summary || "상세 내용은 공고문을 확인해 주세요."}
                    </p>
                  </div>

                  {/* [조건부 노출] AI 요약 결과가 있으면 결과창, 없으면 버튼 */}
                  {currentAiSummary ? (
                    <div className="bg-indigo-50/50 p-3 rounded-xl border border-indigo-100 animate-in fade-in slide-in-from-top-1 duration-300">
                      <div className="flex items-center gap-1 mb-1 text-indigo-600">
                        <Bot size={12} />
                        <span className="text-[10px] font-bold">AI 정밀 요약</span>
                      </div>
                      <div className="space-y-2">
                        {currentAiSummary.split('.').map((sentence, idx) => {
                          const trimmed = sentence.trim();
                          if (!trimmed) return null; // 빈 문장 제외

                          return (
                            <p key={idx} className="text-s font-bold text-slate-700 leading-relaxed">
                              • {trimmed}.
                            </p>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    program.fileUrl && (
                      <button
                        onClick={() => handleSummarize(program)}
                        disabled={isAnalyzing}
                        className="w-full py-2.5 bg-gradient-to-r from-indigo-50 to-blue-50 border border-indigo-100 rounded-xl flex items-center justify-center gap-2 hover:from-indigo-100 hover:to-blue-100 transition-all group/btn"
                      >
                        {isAnalyzing ? (
                          <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <Sparkles size={14} className="text-indigo-600" />
                        )}
                        <span className="text-xs font-bold text-indigo-600">
                          {isAnalyzing ? "공고문을 분석하는 중..." : "AI로 공고문 요약하기"}
                        </span>
                      </button>
                    )
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1.5 text-s text-slate-700 bg-slate-50 px-3 py-1.5 rounded-lg">
                    <Calendar size={12} />
                    <span className="font-medium">{program.period || "기간 확인 필요"}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-s text-slate-700 bg-slate-50 px-3 py-1.5 rounded-lg">
                    <span className="font-medium">{`신청방법 : ${program.meth}`}</span>
                  </div>
                  {program.fileUrl && (
                    <a 
                      href={program.fileUrl}
                      download={program.fileName || '공고문'}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1.5 text-s text-blue-600 bg-blue-50 px-3 py-1.5 rounded-lg hover:bg-blue-100 transition-colors ml-auto"
                    >
                      <FileText size={12} />
                      <span className="font-bold truncate max-w-[120px]">공고문 원본</span>
                      <Download size={10} />
                    </a>
                  )}
                </div>
              </div>
            );
          })
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