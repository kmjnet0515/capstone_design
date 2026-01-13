import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Header from './components/Header';
import Login from './components/Login';
import Signup from './components/Signup';
import ChangePassword from './components/Changepassword';
import AnalysisPage from './pages/AnalysisPage';
import RecommendationPage from './pages/RecommendationPage';

function App() {
  return (
    <Router>
      <div className="flex flex-col h-screen w-full overflow-hidden font-sans antialiased text-gray-900 bg-slate-50">
        <Header />
        <main className="flex-1 overflow-hidden relative">
          <Routes>
            {/* 분석 및 추천 페이지 */}
            <Route path="/" element={<AnalysisPage />} />
            <Route path="/analysis" element={<AnalysisPage />} />
            <Route path="/recommendation" element={<RecommendationPage />} />

            {/* 인증 관련 페이지 */}
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/changepassword" element={<ChangePassword />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;