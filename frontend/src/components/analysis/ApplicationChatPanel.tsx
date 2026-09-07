import React, { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import {
  Bot,
  Loader2,
  Send,
  Download,
  CheckCircle2,
  AlertCircle,
  FileText,
  Pencil,
  PenLine,
  Mail,
  Phone,
  Calendar,
  Hash,
  Building2,
  X,
  CloudDownload,
  Search,
  Brain,
  Database,
  Sparkles,
  Clock,
  Hourglass,
  SkipForward,
  RotateCcw,
} from 'lucide-react';
import { API_BASE_URL } from '../../config/apiBase';

type FieldKind =
  | 'text' | 'longtext' | 'number' | 'date' | 'phone' | 'email'
  | 'biz_no' | 'checkbox' | 'radio' | 'signature';

interface FieldLocation {
  input_type?: FieldKind;
  options?: string[] | null;
  composed_label?: string | null;
  manual_only?: boolean | null;
  [k: string]: unknown;
}

interface ApplicationField {
  id: number;
  kind: FieldKind | string;
  location_json: string | FieldLocation | null;
  prompt_label: string;
  placeholder_text: string | null;
  value: string | null;
  is_filled: 0 | 1;
  is_skipped?: 0 | 1;
  order_index: number;
}

interface ApplicationMessage {
  id: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
}

interface CandidateAttachment {
  url: string;
  fileName: string;
  ext: string;
  score: number;
  source?: string;
}

interface SessionView {
  ok: boolean;
  session: {
    id: number;
    status: string;
    program_title: string | null;
    chosen_attachment_name: string | null;
    error_message: string | null;
    progress_stage: string | null;
    progress_percent: number | null;
    progress_started_at: string | null;
    queue_position: number | null;
  };
  fields: ApplicationField[];
  messages: ApplicationMessage[];
  candidates: CandidateAttachment[] | null;
  downloadUrl: string | null;
  queue_snapshot?: { running: any; waiting: any[] };
}

interface Props {
  programId: string;
  programTitle: string;
  programUrl: string;
  fileUrl?: string;
  fileName?: string;
  onClose?: () => void;
}

const STATUS_LABELS: Record<string, string> = {
  created: '세션 준비 중',
  crawling: '신청서 양식 검색 중',
  awaiting_choice: '첨부파일 선택 대기',
  uploading: '신청서 업로드 중',
  analyzing: '신청서 분석 중',
  collecting: '항목 수집 중',
  filling: '신청서에 적용 중',
  done: '작성 완료',
  failed: '실패',
};

interface StageDef {
  key: string;
  label: string;
  Icon: React.FC<any>;
  color: string;     // tailwind 색상 prefix (예: indigo)
  etaSec: number;    // 정상 흐름에서 이 단계가 끝날 때까지의 누적 ETA(초)
}

const STAGE_DEFS: StageDef[] = [
  { key: 'queued',           label: '대기 중',                Icon: Hourglass,     color: 'slate',   etaSec: 1 },
  { key: 'crawling',         label: '신청서 첨부 검색 중',     Icon: Search,        color: 'sky',     etaSec: 4 },
  { key: 'downloading',      label: '신청서 다운로드 중',      Icon: CloudDownload, color: 'blue',    etaSec: 7 },
  { key: 'hashing',          label: '문서 지문 계산 중',       Icon: Database,      color: 'cyan',    etaSec: 8 },
  { key: 'extracting_grids', label: '표 구조 추출 중',         Icon: FileText,      color: 'violet',  etaSec: 12 },
  { key: 'classifying_llm',  label: 'AI 의미 분류 중',         Icon: Brain,         color: 'fuchsia', etaSec: 38 },
  { key: 'persisting',       label: '항목 정리 중',            Icon: Sparkles,      color: 'amber',   etaSec: 40 },
  { key: 'collecting',       label: '준비 완료',               Icon: CheckCircle2,  color: 'emerald', etaSec: 41 },
];

const CACHE_HIT_DEFS: StageDef[] = [
  { key: 'queued',      label: '대기 중',           Icon: Hourglass,    color: 'slate',   etaSec: 0.5 },
  { key: 'downloading', label: '신청서 다운로드',    Icon: CloudDownload, color: 'blue',   etaSec: 2 },
  { key: 'hashing',     label: '캐시 확인 중',       Icon: Database,     color: 'cyan',    etaSec: 2.5 },
  { key: 'cache_hit',   label: '저장된 분석 불러옴 ⚡', Icon: Sparkles,    color: 'emerald', etaSec: 3 },
  { key: 'persisting',  label: '항목 정리 중',       Icon: Sparkles,     color: 'amber',   etaSec: 3.2 },
  { key: 'collecting',  label: '준비 완료',          Icon: CheckCircle2, color: 'emerald', etaSec: 3.5 },
];

const TOTAL_ETA_SEC = STAGE_DEFS[STAGE_DEFS.length - 1].etaSec;
const CACHE_HIT_TOTAL_ETA_SEC = CACHE_HIT_DEFS[CACHE_HIT_DEFS.length - 1].etaSec;

const PROGRESS_VISIBLE_STATUSES = new Set([
  'created', 'crawling', 'uploading', 'analyzing', 'filling',
]);

// Tailwind JIT 가 빌드 시 인식할 수 있도록 정적 매핑
const STAGE_COLOR_CLASSES: Record<string, string> = {
  slate:   'text-slate-700 bg-slate-100 ring-2 ring-slate-400/40',
  sky:     'text-sky-700 bg-sky-100 ring-2 ring-sky-400/40',
  blue:    'text-blue-700 bg-blue-100 ring-2 ring-blue-400/40',
  cyan:    'text-cyan-700 bg-cyan-100 ring-2 ring-cyan-400/40',
  violet:  'text-violet-700 bg-violet-100 ring-2 ring-violet-400/40',
  fuchsia: 'text-fuchsia-700 bg-fuchsia-100 ring-2 ring-fuchsia-400/40',
  amber:   'text-amber-700 bg-amber-100 ring-2 ring-amber-400/40',
  emerald: 'text-emerald-700 bg-emerald-100 ring-2 ring-emerald-400/40',
  indigo:  'text-indigo-700 bg-indigo-100 ring-2 ring-indigo-400/40',
};

const ApplicationChatPanel: React.FC<Props> = ({
  programId,
  programTitle,
  programUrl,
  fileUrl,
  fileName,
  onClose,
}) => {
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [view, setView] = useState<SessionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [isChoosingAttachment, setIsChoosingAttachment] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoAskInFlightRef = useRef(false);
  const actionLockRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await axios.post(`${API_BASE_URL}/applications/start`, {
          programId,
          programTitle,
          programUrl,
          fileUrl,
          fileName,
        });
        if (cancelled) return;
        if (r.data?.ok) setSessionId(r.data.sessionId);
        else setError(r.data?.error || '세션 생성 실패');
      } catch (e: any) {
        if (!cancelled) setError(e?.message || '세션 생성 실패');
      }
    })();
    return () => { cancelled = true; };
  }, [programId, programTitle, programUrl, fileUrl, fileName]);

  useEffect(() => {
    if (!sessionId) return;
    let active = true;
    let timer: any;
    const tick = async () => {
      try {
        const r = await axios.get(`${API_BASE_URL}/applications/${sessionId}`);
        if (!active) return;
        if (r.data?.ok) setView(r.data);
      } catch (e) { /* swallow */ }
      const status = view?.session?.status;
      const fast = !status || ['created', 'crawling', 'uploading', 'analyzing', 'filling'].includes(status);
      timer = setTimeout(tick, fast ? 1500 : 4000);
    };
    tick();
    return () => { active = false; if (timer) clearTimeout(timer); };
  }, [sessionId, view?.session?.status]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [view?.messages?.length]);

  const fields = view?.fields || [];
  const { autoFields, manualFields } = useMemo(() => {
    const a: ApplicationField[] = [];
    const m: ApplicationField[] = [];
    fields.forEach((f) => {
      const meta = parseLocation(f.location_json);
      if (String(f.kind).toLowerCase() === 'signature' || meta.manual_only) m.push(f);
      else a.push(f);
    });
    return { autoFields: a, manualFields: m };
  }, [fields]);
  const totalFields = autoFields.length;
  const filledFields = useMemo(
    () => autoFields.filter((f) => f.is_filled && f.value).length,
    [autoFields]
  );
  const skippedFields = useMemo(
    () => autoFields.filter((f) => f.is_skipped).length,
    [autoFields]
  );
  const handledFields = filledFields + skippedFields;
  const allFilled = totalFields > 0 && handledFields === totalFields;
  const status = view?.session?.status || 'created';
  const isInteractable = status === 'collecting' && !isSending;
  const [editingId, setEditingId] = useState<number | null>(null);

  const updateField = async (fieldId: number, value: string) => {
    if (!sessionId) return;
    try {
      const r = await axios.post(`${API_BASE_URL}/applications/${sessionId}/field`, { fieldId, value });
      if (r.data?.ok && view) setView({ ...view, fields: r.data.fields });
    } catch (e: any) {
      setError(e?.message || '필드 저장 실패');
    }
  };

  const recommendField = async (fieldId: number): Promise<string[]> => {
    if (!sessionId) return [];
    try {
      const r = await axios.post(`${API_BASE_URL}/applications/${sessionId}/recommend-field`, {
        fieldId,
      });
      if (r.data?.ok && Array.isArray(r.data.suggestions)) return r.data.suggestions;
      return [];
    } catch (_e) {
      return [];
    }
  };

  const skipField = async (fieldId: number, skip: boolean = true) => {
    if (!sessionId) return;
    try {
      const r = await axios.post(`${API_BASE_URL}/applications/${sessionId}/field/skip`, {
        fieldId,
        skip,
      });
      if (r.data?.ok && view) setView({ ...view, fields: r.data.fields });
    } catch (e: any) {
      setError(e?.message || '건너뛰기 실패');
    }
  };

  const sendMessage = async () => {
    if (!sessionId || !input.trim() || isSending || actionLockRef.current) return;
    const text = input.trim();
    setInput('');
    actionLockRef.current = true;
    setIsSending(true);
    try {
      await axios.post(`${API_BASE_URL}/applications/${sessionId}/chat`, { message: text });
    } catch (e: any) {
      setError(e?.message || '전송 실패');
    } finally {
      setIsSending(false);
      actionLockRef.current = false;
    }
  };

  const chooseAttachment = async (cand: CandidateAttachment) => {
    if (!sessionId || isChoosingAttachment) return;
    setIsChoosingAttachment(true);
    try {
      await axios.post(`${API_BASE_URL}/applications/${sessionId}/choose-attachment`, {
        url: cand.url,
        fileName: cand.fileName,
      });
    } catch (e: any) {
      setError(e?.message || '첨부 선택 실패');
    } finally {
      setIsChoosingAttachment(false);
    }
  };

  const askNextQuestion = async () => {
    if (!sessionId || autoAskInFlightRef.current) return;
    autoAskInFlightRef.current = true;
    setIsSending(true);
    try {
      await axios.post(`${API_BASE_URL}/applications/${sessionId}/chat`, { message: '' });
    } finally {
      autoAskInFlightRef.current = false;
      setIsSending(false);
    }
  };

  // 채팅에서 지금 묻고 있는(즉, 미수집인) 첫 번째 항목을 한 번에 건너뛰기
  const skipCurrent = async () => {
    if (!sessionId || autoAskInFlightRef.current || actionLockRef.current) return;
    const next = autoFields.find((f) => !f.is_filled && !f.is_skipped);
    if (!next) return;
    actionLockRef.current = true;
    setIsSending(true);
    try {
      await axios.post(`${API_BASE_URL}/applications/${sessionId}/field/skip`, {
        fieldId: next.id, skip: true,
      });
      // 건너뛴 뒤 다음 질문 이어가기
      await askNextQuestion();
    } catch (e: any) {
      setError(e?.message || '건너뛰기 실패');
    } finally {
      setIsSending(false);
      actionLockRef.current = false;
    }
  };

  useEffect(() => {
    if (status !== 'collecting' || !view || isSending || autoAskInFlightRef.current) return;
    if (handledFields >= totalFields || view.fields.length === 0) return;
    // 자동 질문은 "아직 assistant 메시지가 전혀 없을 때" 초기 1회만 실행
    const hasAnyAssistant = (view.messages || []).some((m) => m.role === 'assistant');
    if (!hasAnyAssistant) askNextQuestion();
  }, [status, view, handledFields, totalFields, isSending]);

  const finalize = async () => {
    if (!sessionId || isFinalizing) return;
    setIsFinalizing(true);
    try {
      const r = await axios.post(`${API_BASE_URL}/applications/${sessionId}/finalize`);
      if (!r.data?.ok) setError(r.data?.error || '작성 완료 처리 실패');
    } catch (e: any) {
      setError(e?.message || '작성 완료 처리 실패');
    } finally {
      setIsFinalizing(false);
    }
  };

  return (
    <div className="mt-3 border border-indigo-200 rounded-2xl bg-white overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-gradient-to-r from-indigo-50 to-blue-50 border-b border-indigo-100">
        <div className="flex items-center gap-2">
          <Bot size={14} className="text-indigo-600" />
          <span className="text-xs font-bold text-indigo-700">AI 신청서 작성 도우미</span>
          <span className="text-[10px] text-slate-500">
            · {STATUS_LABELS[status] || status}
          </span>
        </div>
        {totalFields > 0 && (
          <div className="text-[10px] text-slate-600 flex items-center gap-1">
            <span className="font-bold text-indigo-700">{filledFields}</span>
            {skippedFields > 0 && (
              <span className="text-slate-500">+ <span className="font-bold text-amber-600">{skippedFields}</span>건너뜀</span>
            )}
            <span> / {totalFields} 항목</span>
          </div>
        )}
        {onClose && (
          <button onClick={onClose} className="text-xs text-slate-400 hover:text-slate-700 font-bold">
            접기
          </button>
        )}
      </div>
      {!!view?.session?.chosen_attachment_name && (
        <div className="px-4 py-1.5 text-[10px] text-slate-500 border-b border-slate-100 bg-slate-50">
          현재 작성 대상 파일: <span className="font-bold text-slate-700">{view.session.chosen_attachment_name}</span>
        </div>
      )}

      {totalFields > 0 && (
        <div className="h-1 bg-slate-100 flex">
          <div
            className="h-1 bg-gradient-to-r from-indigo-400 to-blue-500 transition-all"
            style={{ width: `${Math.min(100, (filledFields / totalFields) * 100)}%` }}
          />
          {skippedFields > 0 && (
            <div
              className="h-1 bg-amber-300 transition-all"
              style={{ width: `${Math.min(100 - (filledFields / totalFields) * 100, (skippedFields / totalFields) * 100)}%` }}
            />
          )}
        </div>
      )}

      <div ref={scrollRef} className="px-4 py-3 max-h-72 overflow-y-auto space-y-2 text-xs">
        {error && (
          <div className="flex items-start gap-2 text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-2 py-1.5">
            <AlertCircle size={12} className="mt-0.5" />
            <span className="font-bold">{error}</span>
          </div>
        )}
        {(view?.messages || []).map((m) => (
          <MessageBubble key={m.id} role={m.role} content={m.content} />
        ))}
        {!view && !error && (
          <div className="flex items-center gap-2 text-slate-500">
            <Loader2 size={12} className="animate-spin" />
            <span>세션 준비 중…</span>
          </div>
        )}
        {view && PROGRESS_VISIBLE_STATUSES.has(status) && (
          <AnalysisProgressCard session={view.session} />
        )}
        {status === 'awaiting_choice' && view?.candidates && view.candidates.length > 0 && (
          <div className="space-y-2 pt-1">
            <p className="text-[11px] font-bold text-slate-700">아래 후보 중에서 선택해주세요:</p>
            <div className="space-y-1.5">
              {view.candidates.map((c) => (
                <button
                  key={c.url}
                  onClick={() => chooseAttachment(c)}
                  disabled={isChoosingAttachment}
                  className="w-full text-left flex items-center justify-between gap-2 px-3 py-2 border border-slate-200 hover:border-indigo-400 hover:bg-indigo-50/30 rounded-lg disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText size={12} className="text-indigo-500 shrink-0" />
                    <span className="font-bold text-slate-700 truncate">{c.fileName}</span>
                  </div>
                  <span className="text-[10px] text-slate-400 shrink-0">{c.ext} · 점수 {c.score}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {(autoFields.length > 0 || manualFields.length > 0) && status !== 'done' && (
        <div className="px-4 py-2 border-t border-slate-100 bg-slate-50/50 max-h-44 overflow-y-auto space-y-2">
          {autoFields.length > 0 && (
            <div>
              <div className="text-[10px] font-bold text-slate-500 mb-1">
                자동 입력 항목 (클릭해서 직접 수정·건너뛰기 가능)
              </div>
              <div className="flex flex-wrap gap-1.5">
                {autoFields.map((f) => (
                  <FieldChip
                    key={f.id}
                    field={f}
                    isEditing={editingId === f.id}
                    onClick={() => setEditingId(editingId === f.id ? null : f.id)}
                    onSave={async (v) => { await updateField(f.id, v); setEditingId(null); }}
                    onRecommend={() => recommendField(f.id)}
                    onSkip={async () => { await skipField(f.id, true); setEditingId(null); }}
                    onUnskip={async () => { await skipField(f.id, false); }}
                    onCancel={() => setEditingId(null)}
                  />
                ))}
              </div>
            </div>
          )}
          {manualFields.length > 0 && (
            <div>
              <div className="text-[10px] font-bold text-slate-500 mb-1">
                ✍ 직접 작성 필요 (자동 채움 불가 — 인쇄 후 직접 서명/날인)
              </div>
              <div className="flex flex-wrap gap-1.5">
                {manualFields.map((f) => (
                  <span
                    key={f.id}
                    className="text-[10px] px-2 py-0.5 rounded-full border font-bold bg-slate-100 text-slate-500 border-slate-300"
                    title={f.placeholder_text || ''}
                  >
                    <PenLine size={9} className="inline -mt-0.5 mr-0.5" />
                    {f.prompt_label}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="px-3 py-2 border-t border-slate-100 flex items-center gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') sendMessage(); }}
          disabled={!isInteractable}
          placeholder={
            status === 'collecting'
              ? '답변을 입력하세요…'
              : status === 'awaiting_choice'
                ? '위에서 첨부파일을 선택해주세요'
                : '준비 중…'
          }
          className="flex-1 text-xs px-3 py-2 border border-slate-200 rounded-xl focus:outline-none focus:border-indigo-400 disabled:bg-slate-50 disabled:text-slate-400"
        />
        <button
          onClick={sendMessage}
          disabled={!isInteractable || !input.trim()}
          className="text-xs font-bold text-white bg-indigo-500 hover:bg-indigo-600 disabled:bg-slate-300 px-3 py-2 rounded-xl flex items-center gap-1"
        >
          {isSending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
          전송
        </button>
        <button
          onClick={skipCurrent}
          disabled={!isInteractable || handledFields >= totalFields}
          title="현재 묻고 있는 항목을 건너뛰고 다음으로 이동"
          className="text-xs font-bold text-amber-700 bg-amber-50 hover:bg-amber-100 disabled:bg-slate-100 disabled:text-slate-400 border border-amber-200 px-2.5 py-2 rounded-xl flex items-center gap-1"
        >
          <SkipForward size={12} />
          건너뛰기
        </button>
        <button
          onClick={finalize}
          disabled={!allFilled || isFinalizing || status === 'done'}
          className="text-xs font-bold text-white bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-300 px-3 py-2 rounded-xl"
        >
          {status === 'done' ? '완료됨' : isFinalizing ? '생성 중…' : '작성 완료'}
        </button>
      </div>

      {status === 'done' && view?.downloadUrl && (
        <div className="px-3 py-3 border-t border-emerald-100 bg-emerald-50/40">
          <a
            href={view.downloadUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-2 text-xs font-bold text-emerald-700 bg-white border border-emerald-200 hover:bg-emerald-50 rounded-xl py-2"
          >
            <Download size={12} />
            완료된 신청서 다운로드
          </a>
        </div>
      )}
    </div>
  );
};

const AnalysisProgressCard: React.FC<{ session: SessionView['session'] }> = ({ session }) => {
  const stage = session.progress_stage || (session.status === 'crawling' ? 'crawling' : 'queued');
  const isCacheHit = stage === 'cache_hit';
  const defs = isCacheHit ? CACHE_HIT_DEFS : STAGE_DEFS;
  const totalEta = isCacheHit ? CACHE_HIT_TOTAL_ETA_SEC : TOTAL_ETA_SEC;
  const currentIdx = Math.max(0, defs.findIndex((s) => s.key === stage));
  const queuePos = session.queue_position ?? 0;

  // 경과·남은시간
  const startedAt = session.progress_started_at ? new Date(session.progress_started_at).getTime() : null;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  const elapsedSec = startedAt && queuePos === 0 ? Math.max(0, (now - startedAt) / 1000) : 0;
  const remainingSec = Math.max(0, Math.round(totalEta - elapsedSec));

  const percent = Math.max(2, Math.min(100, session.progress_percent ?? 5));

  if (queuePos > 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-slate-100 p-3 space-y-2">
        <div className="flex items-center gap-2 text-slate-700">
          <Hourglass size={14} className="text-slate-500" />
          <span className="font-bold text-[11px]">대기열에 있습니다</span>
        </div>
        <div className="text-[11px] text-slate-600 leading-relaxed">
          현재 앞에 <span className="font-bold text-indigo-700">{queuePos}건</span>의 분석이
          진행 중이라 잠시만 기다려 주세요. (한 번에 한 개씩 처리합니다)
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
          <Clock size={10} />
          <span>예상 대기: 약 {Math.max(15, queuePos * 35)}초</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-xl border ${isCacheHit ? 'border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50' : 'border-indigo-200 bg-gradient-to-br from-indigo-50 to-blue-50'} p-3 space-y-3`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {isCacheHit ? (
            <Sparkles size={14} className="text-emerald-600" />
          ) : (
            <Brain size={14} className="text-indigo-600 animate-pulse" />
          )}
          <span className={`text-[11px] font-bold ${isCacheHit ? 'text-emerald-700' : 'text-indigo-700'}`}>
            {isCacheHit ? '⚡ 빠르게 불러오는 중' : 'AI가 신청서를 분석하고 있어요'}
          </span>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-slate-500">
          <Clock size={10} />
          <span>{remainingSec > 0 ? `약 ${remainingSec}초 남음` : '거의 완료'}</span>
        </div>
      </div>

      {/* progress bar */}
      <div className="h-2 bg-white/60 rounded-full overflow-hidden">
        <div
          className={`h-2 rounded-full transition-all duration-500 ${isCacheHit ? 'bg-gradient-to-r from-emerald-400 to-teal-500' : 'bg-gradient-to-r from-indigo-400 via-blue-500 to-violet-500'}`}
          style={{ width: `${percent}%` }}
        />
      </div>

      {/* stages timeline */}
      <div className="space-y-1.5">
        {defs.map((d, i) => {
          const state = i < currentIdx ? 'done' : i === currentIdx ? 'active' : 'pending';
          const Icon = d.Icon;
          const colorClass = state === 'done'
            ? 'text-emerald-600 bg-emerald-100'
            : state === 'active'
              ? STAGE_COLOR_CLASSES[d.color] || STAGE_COLOR_CLASSES.indigo
              : 'text-slate-400 bg-slate-100';
          const labelClass = state === 'pending' ? 'text-slate-400' : state === 'active' ? 'font-bold text-slate-800' : 'text-slate-600';
          return (
            <div key={d.key} className="flex items-center gap-2">
              <div className={`w-5 h-5 rounded-full flex items-center justify-center ${colorClass}`}>
                {state === 'done' ? (
                  <CheckCircle2 size={12} />
                ) : state === 'active' ? (
                  <Icon size={11} className="animate-pulse" />
                ) : (
                  <Icon size={11} />
                )}
              </div>
              <span className={`text-[11px] ${labelClass}`}>{d.label}</span>
              {state === 'active' && (
                <Loader2 size={10} className="animate-spin text-slate-400 ml-auto" />
              )}
            </div>
          );
        })}
      </div>

      {!isCacheHit && (
        <div className="text-[10px] text-slate-500 italic leading-relaxed">
          💡 AI가 처음 분석하는 신청서는 25~50초 정도 걸려요. 다음에 같은 신청서를 요청하면 즉시 불러옵니다.
        </div>
      )}
    </div>
  );
};

function parseLocation(loc: ApplicationField['location_json']): FieldLocation {
  if (!loc) return {};
  if (typeof loc === 'string') {
    try { return JSON.parse(loc) as FieldLocation; } catch { return {}; }
  }
  return loc;
}

const KIND_META: Record<string, { label: string; Icon: React.FC<any>; bg: string; text: string; border: string }> = {
  text: { label: '텍스트', Icon: Pencil, bg: 'bg-slate-50', text: 'text-slate-700', border: 'border-slate-300' },
  longtext: { label: '긴 글', Icon: FileText, bg: 'bg-violet-50', text: 'text-violet-700', border: 'border-violet-300' },
  number: { label: '숫자', Icon: Hash, bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-300' },
  date: { label: '날짜', Icon: Calendar, bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-300' },
  phone: { label: '전화', Icon: Phone, bg: 'bg-cyan-50', text: 'text-cyan-700', border: 'border-cyan-300' },
  email: { label: '이메일', Icon: Mail, bg: 'bg-fuchsia-50', text: 'text-fuchsia-700', border: 'border-fuchsia-300' },
  biz_no: { label: '사업자번호', Icon: Building2, bg: 'bg-teal-50', text: 'text-teal-700', border: 'border-teal-300' },
  checkbox: { label: '다중선택', Icon: CheckCircle2, bg: 'bg-lime-50', text: 'text-lime-700', border: 'border-lime-300' },
  radio: { label: '선택', Icon: CheckCircle2, bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-300' },
  signature: { label: '서명', Icon: PenLine, bg: 'bg-slate-100', text: 'text-slate-500', border: 'border-slate-300' },
};

const FieldChip: React.FC<{
  field: ApplicationField;
  isEditing: boolean;
  onClick: () => void;
  onSave: (v: string) => Promise<void> | void;
  onRecommend: () => Promise<string[]>;
  onSkip: () => Promise<void> | void;
  onUnskip: () => Promise<void> | void;
  onCancel: () => void;
}> = ({ field, isEditing, onClick, onSave, onRecommend, onSkip, onUnskip, onCancel }) => {
  const meta = parseLocation(field.location_json);
  const kindKey = String(meta.input_type || field.kind || 'text').toLowerCase();
  const km = KIND_META[kindKey] || KIND_META.text;
  const Icon = km.Icon;
  const filled = !!(field.is_filled && field.value);
  const skipped = !!field.is_skipped;

  if (!isEditing) {
    return (
      <button
        onClick={onClick}
        className={`text-[10px] px-2 py-0.5 rounded-full border font-bold flex items-center gap-1 ${
          filled
            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
            : skipped
              ? 'bg-amber-50 text-amber-700 border-amber-200 opacity-80'
              : `${km.bg} ${km.text} ${km.border}`
        }`}
        title={
          skipped
            ? '건너뜀 — 클릭해서 다시 입력하기'
            : field.value || field.placeholder_text || km.label
        }
      >
        {filled ? (
          <CheckCircle2 size={9} />
        ) : skipped ? (
          <SkipForward size={9} />
        ) : (
          <Icon size={9} />
        )}
        <span className={`truncate max-w-[10rem] ${skipped ? 'line-through decoration-amber-400/70' : ''}`}>
          {field.prompt_label}
        </span>
        {filled && field.value && (
          <span className="font-normal text-emerald-600/80 truncate max-w-[8rem]">: {field.value}</span>
        )}
        {skipped && (
          <span className="font-normal text-amber-600/80">: 건너뜀</span>
        )}
      </button>
    );
  }

  return (
    <FieldEditor
      field={field}
      kind={kindKey}
      options={Array.isArray(meta.options) ? meta.options : null}
      onSave={onSave}
      onRecommend={onRecommend}
      onSkip={onSkip}
      onUnskip={onUnskip}
      onCancel={onCancel}
    />
  );
};

const FieldEditor: React.FC<{
  field: ApplicationField;
  kind: string;
  options: string[] | null;
  onSave: (v: string) => Promise<void> | void;
  onRecommend: () => Promise<string[]>;
  onSkip: () => Promise<void> | void;
  onUnskip: () => Promise<void> | void;
  onCancel: () => void;
}> = ({ field, kind, options, onSave, onRecommend, onSkip, onUnskip, onCancel }) => {
  const [value, setValue] = useState<string>(field.value || '');
  const [busy, setBusy] = useState(false);
  const skipped = !!field.is_skipped;
  const [suggestions, setSuggestions] = useState<string[]>([]);

  const submit = async () => {
    setBusy(true);
    try { await onSave(value.trim()); } finally { setBusy(false); }
  };
  const doSkip = async () => {
    setBusy(true);
    try { await onSkip(); } finally { setBusy(false); }
  };
  const doUnskip = async () => {
    setBusy(true);
    try { await onUnskip(); } finally { setBusy(false); }
  };
  const getSuggestions = async () => {
    setBusy(true);
    try {
      const out = await onRecommend();
      setSuggestions(out);
    } finally {
      setBusy(false);
    }
  };

  const km = KIND_META[kind] || KIND_META.text;

  let editor: React.ReactNode;
  if (kind === 'longtext') {
    editor = (
      <textarea
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={3}
        placeholder={field.placeholder_text || ''}
        className="w-72 text-xs px-2 py-1 border border-slate-200 rounded focus:outline-none focus:border-indigo-400"
      />
    );
  } else if (kind === 'date') {
    editor = (
      <input autoFocus type="date" value={value} onChange={(e) => setValue(e.target.value)}
        className="text-xs px-2 py-1 border border-slate-200 rounded focus:outline-none focus:border-indigo-400" />
    );
  } else if (kind === 'number') {
    editor = (
      <input autoFocus type="number" value={value} onChange={(e) => setValue(e.target.value)}
        placeholder={field.placeholder_text || ''}
        className="w-32 text-xs px-2 py-1 border border-slate-200 rounded focus:outline-none focus:border-indigo-400" />
    );
  } else if (kind === 'email') {
    editor = (
      <input autoFocus type="email" value={value} onChange={(e) => setValue(e.target.value)}
        placeholder={field.placeholder_text || 'name@example.com'}
        className="w-56 text-xs px-2 py-1 border border-slate-200 rounded focus:outline-none focus:border-indigo-400" />
    );
  } else if (kind === 'phone') {
    editor = (
      <input autoFocus type="tel" value={value} onChange={(e) => setValue(formatPhone(e.target.value))}
        placeholder="010-1234-5678"
        className="w-40 text-xs px-2 py-1 border border-slate-200 rounded focus:outline-none focus:border-indigo-400" />
    );
  } else if (kind === 'biz_no') {
    editor = (
      <input autoFocus type="text" value={value} onChange={(e) => setValue(formatBizNo(e.target.value))}
        placeholder="123-45-67890"
        className="w-40 text-xs px-2 py-1 border border-slate-200 rounded focus:outline-none focus:border-indigo-400" />
    );
  } else if (kind === 'checkbox' && options && options.length > 0) {
    const selected = new Set(value.split(/[,;|/]+/).map((s) => s.trim()).filter(Boolean));
    editor = (
      <div className="flex flex-wrap gap-1 max-w-72">
        {options.map((opt) => {
          const on = selected.has(opt);
          return (
            <button
              key={opt}
              type="button"
              onClick={() => {
                if (on) selected.delete(opt); else selected.add(opt);
                setValue(Array.from(selected).join(', '));
              }}
              className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${
                on ? 'bg-indigo-500 text-white border-indigo-500' : 'bg-white text-slate-600 border-slate-300'
              }`}
            >
              {on ? '☑' : '☐'} {opt}
            </button>
          );
        })}
      </div>
    );
  } else if (kind === 'radio' && options && options.length > 0) {
    editor = (
      <div className="flex flex-wrap gap-1 max-w-72">
        {options.map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => setValue(opt)}
            className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${
              value === opt ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-slate-600 border-slate-300'
            }`}
          >
            {value === opt ? '●' : '○'} {opt}
          </button>
        ))}
      </div>
    );
  } else {
    editor = (
      <input autoFocus type="text" value={value} onChange={(e) => setValue(e.target.value)}
        placeholder={field.placeholder_text || ''}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        className="w-56 text-xs px-2 py-1 border border-slate-200 rounded focus:outline-none focus:border-indigo-400" />
    );
  }

  return (
    <div className={`flex items-start gap-1.5 p-1.5 rounded-lg border ${km.bg} ${km.border}`}>
      <div className="flex flex-col gap-0.5">
        <span className={`text-[10px] font-bold ${km.text} flex items-center gap-1`}>
          <km.Icon size={9} /> {field.prompt_label}
          <span className="text-slate-400 font-normal">· {km.label}</span>
          {skipped && (
            <span className="text-amber-600 font-bold">· 건너뜀</span>
          )}
        </span>
        {editor}
      </div>
      <div className="self-center flex items-center gap-1">
        <button onClick={getSuggestions} disabled={busy}
          title="현재 항목에 맞는 추천 문구 보기"
          className="text-[10px] font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 disabled:bg-slate-200 border border-indigo-200 px-2 py-1 rounded">
          추천문구
        </button>
        <button onClick={submit} disabled={busy}
          title={skipped ? '값을 입력하면 건너뛰기가 자동 해제돼요' : '저장'}
          className="text-[10px] font-bold text-white bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-300 px-2 py-1 rounded">
          {busy ? '저장…' : '저장'}
        </button>
        {skipped ? (
          <button onClick={doUnskip} disabled={busy}
            title="건너뛰기 취소 — 다시 입력 대기 상태로 되돌립니다"
            className="text-[10px] font-bold text-amber-700 bg-amber-100 hover:bg-amber-200 disabled:bg-slate-200 px-2 py-1 rounded flex items-center gap-1">
            <RotateCcw size={10} /> 취소
          </button>
        ) : (
          <button onClick={doSkip} disabled={busy}
            title="이 항목을 건너뛰고 인쇄 후 직접 채울게요"
            className="text-[10px] font-bold text-amber-700 bg-amber-50 hover:bg-amber-100 disabled:bg-slate-200 border border-amber-200 px-2 py-1 rounded flex items-center gap-1">
            <SkipForward size={10} /> 건너뛰기
          </button>
        )}
      </div>
      <button onClick={onCancel} disabled={busy}
        className="self-center text-slate-400 hover:text-slate-700">
        <X size={12} />
      </button>
      {suggestions.length > 0 && (
        <div className="w-full mt-1 flex flex-wrap gap-1">
          {suggestions.map((s, idx) => (
            <button
              key={`${idx}-${s.slice(0, 16)}`}
              type="button"
              onClick={() => setValue(s)}
              className="text-[10px] px-2 py-1 rounded border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-left"
              title="클릭하면 입력칸에 채웁니다"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

function formatPhone(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length < 4) return d;
  if (d.length < 8) return `${d.slice(0, 3)}-${d.slice(3)}`;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
}
function formatBizNo(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 10);
  if (d.length < 4) return d;
  if (d.length < 6) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
}

const MessageBubble: React.FC<{ role: string; content: string }> = ({ role, content }) => {
  if (role === 'system') {
    return (
      <div className="text-[10px] text-slate-400 italic text-center">
        — {content} —
      </div>
    );
  }
  const isUser = role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] px-3 py-2 rounded-2xl whitespace-pre-wrap leading-relaxed ${
          isUser
            ? 'bg-indigo-500 text-white rounded-tr-sm'
            : 'bg-slate-100 text-slate-700 rounded-tl-sm'
        }`}
      >
        {content}
      </div>
    </div>
  );
};

export default ApplicationChatPanel;
