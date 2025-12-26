const RecommendationPage = () => {
  return (
    <div className="h-full flex flex-col items-center justify-center bg-gray-50">
      <div className="bg-white p-10 rounded-3xl shadow-xl text-center border border-gray-100 max-w-md">
        <h2 className="text-2xl font-black text-gray-800 mb-4">AI 창업 추천 시스템</h2>
        <p className="text-gray-500 leading-relaxed mb-8 font-medium">
          보유 자본금과 희망 상권을 입력하시면<br />
          빅데이터 기반 최적의 업종을 추천해 드립니다.
        </p>
        <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
          <div className="w-1/3 h-full bg-[#002c5f]"></div>
        </div>
        <p className="mt-4 text-xs text-gray-400">현재 서비스 준비 중입니다.</p>
      </div>
    </div>
  );
};

export default RecommendationPage;