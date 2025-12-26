// backend/server.js
const express = require('express');
const cors = require('cors');
const app = express();
const PORT = 5000; // 백엔드 포트 설정

// 미들웨어 설정
app.use(cors()); // 모든 도메인에서의 요청 허용 (나중에 보안을 위해 특정 도메인만 허용 가능)
app.use(express.json()); // JSON 데이터 파싱

// 테스트용 API 라우트
app.get('/api/test', (req, res) => {
  res.json({ message: '백엔드와 성공적으로 연결되었습니다! (Node.js Server)' });
});

// 서버 실행
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

