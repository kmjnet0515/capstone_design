const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
require('dotenv').config();
const xml2js = require('xml2js'); 


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
            ORDER BY distance ASC;
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

// 날짜 도우미 함수: 최근 6개월 연월(YYYYMM) 생성
const getRecentMonths = (count) => {
    const months = [];
    const now = new Date();
    for (let i = 0; i < count; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        months.push(`${yyyy}${mm}`);
    }
    return months;
};

app.get('/api/real-estate/trade', async (req, res) => {
    const { lawdCd, umdNm } = req.query; // 법정동코드(5자리)와 동 이름(예: 명지동)
    const SERVICE_KEY = process.env.MOLIT_SERVICE_KEY;
    const API_URL = 'https://apis.data.go.kr/1613000/RTMSDataSvcNrgTrade/getRTMSDataSvcNrgTrade';
    //const API_URL = 'https://apis.data.go.kr/1613000/RTMSDataSvcNrgRent/getRTMSDataSvcNrgRent'
    const months = getRecentMonths(12); // 최근 12개월 리스트

    try {
        let allTrades = [];

        // 6개월치 데이터를 병렬로 호출하여 속도 향상
        const requests = months.map(month => 
            axios.get(API_URL, {
                params: {
                    serviceKey: decodeURIComponent(SERVICE_KEY),
                    LAWD_CD: lawdCd,
                    DEAL_YMD: month,
                    _type: 'json'
                }
            })
        );

        const responses = await Promise.all(requests);

        responses.forEach(response => {
            const items = response.data?.response?.body?.items?.item;
            if (items) {
                // 데이터가 1건일 경우 객체로 오기 때문에 배열로 변환
                const itemList = Array.isArray(items) ? items : [items];
                allTrades = [...allTrades, ...itemList];
            }
        });

        // 데이터 정제: 
        // 1) 중복 제거 (지번, 금액, 계약일 기준)
        // 2) 동 이름(umdNm) 필터링 (내가 찍은 동네만)
        // 3) 건물용도 필터링 (상업용 관련 키워드)
        const filteredTrades = allTrades.filter((item, index, self) => {
            const isUnique = self.findIndex(t => 
                t.jibun === item.jibun && 
                t.dealAmount === item.dealAmount && 
                t.dealDay === item.dealDay
            ) === index;

            const isTargetDong = item.umdNm.trim() === umdNm.trim();
            
            const isCommercial = item.buildingUse && (
                item.buildingUse.includes('근린생활') || 
                item.buildingUse.includes('판매') || 
                item.buildingUse.includes('업무') ||
                item.buildingUse.includes('숙박')
            ); //검증필요

            return isUnique && isTargetDong && isCommercial;
        });

        console.log(`🔍 [${umdNm}] 필터링 완료: ${filteredTrades.length}건 반환`);
        res.json(filteredTrades);

    } catch (err) {
        console.error("❌ 국토부 API 호출 에러:", err.message);
        res.status(500).json({ error: "부동산 실거래 데이터를 가져오는 중 오류가 발생했습니다." });
    }
});


app.get('/api/real-estate/land-price', async (req, res) => {
    const { bbox } = req.query;
    const VWORLD_KEY = process.env.VWORLD_SERVICE_KEY;
    const API_URL = 'https://api.vworld.kr/ned/wfs/getIndvdLandPriceWFS';

    try {
        const response = await axios.get(API_URL, {
            params: {
                key: VWORLD_KEY,
                service: 'WFS',
                version: '1.1.0',
                request: 'GetFeature',
                typename: 'dt_d150',
                bbox: `${bbox},EPSG:4326`,
                maxFeatures: 1000, // 너무 많으면 지도가 무거우니 적절히 조절
                resultType: 'results',
                srsName: 'EPSG:4326',
                output: 'text/xml; subtype=gml/2.1.2',
                domain: 'localhost'
            }
        });
        console.log(response);
        // 네임스페이스 접두사(sop:, gml: 등)를 제거하고 파싱
        
        
        const parser = new xml2js.Parser({ 
            explicitArray: false, 
            tagNameProcessors: [xml2js.processors.stripPrefix] 
        });

        const result = await parser.parseStringPromise(response.data);
        const collection = result.FeatureCollection || result['wfs:FeatureCollection'];
        const features = collection?.featureMember;

        if (!features) return res.json([]);
        const featureList = Array.isArray(features) ? features : [features];

        // [핵심] 어떤 깊이에 있든 coordinates 문자열을 찾아내는 함수
        const findCoords = (obj) => {
            if (!obj) return null;
            if (typeof obj === 'string' && obj.includes(',')) return obj; // 문자열인데 좌표 형태면 반환
            if (obj.coordinates) return typeof obj.coordinates === 'string' ? obj.coordinates : obj.coordinates._;
            
            for (const key in obj) {
                if (typeof obj[key] === 'object') {
                    const found = findCoords(obj[key]);
                    if (found) return found;
                }
            }
            return null;
        };

        const processedData = featureList.map(f => {
            const item = f.dt_d150 || f['sop:dt_d150'];
            if (!item) return null;

            let lat = 0, lng = 0;
            const coordStr = findCoords(item.ag_geom); // 지형 정보에서 좌표 추출

            if (coordStr) {
                const cleanStr = coordStr.trim().replace(/\s+/g, ' '); 
                const pairs = cleanStr.split(' '); // 모든 좌표 쌍 분리
                const firstPair = pairs[0].split(','); // 첫 번째 경위도 쌍 추출

                // 브이월드 EPSG:4326은 [경도, 위도] 순서임
                lng = parseFloat(firstPair[0]);
                lat = parseFloat(firstPair[1]);
            }

            if (lat && lng) {
                return {
                    pnu: item.pnu,
                    jiga: parseInt(item.pblntf_pclnd) || 0,
                    address: item.lnm_lndcgr_smbol || '지번미상',
                    lat,
                    lng
                };
            }
            console.log("📍 좌표 추출 실패 PNU:", item.pnu);
            return null;
        }).filter(d => d !== null);

        console.log(`✅ [공시지가] ${processedData.length}건 최종 처리 완료`);
        res.json(processedData);

    } catch (err) {
        console.error("❌ 처리 에러:", err.message);
        res.status(500).json({ error: "데이터 처리 중 오류" });
    }
});