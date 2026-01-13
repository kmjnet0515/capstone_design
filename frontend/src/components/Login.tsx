import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, Lock, Eye, EyeOff, ArrowRight, ShieldCheck, CheckCircle2 } from 'lucide-react';

const Login = () => {
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState({ email: '', password: '' });

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    console.log("로그인 시도 데이터:", formData);
    // 여기에 Auth API 연동 로직이 들어갑니다.
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-slate-50 font-sans text-slate-900">
      
      {/* 배경 장식 (분석 페이지의 세련된 느낌 유지) */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[10%] -left-[10%] w-[40%] h-[40%] bg-blue-100/50 rounded-full blur-[120px]" />
        <div className="absolute -bottom-[10%] -right-[10%] w-[40%] h-[40%] bg-blue-50/80 rounded-full blur-[120px]" />
      </div>

      <div className="relative w-full max-w-[460px] px-6">
        
        {/* 상단 로고 영역 */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-blue-950 text-white rounded-[24px] shadow-2xl shadow-blue-900/20 mb-6">
            <ShieldCheck size={40} strokeWidth={1.5} />
          </div>
          <h1 className="text-4xl font-black text-blue-950 italic tracking-tighter">SBC 365</h1>
          <p className="text-[11px] text-blue-600 font-bold uppercase tracking-[0.35em] mt-3 opacity-80">
            Intelligence Market Analysis Platform
          </p>
        </div>

        {/* 로그인 카드 */}
        <div className="bg-white p-10 rounded-[40px] shadow-[0_20px_50px_rgba(0,0,0,0.05)] border border-white">
          <div className="mb-8">
            <h2 className="text-2xl font-black text-slate-800 tracking-tight">서비스 로그인</h2>
            <p className="text-sm text-slate-400 font-bold mt-1">계정 정보를 입력하여 분석을 시작하세요.</p>
          </div>
          
          <form onSubmit={handleLogin} className="space-y-5">
            {/* 이메일 필드 */}
            <div className="space-y-2">
              <label className="text-[11px] font-black text-slate-400 ml-1 uppercase tracking-widest">Email Address</label>
              <div className="relative group">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-blue-600 transition-colors">
                  <Mail size={18} />
                </div>
                <input 
                  type="email" 
                  placeholder="admin@sbc365.com"
                  className="w-full pl-12 pr-4 py-4 bg-slate-50 border-2 border-transparent rounded-2xl text-sm font-bold focus:border-blue-600 focus:bg-white transition-all outline-none"
                  onChange={(e) => setFormData({...formData, email: e.target.value})}
                  required
                />
              </div>
            </div>

            {/* 비밀번호 필드 */}
            <div className="space-y-2">
              <div className="flex justify-between items-center ml-1">
                <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Password</label>
                <button 
                onClick={() => navigate('/changepassword')} 
                type="button" className="text-[11px] font-black text-blue-600 hover:text-blue-800 transition-colors">PW 재설정</button>
              </div>
              <div className="relative group">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-blue-600 transition-colors">
                  <Lock size={18} />
                </div>
                <input 
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  className="w-full pl-12 pr-12 py-4 bg-slate-50 border-2 border-transparent rounded-2xl text-sm font-bold focus:border-blue-600 focus:bg-white transition-all outline-none"
                  onChange={(e) => setFormData({...formData, password: e.target.value})}
                  required
                />
                <button 
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-600 transition-colors"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {/* 자동 로그인 체크박스 */}
            <div className="flex items-center gap-2 ml-1 pb-2">
              <input type="checkbox" id="remember" className="w-4 h-4 rounded border-slate-200 text-blue-600 focus:ring-blue-600" />
              <label htmlFor="remember" className="text-[12px] font-bold text-slate-500 cursor-pointer select-none">로그인 상태 유지</label>
            </div>

            {/* 로그인 버튼 */}
            <button 
              type="submit"
              className="w-full bg-blue-950 text-white py-5 rounded-[20px] text-base font-black flex items-center justify-center gap-3 hover:bg-blue-900 transition-all shadow-xl shadow-blue-900/10 active:scale-[0.98]"
            >
              분석 대시보드 입장
              <ArrowRight size={20} />
            </button>
          </form>

          {/* 회원가입 유도 */}
          <div className="mt-8 pt-8 border-t border-slate-50 text-center">
            <p className="text-sm text-slate-500 font-bold">
              아직 회원이 아니신가요? 
              <button 
                onClick={() => navigate('/signup')} // 이동 경로에 맞춰 수정
                className="ml-2 text-blue-600 hover:text-blue-800 underline decoration-2 underline-offset-4 transition-colors"
              >
                회원가입 신청
              </button>
            </p>
          </div>
        </div>

        {/* 푸터 카피라이트 */}
        <div className="mt-12 flex flex-col items-center gap-2 opacity-30">
          <div className="flex items-center gap-1.5 text-blue-950">
            <CheckCircle2 size={14} />
            <span className="text-[10px] font-black uppercase tracking-tighter">Certified Analytics System</span>
          </div>
          <p className="text-[10px] text-slate-500 font-medium">
            &copy; 2026 SBC 365 Analytics Group. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;