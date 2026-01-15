import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, Lock, User, ShieldCheck, ArrowRight, CheckCircle2 } from 'lucide-react';

const Signup = () => {
  const [formData, setFormData] = useState({ name: '', email: '', password: '', confirmPassword: '' });
  const navigate = useNavigate();
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-slate-50 font-sans text-slate-900 py-12">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[10%] -left-[10%] w-[40%] h-[40%] bg-blue-100/50 rounded-full blur-[120px]" />
      </div>

      <div className="relative w-full max-w-[480px] px-6">
        <div className="text-center mb-12">
           <div className="inline-flex items-center justify-center w-20 h-20 bg-blue-950 text-white rounded-[24px] shadow-2xl shadow-blue-900/20 mb-6">
                      <ShieldCheck size={40} strokeWidth={1.5} />
            </div>
          <h1 className="text-3xl font-black text-blue-950 italic tracking-tighter">SBC 365</h1>
          <p className="text-[11px] text-blue-600 font-bold uppercase tracking-[0.35em] mt-2">Create New Account</p>
        </div>

        <div className="bg-white p-10 rounded-[40px] shadow-2xl shadow-blue-900/5 border border-white">
          <h2 className="text-2xl font-black text-slate-800 mb-2">계정 만들기</h2>
          <p className="text-sm text-slate-400 font-bold mb-8">상권 분석의 정석, SBC 365에 오신 것을 환영합니다.</p>
          
          <form className="space-y-5">
            <div className="space-y-2">
              <label className="text-[11px] font-black text-slate-400 ml-1 uppercase tracking-widest">Full Name</label>
              <div className="relative group">
                <User className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-blue-600 transition-colors" size={18} />
                <input type="text" placeholder="홍길동" className="w-full pl-12 pr-4 py-4 bg-slate-50 border-2 border-transparent rounded-2xl text-sm font-bold focus:border-blue-600 focus:bg-white transition-all outline-none" />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[11px] font-black text-slate-400 ml-1 uppercase tracking-widest">Email Address</label>
              <div className="relative group">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-blue-600 transition-colors" size={18} />
                <input type="email" placeholder="example@sbc365.com" className="w-full pl-12 pr-4 py-4 bg-slate-50 border-2 border-transparent rounded-2xl text-sm font-bold focus:border-blue-600 focus:bg-white transition-all outline-none" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-[11px] font-black text-slate-400 ml-1 uppercase tracking-widest">Password</label>
                <div className="relative group">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-blue-600 transition-colors" size={18} />
                  <input type="password" placeholder="••••" className="w-full pl-12 pr-4 py-4 bg-slate-50 border-2 border-transparent rounded-2xl text-sm font-bold focus:border-blue-600 focus:bg-white transition-all outline-none" />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[11px] font-black text-slate-400 ml-1 uppercase tracking-widest">Confirm</label>
                <div className="relative group">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-blue-600 transition-colors" size={18} />
                  <input type="password" placeholder="••••" className="w-full pl-12 pr-4 py-4 bg-slate-50 border-2 border-transparent rounded-2xl text-sm font-bold focus:border-blue-600 focus:bg-white transition-all outline-none" />
                </div>
              </div>
            </div>

            <button 
            onClick={() => navigate('/login')}
            type="submit" className="w-full bg-blue-950 text-white py-5 rounded-[20px] text-base font-black flex items-center justify-center gap-3 hover:bg-blue-900 transition-all shadow-xl shadow-blue-900/10 active:scale-[0.98] mt-4">
              회원가입 완료
              <ArrowRight size={20} />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
export default Signup;