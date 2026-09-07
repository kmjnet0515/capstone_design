import { useNavigate } from 'react-router-dom';
import { Search, User, Map, BarChart3 } from 'lucide-react';

const Header = () => {
  const navigate = useNavigate();

  return (
    <header className="h-16 bg-[#002c5f] text-white flex items-center justify-between px-8 z-50 shrink-0 shadow-md">
      <div className="text-xl font-bold cursor-pointer flex items-center gap-2" onClick={() => navigate('/')}>
        <span className="text-yellow-400 font-extrabold">SBC</span> 365 분석시스템
      </div>
      
      <nav className="flex gap-10">
        <button onClick={() => navigate('/analysis')} className="flex items-center gap-1 hover:text-yellow-200 font-medium transition-colors">
          <Map size={18} /> 상권분석
        </button>
        <button onClick={() => navigate('/recommendation')} className="flex items-center gap-1 hover:text-yellow-200 font-medium transition-colors">
          <BarChart3 size={18} /> 업종추천
        </button>
      </nav>

      <div className="flex items-center gap-4">
        <Search className="cursor-pointer w-5 h-5 hover:text-gray-300" />
        <User 
        className="cursor-pointer w-5 h-5 hover:text-gray-300"
        onClick={ () => navigate('./login')}
        />
      </div>
    </header>
  );
};

export default Header;