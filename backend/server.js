const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
require('dotenv').config();

const axios = require('axios');
const app = express();
app.use(cors());
app.use(express.json());

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// 1. 서버 연결 확인용 테스트 API
app.get('/api/test', (req, res) => {
    res.json({ message: "서버가 잘 작동하고 있습니다!" });
});

// 2. 지역별 상권 개수 조회 API (방금 SQL로 하신 것)
app.get('/api/stats/region', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT sido_name, COUNT(*) as cnt 
            FROM market_info 
            GROUP BY sido_name 
            ORDER BY cnt DESC
        `);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`🚀 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
});

// 대분류 목록 조회
app.get('/api/categories/large', async (req, res) => {
    const [rows] = await pool.query('SELECT DISTINCT large_name FROM categories ORDER BY large_name');
    res.json(rows.map(row => row.large_name));
});

// 중분류 조회
app.get('/api/categories/mid/:largeName', async (req, res) => {
    const [rows] = await pool.query(
        'SELECT DISTINCT mid_name FROM categories WHERE large_name = ? ORDER BY mid_name',
        [req.params.largeName]
    );
    res.json(rows.map(row => row.mid_name));
});

// 소분류 조회
app.get('/api/categories/small/:midName', async (req, res) => {
    const [rows] = await pool.query(
        'SELECT DISTINCT small_name FROM categories WHERE mid_name = ? ORDER BY small_name',
        [req.params.midName]
    );
    res.json(rows.map(row => row.small_name));
});

app.get('/api/market/search', async (req, res) => {
    const { lat, lng, radius, smallCat } = req.query;
    
    // 1도당 약 111km이므로, 반경(m)을 위경도 도 단위로 근사치 변환
    const offset = radius / 111000; 
    const minLat = parseFloat(lat) - offset;
    const maxLat = parseFloat(lat) + offset;
    const minLon = parseFloat(lng) - offset;
    const maxLon = parseFloat(lng) + offset;

    try {
        const query = `
            SELECT 
                store_name, category_small_name, address_road, lat, lon,
                ST_Distance_Sphere(point(lon, lat), point(?, ?)) AS distance
            FROM market_info
            WHERE category_small_name = ?
              AND lat BETWEEN ? AND ?  
              AND lon BETWEEN ? AND ? 
            HAVING distance <= ?
            ORDER BY distance ASC
            LIMIT 200;
        `;

        const [rows] = await pool.query(query, [
            lng, lat, smallCat, 
            minLat, maxLat, minLon, maxLon, 
            radius
        ]);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/estate/rent-trend', async (req, res) => {
    const { regionCode } = req.query; // 법정동 코드 앞 5자리 (예: 48123 - 창원시)
    
    const SERVICE_KEY = process.env.REB_SERVICE_KEY;
    const API_URL = 'http://api.reb.or.kr/openapi/services/rest/CommercialRentTrendService/getRegionRentTrend';

    try {
        const response = await axios.get(API_URL, {
            params: {
                serviceKey: SERVICE_KEY,
                startMonth: '202401', // 시작월 (보통 분기별 데이터)
                endMonth: '202501',   // 종료월
                regionCode: regionCode || '48123', // 기본값 창원시 (필요시 프론트에서 전달)
                itemCode: 'R01',      // R01: 오피스, R02: 중대형상가, R03: 소규모상가
            }
        });

        // 공공데이터 API는 보통 XML로 응답하거나 데이터 구조가 복잡할 수 있습니다.
        // 한국부동산원 API 응답 구조에 맞게 데이터를 정리하여 반환합니다.
        const items = response.data?.response?.body?.items?.item || [];
        res.json(items);
    } catch (err) {
        console.error("부동산 API 호출 에러:", err.message);
        res.status(500).json({ error: "부동산 데이터를 가져오는데 실패했습니다." });
    }
});

// [신규] 부동산 추천 점수 산출 로직 (예시)
app.get('/api/market/recommend', async (req, res) => {
    const { lat, lng, radius, smallCat } = req.query;

    try {
        // 1. 기존 상권 데이터 조회 (경쟁 업체 수 파악용)
        const [markets] = await pool.query(
            `SELECT COUNT(*) as count FROM market_info 
             WHERE category_small_name = ? 
             AND ST_Distance_Sphere(point(lon, lat), point(?, ?)) <= ?`,
            [smallCat, lng, lat, radius]
        );

        // 2. 추천 로직 예시 (간단한 수식)
        // 경쟁업체가 적을수록, 유동인구가 많을수록 점수 상승
        // 실제 프로젝트에서는 부동산원 임대료 데이터와 결합하여 (임대료 낮을수록 점수 상승) 계산
        const baseScore = 100;
        const competitionPenalty = markets[0].count * 5; // 경쟁사당 5점 감점
        const finalScore = Math.max(0, baseScore - competitionPenalty);

        res.json({
            location: { lat, lng },
            recommendScore: finalScore,
            competitionCount: markets[0].count,
            message: finalScore > 70 ? "창업하기 아주 좋은 위치입니다!" : "경쟁이 치열한 지역입니다."
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});