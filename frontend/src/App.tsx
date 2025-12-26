import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Header from './components/Header';
import AnalysisPage from './pages/AnalysisPage';
import RecommendationPage from './pages/RecommendationPage';

function App() {
  return (
    <Router>
      <div className="flex flex-col h-screen w-full overflow-hidden font-sans antialiased text-gray-900">
        <Header />
        <main className="flex-1 overflow-hidden">
          <Routes>
            <Route path="/" element={<AnalysisPage />} />
            <Route path="/analysis" element={<AnalysisPage />} />
            <Route path="/recommendation" element={<RecommendationPage />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;