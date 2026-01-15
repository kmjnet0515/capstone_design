import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RefreshCw, ChevronLeft, ShieldCheck, Lock, ArrowRight, CheckCircle2 } from 'lucide-react';

const Changepassword = () => {
  const navigate = useNavigate();
  // 1: 현재 계정 인증, 2: 새 비밀번호 설정
  const [step, setStep] = useState(1);
  const [authData, setAuthData] = useState({ email: '', currentPassword: '' });

  const handleVerifyCurrentAuth = (e: React.FormEvent) => {
    e.preventDefault();
    // API 연동: 현재 이메일과 비밀번호가 맞는지 확인
    console.log("인증 시도:", authData);
    setStep(2); 
  };

  const handleUpdatePassword = (e: React.FormEvent) => {
    e.preventDefault();
    console.log("비밀번호 변경 프로세스 완료");
    alert("비밀번호가 성공적으로 변경되었습니다.");
    navigate('/login');
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-slate-50 font-sans text-slate-900">
      <div className="relative w-full max-w-[440px] px-6">
        
        <button
          onClick={() => step === 1 ? navigate('/login') : setStep(1)} 
          className="flex items-center gap-2 text-slate-400 hover:text-blue-600 font-bold text-sm mb-8 transition-colors"
        >
          <ChevronLeft size={20} /> {step === 1 ? '로그인으로' : '이전 단계'}
        </button>

        <div className="bg-white p-10 rounded-[40px] shadow-2xl shadow-blue-900/5 border border-white">
          {/* 상단 아이콘 상태바 */}
          <div className="flex items-center gap-4 mb-8">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-colors ${step === 1 ? 'bg-blue-950 text-white' : 'bg-slate-100 text-slate-400'}`}>
              <ShieldCheck size={24} />
            </div>
            <div className="h-px w-8 bg-slate-200" />
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-colors ${step === 2 ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-400'}`}>
              <Lock size={24} />
            </div>
          </div>
          
          <h2 className="text-2xl font-black text-slate-800 mb-2">
            {step === 1 ? '현재 정보 확인' : '새 비밀번호 설정'}
          </h2>
          <p className="text-sm text-slate-400 font-bold mb-10">
            {step === 1 ? '본인 확인을 위해 현재 비밀번호가 필요합니다.' : '기존과 다른 새로운 비밀번호를 입력해 주세요.'}
          </p>

          {/* 1단계: 아이디 & 현재 비번 인증 */}
          {step === 1 && (
            <form onSubmit={handleVerifyCurrentAuth} className="space-y-5">
              <div className="space-y-2">
                <label className="text-[11px] font-black text-slate-400 ml-1 uppercase tracking-widest">Email Address</label>
                <input 
                  type="email" 
                  required
                  placeholder="email@sbc365.com"
                  className="w-full px-6 py-4 bg-slate-50 border-2 border-transparent rounded-2xl text-sm font-bold focus:border-blue-950 focus:bg-white transition-all outline-none" 
                  onChange={(e) => setAuthData({...authData, email: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <label className="text-[11px] font-black text-slate-400 ml-1 uppercase tracking-widest">Current Password</label>
                <input 
                  type="password" 
                  required
                  placeholder="현재 비밀번호"
                  className="w-full px-6 py-4 bg-slate-50 border-2 border-transparent rounded-2xl text-sm font-bold focus:border-blue-950 focus:bg-white transition-all outline-none" 
                  onChange={(e) => setAuthData({...authData, currentPassword: e.target.value})}
                />
              </div>
              <button type="submit" className="w-full bg-blue-950 text-white py-5 rounded-[20px] text-base font-black flex items-center justify-center gap-2 hover:bg-blue-900 transition-all shadow-xl shadow-blue-900/10 active:scale-[0.98]">
                정보 확인 <ArrowRight size={18} />
              </button>
            </form>
          )}

          {/* 2단계: 새 비밀번호 입력 */}
          {step === 2 && (
            <form onSubmit={handleUpdatePassword} className="space-y-5">
              <div className="space-y-2">
                <label className="text-[11px] font-black text-slate-400 ml-1 uppercase tracking-widest">New Password</label>
                <input type="password" placeholder="새 비밀번호 입력" className="w-full px-6 py-4 bg-slate-50 border-2 border-transparent rounded-2xl text-sm font-bold focus:border-blue-600 focus:bg-white transition-all outline-none" required />
              </div>

              <div className="space-y-2">
                <label className="text-[11px] font-black text-slate-400 ml-1 uppercase tracking-widest">Confirm New Password</label>
                <input type="password" placeholder="새 비밀번호 확인" className="w-full px-6 py-4 bg-slate-50 border-2 border-transparent rounded-2xl text-sm font-bold focus:border-blue-600 focus:bg-white transition-all outline-none" required />
              </div>

              <div className="bg-blue-50/50 p-4 rounded-2xl flex items-start gap-3">
                <CheckCircle2 size={16} className="text-blue-600 mt-0.5" />
                <p className="text-[12px] text-blue-800 font-medium leading-relaxed">
                  인증이 완료되었습니다. 이제 안전한 새 비밀번호를 설정하실 수 있습니다.
                </p>
              </div>

              <button type="submit" className="w-full bg-blue-600 text-white py-5 rounded-[20px] text-base font-black hover:bg-blue-700 transition-all shadow-xl shadow-blue-600/10 active:scale-[0.98]">
                비밀번호 최종 변경
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default Changepassword;