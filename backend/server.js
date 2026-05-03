const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
require('dotenv').config();
const xml2js = require('xml2js'); 
const proj4 = require('proj4');
const axios = require('axios');
const app = express();
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const OpenAI = require('openai');
const cron = require('node-cron');
const pipeline = require('util').promisify(require('stream').pipeline);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const { runApplicationMigrations } = require('./db/migrations');
const { buildRouter: buildApplicationsRouter } = require('./controllers/applications');
const documentCache = require('./services/document_cache');
let categoryVectors = [];






const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR);
}
// Docker(EC2)에서는 venv 없음 → python3 사용. 로컬에서는 venv 우선
const venvPython = path.join(__dirname, 'venv', 'bin', 'python');
const PYTHON_PATH = process.env.PYTHON_PATH || (fs.existsSync(venvPython) ? venvPython : 'python3');
const PARSER_SCRIPT = path.join(__dirname, 'hwp_hwpx_pdf_extract_text.py');



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

app.use('/api/applications', buildApplicationsRouter({ pool, openai }));

runApplicationMigrations(pool)
    .then((r) => {
        console.log('[init] application 테이블 마이그레이션 완료:', r.tables.join(', '));
        documentCache.startCleanupCron(pool);
    })
    .catch((e) => console.error('[init] application 테이블 마이그레이션 실패:', e.message));

const START_DATE = '20260119';
const getTwoDaysAgo = () => {
    const d = new Date();
    d.setDate(d.getDate() - 2); // 현재 날짜에서 2일 전
    return d.toISOString().split('T')[0].replace(/-/g, '');
};
const getDateStringByOffset = (offsetDays) => {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().split('T')[0].replace(/-/g, '');
};
const isValidYyyymmdd = (value) => /^\d{8}$/.test(value);
const END_DATE = getTwoDaysAgo();

/** bizinfo API: pblancUrl이 상대경로이거나 https// 처럼 콜론 누락된 절대 URL일 수 있음 */
function normalizeBizinfoPblancUrl(pblancUrl) {
    if (pblancUrl == null || typeof pblancUrl !== 'string') return '';
    let u = pblancUrl.trim();
    if (!u) return '';
    u = u.replace(/^https\/\//i, 'https://').replace(/^http\/\//i, 'http://');
    if (/^https?:\/\//i.test(u)) return u;
    if (u.startsWith('//')) return `https:${u}`;
    if (/^www\.bizinfo\.go\.kr/i.test(u)) return `https://${u}`;
    const path = u.startsWith('/') ? u : `/${u}`;
    return `https://www.bizinfo.go.kr${path}`;
}

cron.schedule('5 0 * * *', async () => {
    console.log("🚀 [배치 작업] 일일 데이터 동기화 시작...");
    // 하루치 변동분만 가져오도록 시작/종료를 각각 독립 계산
    const endDate = getDateStringByOffset(-2);
    const startDate = getDateStringByOffset(-3);
    await syncGovernmentData(startDate, endDate);
});


let cachedSgisToken = null;
let tokenExpiryTime = 0;

const getSgisToken = async () => {
    const now = Date.now();

    // 1. 토큰이 있고 만료되지 않았다면 (여유 있게 만료 5분 전까지 확인) 재사용
    if (cachedSgisToken && now < tokenExpiryTime - (5 * 60 * 1000)) {
        console.log("SGIS 토큰 재사용");
        return cachedSgisToken;
    }

    // 2. 토큰이 없거나 만료되었다면 새로 발급
    try {
        console.log("🔑 SGIS 토큰 새로 발급 중...");
        const response = await axios.get(`https://sgisapi.mods.go.kr/OpenAPI3/auth/authentication.json`, {
            params: {
                consumer_key: process.env.SGIS_CUSTOMER_KEY,
                consumer_secret: process.env.SGIS_SECRET_KEY
            }
        });

        const result = response.data && response.data.result;
        if (!result || typeof result.accessToken !== 'string') {
            console.error(
                'SGIS Token 발급: result 없음 또는 accessToken 누락',
                JSON.stringify(response.data || {}).slice(0, 400)
            );
            return null;
        }
        const { accessToken, timeout } = result;

        cachedSgisToken = accessToken;
        // timeout은 보통 초 단위(7200)로 오므로 현재 시간에 더해줌
        tokenExpiryTime = now + (parseInt(timeout) * 1000); 

        return cachedSgisToken;
    } catch (err) {
        console.error("SGIS Token 발급 에러:", err);
        return null;
    }
};

const TARGET_APIS = {
    "즉석판매제조가공업" : "instant_food_processors",
    "휴게음식점" : "rest_cafes",
    "유흥주점영업" : "entertainment_bars",
    "축산판매업" : "livestock_retail",
    "축산물운반업" : "livestock_transport",
    "용기및포장지제조업" : "container_packaging_manufacturers",
    "유통전문판매업" : "distribution_specialty_retailers",
    "식품냉동냉장업" : "food_freezing_refrigeration",
    "식용얼음판매업" : "edible_ice_retailers",
    "고압가스업" : "high_pressure_gas",
    "식품제조가공업" : "food_manufacturing_processors",
    "계랑기제조업" : "weighing_instrument_manufacturing",
    "식품자동판매기업" : "food_vending_machines",
    "계랑기수입업" : "weighing_instrument_import",
    "계랑기수리업" : "weighing_instrument_repair",
    "식품소분업" : "food_repackagers",
    "통신판매업" : "ecommerce_businesses",
    "건설폐기물처리업" : "construction_waste_disposal",
    "가축분뇨수집운반업" : "manure_collection_transport",
    "개인하수처리시설관리업(사업장)" : "small_sewage_facility_management",
    "가촉분뇨배출시설관리업(사업장)" : "manure_facility_management",
    "용기냉동기특정설비" : "container_refrigeration_equipment",
    "옹기류제조업" : "onggi_manufacturers",
    "제재업" : "sawmills",
    "저수조청소업" : "water_tank_cleaning",
    "전력기술설계업체" : "power_design_companies",
    "방문판매업" : "door_to_door_sales",
    "지하수정화업체" : "groundwater_remediation",
    "전력기술감리업체" : "power_supervision_companies",
    "의류기기판매(임대)업" : "medical_device_sales_rental",
    "의류기기수리업" : "medical_device_repair",
    "의원" : "clinics",
    "의료유사업" : "medical_related_businesses",
    "의료법인" : "medical_corporations",
    "응급환자이송업" : "emergency_patient_transport",
    "약국" : "pharmacies",
    "부속의료기관" : "affiliated_medical_institutions",
    "병원" : "hospitals",
    "유료직업소개소" : "paid_job_centers",
    "교육기관" : "funeral_director_training",
    "승강기제조및수입업체" : "elevator_manufacturers_importers",
    "상조업" : "funeral_service_providers",
    "민방위급수시설" : "civil_defense_water_facilities",
    "물류창고업체" : "logistics_warehouses",
    "국제물류주선업" : "international_logistics_forwarders",
    "담배수입판매업체" : "tobacco_import_retailers",
    "담배소매업" : "tobacco_retailers",
    "담배도매업" : "tobacco_wholesalers",
    "출판사" : "publishers",
    "인쇄사" : "printing_shops",
    "옥외광고업" : "outdoor_advertising_companies",
    "산후조리업" : "postpartum_care",
    "치과기공소" : "dental_labs",
    "관광궤도업" : "tourist_railways",
    "관광공연장업" : "tourist_performance_halls",
    "일반게임제공업" : "general_game_providers",
    "게임물제작업" : "game_producers",
    "승마장업" : "horse_riding",
    "의료기관세탁물처리업" : "medical_laundry",
    "영화배급업" : "film_distributors",
    "국내외여행업" : "domestic_international_travel_agencies",
    "국내여행업" : "domestic_travel_agencies",
    "한옥체험업" : "hanok_experience",
    "자동차야영장업" : "auto_campgrounds",
    "일반야영장업" : "general_campgrounds",
    "테마파크업(기타)" : "amusement_facilities_other",
    "미술관" : "museums_and_art_galleries",
    "국제회의시설업" : "international_convention_facilities",
    "관광사업자" : "tourism_businesses",
    "전통사찰" : "traditionales",
    "전문휴양업" : "special_resorts",
    "문화예술법인" : "cultural_art_corporations",
    "비디오물감상실업" : "video_viewing_rooms",
    "숙박업" : "lodgings",
    "목욕장업" : "public_baths",
    "비디오물제작업" : "video_producers",
    "요트장업" : "yacht_marinas",
    "비디오물배급업" : "video_distributors",
    "비디오물소극장업" : "video_mini_theaters",
    "무도학원업" : "dance_academies",
    "무도장업" : "dance_halls",
    "등록체육시설업" : "registered_sports_facilities",
    "당구장업" : "billiard_halls",
    "골프장" : "golf_courses",
    "골프연습장업" : "golf_practice_ranges",
    "공연장" : "performance_halls",
    "전화권유판매업" : "telemarketing_sales",
    "다단계판매업체" : "multilevel_marketing",
    "세탁업" : "laundries",
    "이용업" : "barber_shops",
    "음반물제작업" : "record_producers",
    "음반및음악영상물제작업" : "music_video_producers",
    "온라인음악서비스제공업" : "online_music_services",
    "영화제작업" : "film_producers",
    "영화수입업" : "film_importers",
    "영화상영업" : "film_screenings",
    "영화상영관" : "movie_theaters",
    "동물약국" : "animal_pharmacies",
    "동물생산업" : "animal_breeding",
    "동물미용업" : "pet_grooming",
    "집유업" : "milk_collection",
    "동물전시업" : "animal_exhibition",
    "석유및석유대체연료판매업체" : "petroleum_alt_fuel_retailers",
    "석유판매업" : "oil_retailers",
    "동물장묘업" : "animal_cremation",
    "동물위탁관리업" : "animal_boarding",
    "동물운송업" : "animal_transport",
    "동물용의약품도매상" : "veterinary_drug_wholesalers",
    "사료제조업" : "feed_manufacturers",
    "부화업" : "hatcheries",
    "도축업" : "slaughterhouses",
    "가축인공수정소" : "artificial_insemination_centers",
    "가축사육업" : "livestock_farming",
    "동물판매업" : "animal_sales",
    "석연탄제조업" : "briquette_manufacturers",
    "원목생산업" : "log_production",
    "목재수입유통업" : "lumber_import_distribution",
    "쓰레기종량제봉투판매업" : "pay_as_you_throw_bag_retailers",
    "소독업" : "disinfection_companies",
    "분뇨수집운반업" : "night_soil_collection_transport",
    "동물수입업" : "animal_import",
    "동물병원" : "animal_hospitals",
    "환경컨설팅회사" : "environment_consulting_companies",
    "환경측정대행업" : "environment_measurement_agencies",
    "환경전문공사업" : "environment_contractors",
    "환경관리대행기관" : "environment_management_agencies",
    "집단급식소식품판매업" : "group_meal_food_retailers",
    "축산물보관업" : "livestock_storage",
    "제과점영업" : "bakeries",
    "단란주점영업" : "singing_bars",
    "축산가공업" : "livestock_processing",
    "관광식당" : "tourist_restaurants",
    "무료직업" : "free_job_centers",
    "식품판매업(기타)" : "other_food_retailers",
    "요양보호사교육기관" : "caregiver_training",
    "승강기유지관리업체" : "elevator_maintenance",
    "식품첨가물제조업" : "food_additive_manufacturers",
    "외국인관광도시민박업" : "foreigner_city_homestays",
    "농어촌민박업" : "rural_homestays",
    "식품운반업" : "food_transporters",
    "관광펜션업" : "tourist_pensions",
    "관광숙박업" : "tourist_accommodations",
    "식육포장처리업" : "meat_packers",
    "비디오물시청제공업" : "video_streaming_providers",
    "건강기능식품일반판매업" : "health_functional_food_general_retailers",
    "노래연습장업" : "karaoke_rooms",
    "집단급식소" : "group_meal_facilities",
    "위탁급식영업" : "contract_catering",
    "대중문화예술기획업" : "pop_culture_art_planners",
    "국제회의기획업" : "international_convention_planners",
    "체육도장업" : "martial_arts_dojo",
    "체력단련장업" : "fitness_centers",
    "지방문화원" : "local_culture_centers",
    "종합체육시설업" : "comprehensive_sports_facilities",
    "종합휴양업" : "comprehensive_resorts",
    "수질오염원설치시설(기타)" : "water_pollution_source_other",
    "종합테마파크업" : "comprehensive_amusement_facilities",
    "썰매장업" : "sledding",
    "일반테마파크업" : "general_amusement_facilities",
    "배출가스전문정비사업자(확인검사대행자)" : "emission_inspection_agencies",
    "시내순환관광업" : "city_tour_businesses",
    "대기오염물질배출시설설치사업장" : "air_pollution_facility_installation",
    "스키장" : "ski_resorts",
    "오수처리시설설계시공업" : "septic_sewage_design_build",
    "수영장업" : "swimming_pools",
    "관광유람선업" : "tourist_cruises",
    "급수공사대행업" : "water_supply_agents",
    "빙상장업" : "ice_rinks",
    "관광극장유흥업" : "tourist_theater_entertainment",
    "건물위생관리업" : "building_sanitation",
    "청소년게임제공업" : "youth_game_providers",
    "인터넷컴퓨터게임시설제공업" : "pc_bangs",
    "복합유통게임제공업" : "mixed_game_providers",
    "복합영상물제공업" : "mixed_video_content_providers",
    "후원방문판매업체" : "sponsored_door_to_door_sales",
    "게임물배급업" : "game_distributors",
    "종축업" : "breeding_stock_businesses",
    "지하수영향조사기관" : "groundwater_impact_assessment",
    "지하수시공업체" : "groundwater_construction",
    "특정고압가스업" : "specific_high_pressure_gas",
    "대규모점포" : "large_scale_retail_stores",
    "일반도시가스업체" : "city_gas_companies",
    "액화석유가스용품제조업체" : "lpg_equipment_manufacturers",
    "미용업" : "beauty_salons",
    "음반물배급업" : "record_distributors",
    "음반및음악영상물배급업" : "music_video_distributors",
    "계랑기증명업" : "weighing_instrument_certification",
    "안경업" : "optical_shops",
    "종합여행업" : "comprehensive_travel_agencies",
    "일반음식점" : "general_restaurants",
    "외국인전용유흥음식점업" : "foreigners_entertainment_restaurants",
    "판매업소" : "over_the_counter_medicine_stores",
    "관광유흥음식점업" : "tourist_entertainment_restaurants"
}


const EPSG5174 = "+proj=tmerc +lat_0=38 +lon_0=127.0028902777778 +k=1 +x_0=200000 +y_0=500000 +ellps=bessel +units=m +no_defs +towgs84=-115.80,474.99,674.11,1.16,-2.31,-1.63,6.43";
const WGS84 = "+proj=longlat +ellps=WGS84 +datum=WGS84 +no_defs";
const EPSG5179 = "+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs";
// 1. 서버 연결 확인용 테스트 API
app.get('/api/test', (req, res) => {
    res.json({ message: "서버가 잘 작동하고 있습니다!" });
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
        //console.log(responses);
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

    let allProcessedData = [];
    let startIndex = 0;
    const PAGE_SIZE = 1000; // 한 번에 가져올 양
    let hasMore = true;

    try {
        while (hasMore) {
            console.log(`📡 [공시지가] ${startIndex}번 인덱스부터 요청 중...`);
            
            const response = await axios.get(API_URL, {
                params: {
                    key: VWORLD_KEY,
                    service: 'WFS',
                    version: '1.1.0',
                    request: 'GetFeature',
                    typename: 'dt_d150',
                    bbox: `${bbox},EPSG:4326`,
                    maxFeatures: PAGE_SIZE,
                    startIndex: startIndex, // 페이징의 핵심
                    resultType: 'results',
                    srsName: 'EPSG:4326',
                    output: 'text/xml; subtype=gml/2.1.2',
                    domain: '54.180.123.114'
                }
            });

            const parser = new xml2js.Parser({ 
                explicitArray: false, 
                tagNameProcessors: [xml2js.processors.stripPrefix] 
            });

            const result = await parser.parseStringPromise(response.data);
            const collection = result.FeatureCollection || result['wfs:FeatureCollection'];
            if (!collection || !collection.featureMember) {
                console.log("데이터 없음");
                hasMore = false;
                break;
            }
            const features = collection?.featureMember;

            if (!features) {
                hasMore = false;
                break;
            }

            const featureList = Array.isArray(features) ? features : [features];

            // 데이터 가공 로직 (기존과 동일)
            const processedPage = featureList.map(f => {
                const item = f.dt_d150 || f['sop:dt_d150'];
                if (!item) return null;

                let lat = 0, lng = 0;
                const coordStr = findCoords(item.ag_geom);

                if (coordStr) {
                    const cleanStr = coordStr.trim().replace(/\s+/g, ' '); 
                    const pairs = cleanStr.split(' ');
                    const firstPair = pairs[0].split(',');
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
                return null;
            }).filter(d => d !== null);

            allProcessedData.push(...processedPage);

            // 가져온 데이터가 PAGE_SIZE(1000개)보다 적으면 더 이상 데이터가 없는 것임
            if (featureList.length < PAGE_SIZE) {
                hasMore = false;
            } else {
                startIndex += PAGE_SIZE;
            }
        }

        console.log(`✅ [공시지가] 총 ${allProcessedData.length}건 최종 처리 완료`);
        res.json(allProcessedData);

    } catch (err) {
        console.error("❌ 처리 에러:", err.message);
        res.status(500).json({ error: "데이터 처리 중 오류" });
    }
});

// 좌표 추출 함수 (기존과 동일)
const findCoords = (obj) => {
    if (!obj) return null;
    if (typeof obj === 'string' && obj.includes(',')) return obj;
    if (obj.coordinates) return typeof obj.coordinates === 'string' ? obj.coordinates : obj.coordinates._;
    for (const key in obj) {
        if (typeof obj[key] === 'object') {
            const found = findCoords(obj[key]);
            if (found) return found;
        }
    }
    return null;
};

//주요상권(유동인구, 부동산 대체)
//https://www.data.go.kr/iim/api/selectAPIAcountView.do#layer-api-guide
app.get('/api/market/major-districts', async (req, res) => {
    const { lat, lng, radius } = req.query; // 프론트에서 보낸 중심점과 반경
    const SERVICE_KEY = process.env.MOLIT_SERVICE_KEY;
    const BASE_URL = 'https://api.odcloud.kr/api/15090955/v1/uddi:10a9cf5c-77d1-4e5d-b7ff-e527e022612e';

    try {
        // 전수 데이터 수집 (정찰병 로직 동일)
        const firstRes = await axios.get(BASE_URL, { params: { page: 1, perPage: 1, serviceKey: SERVICE_KEY } });
        const finalRes = await axios.get(BASE_URL, { params: { page: 1, perPage: firstRes.data.totalCount, serviceKey: SERVICE_KEY } });

        const centerLat = parseFloat(lat);
        const centerLng = parseFloat(lng);
        const searchRadius = parseFloat(radius);

        const filteredDistricts = finalRes.data.data.map(item => {
            const path = item.상권좌표.split('|').map(coordStr => {
                const [lngStr, latStr] = coordStr.split(',');
                return { lat: parseFloat(latStr), lng: parseFloat(lngStr) };
            });

            // 상권의 첫 번째 좌표를 기준으로 거리 계산 (간단한 필터링)
            const dist = getDistance(centerLat, centerLng, path[0].lat, path[0].lng);
            
            return {
                id: item.상권번호,
                name: item.상권명,
                path: path,
                distance: dist
            };
        }).filter(d => d.distance <= searchRadius + 500); // 검색 반경보다 조금 더 여유있게 필터링

        res.json(filteredDistricts);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

function getDistance(lat1, lng1, lat2, lng2) {
    const R = 6371000; // 지구 반지름 (m)
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/*function getOpenApiRegionCode(address) {
    if (!address) return null;

    const parts = address.split(' ');
    const step1 = parts[0]; // 강원특별자치도, 서울특별시, 광주광역시 등
    const step2 = parts[1]; // 강릉시, 강남구, 광산구 등

    let searchKey = "";

    // '강원특별자치도' -> '강원', '경상북도' -> '경북' 등 2글자 추출
    const cityPrefix = step1.substring(0, 2); 
    
    // 엑셀 형식인 '강원강릉시' 또는 '광주광산구' 형태로 조합
    searchKey = cityPrefix + step2;

    // CSV에서 찾기
    const row = localDataList.find(item => item.자치단체명 === searchKey);
    return row ? row['자치단체 코드'] : null;
}*/

// openai 리포트 생성 API (고도화 버전)
app.post('/api/analysis/report', async (req, res) => {
    // 프론트에서 보낸 상세 객체들 (shops, trades, closures 등)
    const {
        smallCat,
        radius,
        districts,
        landPriceStats,
        shops,
        trades,
        closures,
        address,
        population,     // { averageAge, totalPopulation }
        spatialShops,   // [{ direction, count, avgDistance }]
        blockSummary,   // { totalActive, totalClosed, averageVitality }
    } = req.body;

    console.log("======= 고도화 AI 분석 요청 =======");
    console.log(`위치 : ${address} | 업종: ${smallCat}`);
    console.log(`밀집도 확인 - 상가: ${shops.totalCount}개(평균 ${shops.averageDistance}m)`);
    console.log(`위험도 확인 - 폐업: ${closures.totalCount}개(평균 ${closures.averageDistance}m)`);
    if (population?.averageAge !== undefined) {
        console.log(`인구 평균 연령(추정): ${population.averageAge}세 / 총인구: ${population.totalPopulation}`);
    }
    if (blockSummary) {
        console.log(`블록 요약 - 신규(영업): ${blockSummary.totalActive}, 폐업: ${blockSummary.totalClosed}`);
    }
    console.log("=================================");

    try {
        const totalBlocksActive = blockSummary?.totalActive ?? 0;
        const totalBlocksClosed = blockSummary?.totalClosed ?? 0;
        const closureRatio =
            totalBlocksActive + totalBlocksClosed > 0
                ? Number(
                      (totalBlocksClosed / (totalBlocksActive + totalBlocksClosed)).toFixed(
                          2
                      )
                  )
                : null;

        const response = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            {
                model: "gpt-4o", // 더 정밀한 분석을 위해 4o 또는 4-turbo 권장
                messages: [
                    {
                        role: "system",
                        content: `너는 대한민국 최고의 데이터 기반 상권 분석가다. 
                        [작성 원칙]
                        1. "데이터가 없어 분석이 어렵다"는 말을 절대 하지 마라. 전문가답게 가용한 정보를 쥐어짜서 분석하라.
                        2. 실거래 내역이 없다면, 제공된 '공시지가'를 주변 시세(통상 공시지가의 1.5~2배)로 환산하여 투자 가치를 추론하라.
                        3. 반드시 '마크다운' 형식을 사용하여 가공된 리포트 형태로 출력하라.
                        4. 지리적 환각에 주의하고, 철저히 제공된 수치에 집중하라.
                        5. 단순히 수치를 나열하지 말고, '거리'와 '밀집도'의 상관관계를 분석하라.
                        6. '신규(영업 중)' 데이터와 '폐업' 데이터를 항상 구분해서 설명하고, 비율과 추세를 명확히 비교하라.
                        7. 제공된 인구 평균 연령과 총 인구를 바탕으로, 업종 타깃 고객과의 적합도를 반드시 별도 소제목으로 분석하라.
                        8. 제공된 방향·거리 요약(spatialShops)과 폐업 비율을 활용해서, 사용자가 선택한 중심 좌표가 상권의 중심에서 얼마나 치우쳐 있는지, 북/남/동/서 어느 방향으로 얼마나(m 단위 수준으로) 이동하는 것이 좋은지까지 구체적으로 제안하라.`
                    },
                    {
                        role: "user",
                        content: `
                        ## 1. 기본 정보
                        - 분석 업종: ${smallCat}
                        - 분석 반경: ${radius}m
                        - 분석 주소 : ${address}
                        - 포함된 주요 상권: ${districts?.length > 0 ? districts.join(', ') : '정보 없음'}

                        ## 2. 입지 밀집도 데이터 (신규/폐업 구분)
                        - **최근 개업**: 총 ${shops.totalCount}개 (중심점 기준 평균 거리: ${shops.averageDistance}m)
                        - **최근 실거래**: 총 ${trades.totalCount}건 (중심점 기준 평균 거리: ${trades.averageDistance}m)
                        - **최근 폐업**: 총 ${closures.totalCount}개 (중심점 기준 평균 거리: ${closures.averageDistance}m)

                        ## 3. 가격 데이터 (㎡당)
                        - 일반 입지 평균: ${landPriceStats.midAvg}만원
                        - 핵심 입지 평균: ${landPriceStats.highAvg}만원
                        - 실거래 상세 내역: ${trades.items?.length > 0 ? JSON.stringify(trades.items) : '데이터 없음'}

                        ## 4. 인구 통계 (행정동 기준)
                        - 총 인구(추정): ${population?.totalPopulation ?? '정보 없음'}명
                        - 평균 연령(추정): ${population?.averageAge ?? '정보 없음'}세
                        - 해석 지침: 이 수치를 활용해 ${smallCat} 업종의 핵심 고객층(연령/라이프스타일)과의 궁합을 평가해라.

                        ## 5. 방향별 상가 분포 요약 (중심 좌표 기준)
                        - spatialShops JSON: ${Array.isArray(spatialShops) && spatialShops.length > 0 ? JSON.stringify(spatialShops) : '[]'}

                        ## 6. 신규 vs 폐업 블록 요약
                        - 신규(영업 중) 점포 합계: ${totalBlocksActive}
                        - 폐업 점포 합계: ${totalBlocksClosed}
                        - 폐업 비율(폐업 / 전체): ${closureRatio ?? '정보 없음'}

                        ## 요청 사항
                        1. **입지 응집도 분석**: 상가·실거래의 평균 거리와 방향별 분포(spatialShops)를 함께 고려해 현재 지점이 상권의 '핵심', '완충', '외곽' 중 어디에 해당하는지 판정할 것.
                        2. **상권 활력도**: 운영 점포 vs 폐업 점포(블록 단위 합계 및 폐업 비율)를 비교해 상권이 확장 중인지 쇠퇴 중인지 진단할 것. 특히 폐업이 특정 방향/거리 구간에 몰려 있는지 설명할 것.
                        3. **수요 적합도**: 제공된 평균 연령을 기준으로, ${smallCat} 업종이 해당 연령대/라이프스타일과 얼마나 맞는지, 어떤 콘셉트 조정이 필요한지 제안할 것.
                        4. **자산 가치 추정**: 실거래 데이터가 있다면 이를, 없다면 지가 정보를 바탕으로 임대료·권리금 수준을 추론할 것.
                        5. **최종 제안**: ${smallCat} 업종 창업 시, 리스크를 줄이기 위한 구체적인 입지 전략(선호 방향/거리, 피해야 할 구역 특징 등)을 3~5개의 실행 가능한 액션으로 정리할 것.
                        `
                    }
                ],
                temperature: 0.2, 
            },
            { headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` } }
        );
        res.json({ report: response.data.choices[0].message.content });
    } catch (error) { 
        console.error("AI Error:", error.response?.data || error.message);
        res.status(500).send("AI 분석 중 오류가 발생했습니다."); 
    }
});

// 개별 블록 상세 리포트
app.post('/api/analysis/block-report', async (req, res) => {
    console.log("======= 개별 블록 상세 리포트 요청 =======");
    try {
        const { address, radius, category, block } = req.body;
        if (!block) {
            return res.status(400).json({ error: 'block payload is required' });
        }

        const {
            jibun,
            active = 0,
            closed = 0,
            vitality = 0,
            totalScore = 0,
            closureRatio = 0,
        } = block;

        const total = active + closed;
        const closurePct = total > 0 ? Math.round((closed / total) * 100) : Math.round(closureRatio * 100);

        let vitalityLabel = '보합 구간';
        if (vitality > 0.2) vitalityLabel = '성장 구간';
        else if (vitality < -0.2) vitalityLabel = '위축 구간';

        let riskLabel = '폐업 리스크 낮음';
        if (closurePct >= 40) riskLabel = '폐업 리스크 높음';
        else if (closurePct >= 20) riskLabel = '폐업 리스크 보통';

        const systemPrompt = `
너는 대한민국 상권 컨설팅 전문가다.
해당 보고서는 "하나의 후보 블록(건물 단위)"에 대한 짧은 요약 리포트다.

[작성 원칙]
1. 보고서는 마크다운 형식으로, 하지만 너무 길지 않게 3~5개의 소제목과 10문장 내외로 작성한다.
2. 소제목 예시: "입지 요약", "신규 vs 폐업 흐름", "위험 요인", "추천 활용 전략".
3. 숫자는 반드시 한국어+숫자를 같이 써라. (예: "폐업 비율은 약 25%(4/16개) 수준입니다.")
4. "신규(영업 중)" vs "폐업"을 꼭 구분해서 설명하되, 과도한 공포감을 주지 말고, 실무적인 인사이트 중심으로 작성한다.
5. 사용자가 소상공인 창업/이전 후보지를 검토하는 상황이라고 가정하고, "이 블록 단독 기준"에서 장단점을 짚어준다.
6. 최종 문단에는 "어떤 성향의 점주에게 어울리는 입지인지"를 한 줄로 정리해준다. (예: "보수적인 점주에게는 다소 부담스러운 입지", "성장성에 베팅하려는 점주에게 적합" 등)`;

        const userPrompt = `
[후보 블록 기본 정보]
- 행정/지번: ${jibun || '지번 정보 없음'}
- 분석 기준 주소(대략적인 위치): ${address || '주소 정보 없음'}
- 반경: 약 ${radius || 'N/A'}m
- 업종(소분류): ${category || '전체 업종 기준'}

[상권 지표 요약]
- 신규(영업 중) 업소 수: ${active}개
- 폐업 업소 수: ${closed}개
- 폐업 비율: 약 ${closurePct}% (${closed}/${total || active + closed || 1}개 기준)
- 활력도 지표(vitality): ${vitality} (${vitalityLabel})
- 종합 점수(프론트엔드 스코어): ${Math.round(totalScore)}점
- 리스크 라벨: ${riskLabel}

[요청 사항]
- 위 정보를 토대로 "이 블록 단독 기준"에서의 상권 상태를 직관적으로 설명해 주세요.
- 신규/폐업 흐름을 바탕으로, 이 구역의 안정성/변동성을 짚어 주세요.
- 다만, 데이터가 블록 단위로 국소적이라는 점을 감안해서, "이 일대 상권 전체"에 대한 과도한 일반화는 피해주세요.
- 이 블록에 입점하는 경우, 어떤 전략(예: 저임대 기반 보수적 전략, 신규 수요 선점 전략 등)이 어울릴지 간단히 제안해 주세요.`;

        const completion = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            {
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt },
                ],
                temperature: 0.4,
            },
            {
                headers: {
                    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
                    'Content-Type': 'application/json',
                },
            }
        );
        const report = completion.data.choices?.[0]?.message?.content || '';
        return res.json({ report });
    } catch (error) {
        console.error('/api/analysis/block-report error:', error?.response?.data || error.message || error);
        return res.status(500).json({ error: 'Failed to generate block report' });
    }
});

// 다중 블록 비교 리포트
app.post('/api/analysis/compare-blocks', async (req, res) => {
    try {
        const { address, radius, category, blocks } = req.body;

        if (!Array.isArray(blocks) || blocks.length < 2) {
            return res.status(400).json({ error: 'At least two blocks are required for comparison' });
        }

        const summarized = blocks.map((b, idx) => {
            const active = b.active || 0;
            const closed = b.closed || 0;
            const vitality = b.vitality || 0;
            const total = active + closed;
            const closureRatio = total > 0 ? closed / total : (b.closureRatio || 0);
            const closurePct = Math.round(closureRatio * 100);

            let vitalityLabel = '보합 구간';
            if (vitality > 0.2) vitalityLabel = '성장 구간';
            else if (vitality < -0.2) vitalityLabel = '위축 구간';

            let riskLabel = '폐업 리스크 낮음';
            if (closurePct >= 40) riskLabel = '폐업 리스크 높음';
            else if (closurePct >= 20) riskLabel = '폐업 리스크 보통';

            return {
                index: idx + 1,
                label: b.label || `후보 ${idx + 1}`,
                jibun: b.jibun || '지번 정보 없음',
                active,
                closed,
                vitality,
                vitalityLabel,
                closurePct,
                riskLabel,
                totalScore: Math.round(b.totalScore || 0),
            };
        });

        const systemPrompt = `
너는 소상공인 상권 분석을 전문으로 하는 컨설턴트다.
이번 보고서는 "최대 3개의 후보 블록"을 서로 비교해서, 성향별로 어떤 블록이 더 적합한지 제안하는 용도다.

[작성 원칙]
1. 결과는 마크다운 형식으로 작성하되, 한눈에 비교가 되도록 표와 리스트를 적절히 활용한다.
2. 전체 길이는 15~25문장 이내로 유지한다.
3. 각 후보별로 "성장성", "안정성(폐업 리스크)", "전략 포인트"를 2~3줄로 요약한다.
4. 그 다음, 후보들끼리의 상대 비교(예: "1번 후보 vs 2번 후보")를 통해 강·약점을 정리한다.
5. 마지막에는 "보수적인 점주", "성장에 베팅하는 점주" 등 2~3가지 타입 별로 어떤 후보를 우선 고려하면 좋을지 추천한다.
6. 숫자는 한국어 설명과 함께, 예: "폐업 비율은 약 20%(3/15개) 수준"처럼 구체적으로 표현한다.
7. 데이터는 블록 단위로 제한적이라는 점을 한 문장 정도에서 언급하고, 과도한 확신 보다는 "우세/열세" 수준의 표현을 사용한다.`;

        const blocksText = summarized
            .map((b) => {
                const total = b.active + b.closed || 1;
                return `- ${b.label} (지번: ${b.jibun})
  - 신규(영업 중): ${b.active}개
  - 폐업: ${b.closed}개
  - 폐업 비율: 약 ${b.closurePct}% (${b.closed}/${total}개 기준)
  - 활력도: ${b.vitality} (${b.vitalityLabel})
  - 리스크 라벨: ${b.riskLabel}
  - 프론트엔드 종합 점수: ${b.totalScore}점`;
            })
            .join('\n\n');

        const userPrompt = `
[공통 맥락]
- 분석 기준 주소(대략적인 위치): ${address || '주소 정보 없음'}
- 반경: 약 ${radius || 'N/A'}m
- 업종(소분류): ${category || '전체 업종 기준'}

[비교 대상 후보 블록 목록]
${blocksText}

[요청 사항]
- 위 후보들을 서로 비교하여, 성장성/안정성/리스크 관점에서 상대적인 위치를 설명해 주세요.
- 특히, 폐업 비율이 높은 후보와 낮은 후보의 차이를 "임대 리스크" 관점에서 해석해 주세요.
- 각 후보에 대해 어떤 점주 성향(안정 추구, 성장 추구, 실험적 등)에 어울리는지 제안해 주세요.
- 마지막에 "성장 우선 관점에서 추천 순위"와 "안정 우선 관점에서 추천 순위"를 각각 1~3위까지 정리해 주세요.`;

        const completion = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            {
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt },
                ],
                temperature: 0.4,
            },
            {
                headers: {
                    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
                    'Content-Type': 'application/json',
                },
            }
        );

        const report = completion.data.choices?.[0]?.message?.content || '';
        return res.json({ report });
    } catch (error) {
        console.error('/api/analysis/compare-blocks error:', error?.response?.data || error.message || error);
        return res.status(500).json({ error: 'Failed to generate compare report' });
    }
});


//폐업(차별성)
// https://www.data.go.kr/tcs/dss/selectDataSetList.do?dType=API&keyword=&detailKeyword=&publicDataPk=15006668%2C15006679%2C15006697%2C15006700%2C15006706%2C15006727%2C15006730%2C15006741%2C15044950%2C15044952%2C15044953%2C15044954%2C15044955%2C15044956%2C15044957%2C15044958%2C15044959%2C15044960%2C15044961%2C15044962%2C15044963%2C15044964%2C15044965%2C15044966%2C15044967%2C15044968%2C15044969%2C15044970%2C15044971%2C15044972%2C15044973%2C15044974%2C15044975%2C15044976%2C15044977%2C15044978%2C15044979%2C15044980%2C15044981%2C15044982%2C15044983%2C15044984%2C15044985%2C15044986%2C15044987%2C15044988%2C15044989%2C15044991%2C15044992%2C15044993%2C15044994%2C15044995%2C15044996%2C15044997%2C15044998%2C15044999%2C15045000%2C15045001%2C15045002%2C15045003%2C15045004%2C15045005%2C15045006%2C15045007%2C15045008%2C15045009%2C15045010%2C15045011%2C15045012%2C15045013%2C15045014%2C15045015%2C15045016%2C15045017%2C15045018%2C15045019%2C15045020%2C15045021%2C15045022%2C15045023%2C15045024%2C15045025%2C15045026%2C15045027%2C15045028%2C15045029%2C15045030%2C15045031%2C15045032%2C15045033%2C15045034%2C15045035%2C15045036%2C15045037%2C15045038%2C15045039%2C15045040%2C15045041%2C15045042%2C15045043%2C15045044%2C15045045%2C15045046%2C15045047%2C15045048%2C15045049%2C15045050%2C15045051%2C15045052%2C15045053%2C15045054%2C15045055%2C15045056%2C15045057%2C15045058%2C15045059%2C15045060%2C15045061%2C15045062%2C15045063%2C15045064%2C15045065%2C15045066%2C15045067%2C15045068%2C15045069%2C15045070%2C15045071%2C15045072%2C15045073%2C15045074%2C15045075%2C15045076%2C15045077%2C15045078%2C15045079%2C15045080%2C15045081%2C15045082%2C15045083%2C15045084%2C15045085%2C15045086%2C15045087%2C15045088%2C15045089%2C15045090%2C15045091%2C15045092%2C15045093%2C15045094%2C15045095%2C15045096%2C15045097%2C15045098%2C15045099%2C15045100%2C15045101%2C15045102%2C15045103%2C15045104%2C15045105%2C15045106%2C15045107%2C15045108%2C15045109%2C15045110%2C15045111%2C15045112%2C15045113%2C15045114%2C15045115%2C15045116%2C15045117%2C15045118%2C15096255%2C15096257%2C15101543%2C15101544%2C15101545%2C15101546%2C15101548%2C15101549%2C15101550%2C15101551%2C15101552%2C15101553%2C15106987%2C15106988%2C15107028%2C15107029%2C15107030%2C15107031%2C15107032%2C15113628%2C15154458%2C15154643%2C15154784%2C15154787%2C15154788%2C15154791%2C15154803%2C15154808%2C15154821%2C15154822%2C15154825%2C15154829%2C15154834%2C15154835%2C15154837%2C15154842%2C15154848%2C15154851%2C15154853%2C15154854%2C15154857%2C15154861%2C15154864%2C15154866%2C15154869%2C15154871%2C15154874%2C15154875%2C15154879%2C15154881%2C15154883%2C15154886%2C15154890%2C15154891%2C15154895%2C15154897%2C15154899%2C15154900%2C15154902%2C15154903%2C15154905%2C15154909%2C15154910%2C15154913%2C15154914%2C15154916%2C15154918%2C15154921%2C15154922%2C15154923%2C15154926%2C15154927%2C15154930%2C15154931%2C15154932%2C15154933%2C15154937%2C15154939%2C15154940%2C15154944%2C15154945%2C15154948%2C15154949%2C15154951%2C15154952%2C15154954%2C15154955%2C15154956%2C15154957%2C15154958%2C15154960%2C15154961%2C15154963%2C15154964%2C15154966%2C15154968%2C15154969%2C15154970%2C15154971%2C15154973%2C15154975%2C15154976%2C15154978%2C15154979%2C15154981%2C15154982%2C15154983%2C15154984%2C15154989%2C15155004%2C15155011%2C15155014%2C15155015%2C15155018%2C15155019%2C15155020%2C15155021%2C15155022%2C15155024%2C15155025%2C15155027%2C15155028%2C15155029%2C15155030%2C15155031%2C15155033%2C15155036%2C15155038%2C15155041%2C15155043%2C15155045%2C15155047%2C15155051%2C15155055%2C15155056%2C15155059%2C15155061%2C15155065%2C15155066%2C15155071%2C15155075%2C15155077%2C15155078%2C15155082%2C15155083%2C15155085%2C15155088%2C15155089%2C15155090%2C15155091%2C15155093%2C15155095%2C15155097%2C15155098%2C15155099%2C15155100%2C15155103%2C15155105%2C15155108%2C15155110%2C15155112%2C15155113%2C15155114%2C15155118%2C15155120%2C15155121%2C15155124%2C15155126%2C15155127%2C15155128%2C15155130%2C15155133%2C15155134%2C15155135%2C15155137%2C15155138%2C15155139%2C15155142%2C15155144%2C15155146%2C15155147%2C15155149%2C15155150%2C15155152%2C15155154%2C15155155%2C15155157%2C15155159%2C15155162%2C15155163%2C15155164%2C15155166%2C15155168%2C15155169%2C15155170%2C15155171%2C15155173%2C15155221%2C15155226%2C15155232%2C15155235%2C15155236%2C15155237%2C15155238%2C15155242%2C15155245%2C15155246%2C15155250%2C15155251%2C15155252%2C15155253%2C15155257%2C15155258%2C15155262%2C15155272&recmSe=&detailText=&relatedKeyword=&commaNotInData=&commaAndData=&commaOrData=&must_not=&tabId=&dataSetCoreTf=&coreDataNm=%EC%A7%80%EB%B0%A9%ED%96%89%EC%A0%95+%EC%9D%B8%ED%97%88%EA%B0%80%EC%A0%95%EB%B3%B4&sort=_score&relRadio=&orgFullName=&orgFilter=&org=&orgSearch=&currentPage=5&perPage=10&brm=&instt=&svcType=&kwrdArray=&extsn=&coreDataNmArray=&operator=&pblonsipScopeCode=PBDE07
const getValueDeep = (obj, key) => {
    if (!obj) return null;
    if (obj[key]) return obj[key];
    for (let k in obj) {
        if (typeof obj[k] === 'object') {
            const res = getValueDeep(obj[k], key);
            if (res) return res;
        }
    }
    return null;
};
/*// [API] 폐업 데이터 조회 엔드포인트
// 배열을 특정 크기(chunkSize)로 나누는 헬퍼 함수
const chunkArray = (array, size) => {
    return Array.from({ length: Math.ceil(array.length / size) }, (v, i) =>
        array.slice(i * size, i * size + size)
    );
};

app.get('/api/analysis/closure-data', async (req, res) => {
    const BASE_URL = "https://apis.data.go.kr/1741000";
    const SERVICE_KEY = process.env.MOLIT_SERVICE_KEY;
    const { smallCategory, address } = req.query;
    const regionCode = getOpenApiRegionCode(address);
    console.log(`분석 주소: ${address} -> 추출 코드: ${regionCode}`);

    if (!regionCode) {
        return res.status(400).json({ error: "자치단체 코드를 찾을 수 없는 주소입니다." });
    }
    // 1. 유니코드 정규화 (NFC) - 자모 분리 현상 방지
    const normalizedQuery = smallCategory ? smallCategory.normalize('NFC') : "";
    
    // CATEGORY_MAP에서 리스트 가져오기 (키값도 정규화해서 매핑 확인)
    const rawApiKeys = CATEGORY_MAP[normalizedQuery] || [];

    if (rawApiKeys.length === 0) {
        console.warn(`⚠️ 매핑된 API 리스트가 없습니다: ${normalizedQuery}`);
        return res.json({ count: 0, data: [] });
    }

    try {
        // 2. [핵심 수정] 한글 업종명을 실제 API 주소 경로로 변환
        const validPaths = rawApiKeys
            .map(key => TARGET_APIS[key.normalize('NFC')]) // 한글명 -> API경로 변환
            .filter(path => !!path); // 경로가 존재하는 것만 필터링
        if (validPaths.length === 0) {
            console.warn(`⚠️ TARGET_APIS에 매핑된 실제 경로가 없습니다.`);
            return res.json({ count: 0, data: [] });
        }

        const fetchAllForPath = async (apiPath) => {
            try {
                let pathData = [];
                let pageNo = 1;
                const numOfRows = 100;
                let hasMore = true;

                while (hasMore) {
                    // url 구성 시 apiPath가 영어 경로인지 확인 필요
                    const url = `${BASE_URL}/${apiPath}/info`;
                    const params = {
                        serviceKey: SERVICE_KEY,
                        pageNo: pageNo,
                        numOfRows: numOfRows,
                        "cond[SALS_STTS_CD::EQ]": '03',          // 영업상태코드: 폐업
                        "cond[OPN_ATMY_GRP_CD::EQ]": regionCode, // 개방자치단체코드
                        "cond[LCPMT_YMD::GTE]": '20200101',      // 인허가일자 이상 (Greater Than or Equal)
                        "cond[LCPMT_YMD::LT]": '20260101',      // 인허가일자 미만 (Less Than)
                        type: 'json'
                    };
                    const response = await axios.get(url, { params });
                    const data = response.data;
                    // 데이터 깊은 곳에서 items 추출
                    let items = getValueDeep(data, 'items');
                    if (!items) items = [];
                    else if (!Array.isArray(items)) items = items.item ? items.item : [items];
                    if (items.length === 0) break;

                    const filtered = items
                        .map(item => {
                            let lat = 0, lng = 0;
                            const rawX = item.CRD_INFO_X;
                            const rawY = item.CRD_INFO_Y;

                            if (rawX && rawY) {
                                try {
                                    const x = parseFloat(rawX);
                                    const y = parseFloat(rawY);

                                    // 값이 유효한 숫자인지 확인
                                    if (!isNaN(x) && !isNaN(y)) {
                                        // proj4(기준좌표계, 대상좌표계, [x, y])
                                        const [transformedLng, transformedLat] = proj4(EPSG5174, WGS84, [x, y]);
                                        lng = transformedLng;
                                        lat = transformedLat;
                                    }
                                } catch (e) {
                                    console.error("좌표 변환 실패:", e.message);
                                }
                            }
                            return {
                                name: item.BPLC_NM,
                                closeDate: item.CLSBIZ_YMD,
                                status: item.SALS_STTS_CD,
                                address: item.ROAD_NM_ADDR || "",
                                lat, lng
                            };
                        });

                    pathData = [...pathData, ...filtered];
                    
                    const totalCount = parseInt(getValueDeep(data, 'totalCount') || 0);
                    if (pageNo * numOfRows >= totalCount) hasMore = false; // 속도를 위해 2페이지 제한
                    else pageNo++;
                }
                return pathData;
            } catch (err) {
                console.error(`❌ 에러 발생 (${apiPath}):`, err.message);
                if (err.code === 'ECONNABORTED') console.error("⏰ 타임아웃 발생 (서버 응답 없음)");
                return [];
            }
        };

        // 3. 배치 처리 (5개씩)
        const pathBatches = chunkArray(validPaths, 5);
        let allClosedShops = [];

        for (let i = 0; i < pathBatches.length; i++) {
            const results = await Promise.all(pathBatches[i].map(path => fetchAllForPath(path)));
            allClosedShops = [...allClosedShops, ...results.flat()];
            if (i < pathBatches.length - 1) await new Promise(r => setTimeout(r, 200));
        }
        // 중복 제거 (이름과 좌표가 같으면 중복으로 간주)
        const uniqueShops = allClosedShops.filter((v, i, a) => 
            a.findIndex(t => t.name === v.name && t.lat === v.lat) === i
        );
        uniqueShops.sort((a, b) => (b.closeDate || 0) - (a.closeDate || 0));

        res.json({ count: uniqueShops.length, data: uniqueShops });

    } catch (error) {
        console.error("전체 프로세스 에러:", error.message);
        res.status(500).json({ error: "서버 내부 오류" });
    }
});
*/

async function initializeCategoryData() {
    try {
        // DB에서 계층 구조 전체를 가져옵니다.
        const [rows] = await pool.query(`
            SELECT large_name, mid_name, small_name 
            FROM categories
        `);
        
        // GPT 검색을 위한 참조 배열 생성
        categoryVectors = rows.map(row => ({
            name: row.small_name,
            hierarchy: { 
                large: row.large_name, 
                mid: row.mid_name, 
                small: row.small_name 
            }
        }));

        console.log(`✅ [데이터 로드 완료] 총 ${categoryVectors.length}개의 업종 데이터를 로드했습니다.`);
    } catch (err) {
        console.error("❌ 데이터 로드 중 오류:", err);
    }
}

// 서버 시작 시 호출
initializeCategoryData();

app.get('/api/categories/search', async (req, res) => {
    const { query } = req.query;
    if (!query) return res.json(null);

    try {
        // GPT에게 줄 리스트를 더 명확하게 전달
        const listForGPT = categoryVectors.map(c => c.name).join(', ');

        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: "너는 사용자의 입력어에 대해 오직 주어진 [리스트] 내의 단어로만 매핑하는 기계적인 분류기야. 부연 설명이나 요약은 금지한다."
                },
                {
                    role: "user",
                    content: `
[리스트]
${listForGPT}

[매핑 규칙]
1. 반드시 [리스트]에 있는 텍스트와 100% 일치하게 대답해.
2. '식당', '카페' 처럼 리스트에 없는 단어로 요약하지 마.
3. 가장 유사한 소분류명을 선택해.

[예시]
입력: 커피 -> 출력: 커피전문점/카페
입력: 삼겹살 -> 출력: 돼지고기 구이/찜
입력: 피자 -> 출력: 피자전문점
입력: 부동산 -> 출력: 부동산 중개/대리업

[사용자 입력]
${query}

출력:`
                }
            ],
            temperature: 0,
        });

        const matchedName = response.choices[0].message.content.trim();
        
        // 1. 완전 일치 확인
        let finalMatch = categoryVectors.find(c => c.name === matchedName);
        
        // 2. [보험] 만약 GPT가 또 이상한 단어를 뱉었다면? (부분 일치 검사)
        if (!finalMatch) {
            console.log(`⚠️ GPT 오답 발생([${matchedName}]), 부분 일치 검색으로 전환`);
            finalMatch = categoryVectors.find(c => 
                c.name.includes(matchedName) || matchedName.includes(c.name)
            );
        }

        console.log(`🤖 GPT 판정: [${query}] -> [${finalMatch ? finalMatch.name : '실패'}]`);
        res.json(finalMatch || null);

    } catch (err) {
        console.error("GPT Error:", err);
        res.status(500).send("Search Error");
    }
});



app.get('/api/get-support', async (req, res) => {
    const { region, category } = req.query; 
    const SERVICE_KEY = process.env.bizkey;
    const URL = 'https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do';

    try {
        const response = await axios.get(URL, {
            params: {
                crtfcKey: SERVICE_KEY,
                dataType: 'json',
                searchCnt: 500,
                hashtags: category, // 예: '소상공인'
                pageUnit: 500,
                pageIndex: 1
            }
        });

        const rawData = response.data?.jsonArray || [];
        
        // 1. 필터링 및 데이터 정제 로직
        const filteredItems = rawData.filter(item => {
            const agency = item['jrsdInsttNm'] || "";
            const target = item['trgetNm'] || "";
            
            // 조건 1: 지역(부산 등)으로 시작하거나 '중소벤처기업부' 등 중앙부처 포함
            const isRegionMatch = agency.startsWith(region) || agency.startsWith('중소');
            // 조건 2: 지원 대상이 정확히 '소상공인' (또는 포함)
            const isTargetMatch = target.includes('소상공인'); 
            return isRegionMatch && isTargetMatch;
        }).map(item => ({
            id: item.pblancId,
            title: item.pblancNm,
            agency: item.jrsdInsttNm,
            // HTML 태그 제거 및 길이 제한
            summary: item.bsnsSumryCn 
                ? item.bsnsSumryCn
                    .replace(/<[^>]*>?/gm, '') // 1. HTML 태그 제거
                    .replace(/&nbsp;/g, ' ')    // 2. &nbsp;를 실제 공백으로 치환
                    .trim() 
                : "",
            period: item.reqstBeginEndDe,

            url: normalizeBizinfoPblancUrl(item.pblancUrl),
            type: item.pldirSportRealmLclasCodeNm,
            fileUrl : item.printFlpthNm || "",
            fileName : item.printFileNm || "",
            meth : item.reqstMthPapersCn || ""
        }));

        console.log(`✅ [지원사업] ${region} 소상공인 맞춤 ${filteredItems.length}건 반환`);
        res.json(filteredItems);

    } catch (error) {
        console.error("❌ API 호출 에러:", error.message);
        res.status(500).json({ error: "데이터를 가져오는데 실패했습니다." });
    }
});






app.get('/api/analysis/closed-blocks', async (req, res) => {
    const { minLat, maxLat, minLng, maxLng, regionCode, radius } = req.query;
    const vworldKey = process.env.VWORLD_SERVICE_KEY;

    const centerLat = (parseFloat(minLat) + parseFloat(maxLat)) / 2;
    const centerLng = (parseFloat(minLng) + parseFloat(maxLng)) / 2;
    const limitRadius = parseFloat(radius) || 500;
    //console.log(limitRadius);
    try {
        // 1. DB에서 해당 범위 내 모든 데이터 조회 (영업 + 폐업)
        const [dbRows] = await pool.query(`
            SELECT manage_num, status_code, lat, lng, biz_name 
            FROM gov_permit_info 
            WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ? AND (status_code = ? OR status_code = ?)
        `, [minLat, maxLat, minLng, maxLng, 1, 3]);

        // 2. API에서 최신 변동분 조회 (영업 01, 폐업 03)
        // fetchRecentClosures와 유사하게 영업 데이터를 가져오는 로직이 필요합니다.
        // 여기서는 기존 fetchRecentClosures를 활용하여 '폐업' API 데이터를 우선 확보합니다.
        const ed = getTwoDaysAgo();
        
        const [dbRes] = await pool.query(`
            SELECT count(*) as c
            FROM api_sync_log
            WHERE sync_date = ? AND status = 'SUCCESS'
        `, [ed]);
        let apiClosedData = [];
        if (dbRes[0].c === 0) {
            console.log(`📡 [${ed}] 동기화 로그 없음. API 최신 변동분 호출 중...`);
            apiClosedData = await fetchRecentClosures(regionCode); 
        } else {
            console.log(`✅ [${ed}] 이미 동기화된 날짜입니다. DB 데이터만 사용합니다.`);
        }

        
        let rawDataList = [];

        // 1-1. DB 데이터
        dbRows.forEach(row => {
            rawDataList.push({
                manage_num: row.manage_num,
                status: parseInt(row.status_code), // 1: 영업, 3: 폐업
                lat: parseFloat(row.lat),
                lng: parseFloat(row.lng),
                biz_name: row.biz_name ? row.biz_name.trim() : ""
            });
        });

        // 1-2. API 데이터 (폐업 정보가 있다면 해당 manage_num을 찾아 상태 업데이트하거나 리스트에 추가)
        // * API 데이터가 DB에 없는 새로운 폐업 정보일 수도 있으므로 처리 필요
        apiClosedData.forEach(apiRow => {
            // 일단 API에서 온 건 '폐업(3)'으로 간주
            rawDataList.push({
                manage_num: apiRow.manage_num || "API_UNKNOWN", 
                status: 3, 
                lat: parseFloat(apiRow.lat),
                lng: parseFloat(apiRow.lng),
                biz_name: apiRow.name ? apiRow.name.trim() : "" 
            });
        });

        // [단계 2] '가게 단위'로 그룹화 (중복 제거 핵심 로직)
        const uniqueStoreMap = new Map();

        // 좌표 소수점 반올림 함수 (미세한 오차로 다른 가게로 인식되는 것 방지, 약 1m 오차 허용)
        const normalizeCoord = (val) => {
            if (!val) return 0;
            return Math.floor(val * 10000) / 10000; 
        };

        // 상호명 정규화 (공백 제거: '스타벅스 강남점' == '스타벅스강남점')
        const normalizeName = (name) => {
            if (!name) return "이름미상";
            return name.replace(/\s+/g, '');
        };

        rawDataList.forEach((item) => {
            // 1. 유니크 키 생성: "위도_경도_상호명"
            const groupKey = `${normalizeCoord(item.lat)}_${normalizeCoord(item.lng)}_${normalizeName(item.biz_name)}`;

            if (uniqueStoreMap.has(groupKey)) {
                // 2. 이미 등록된 가게가 있다면? -> 상태를 병합합니다.
                const existingStore = uniqueStoreMap.get(groupKey);
                
                // [중요 정책] 
                // 여러 인허가 중 하나라도 '영업(1)' 상태라면, 이 가게는 영업 중인 것으로 판단합니다.
                // 예: 담배권은 반납(폐업)했지만, 편의점 자체는 계속 운영 중일 수 있음.
                if (item.status === 1) {
                    existingStore.status = 1;
                }
                
                // (선택) 어떤 인허가들이 묶였는지 디버깅용으로 저장
                existingStore.permits.push(item.manage_num);
                
            } else {
                // 3. 새로운 가게 발견 -> 맵에 등록
                uniqueStoreMap.set(groupKey, {
                    id: groupKey, 
                    keyId: item.manage_num, // 대표 ID 하나만 저장
                    status: item.status,
                    lat: item.lat,
                    lng: item.lng,
                    biz_name: item.biz_name,
                    permits: [item.manage_num]
                });
            }
        });

        // 최종 결과: 중복이 제거된 순수 가게 리스트
        const allPoints = Array.from(uniqueStoreMap.values());
        //console.log(allPoints);
        // 4. 지적도 데이터 가져오기 (기존 루프 로직 유지)
        let allFeatures = [];
        let page = 1;
        let hasMore = true;
        while (hasMore) {
            try{
                const vworldRes = await axios.get('https://api.vworld.kr/req/data', {
                    params: {
                        service: 'data', request: 'GetFeature', data: 'lp_pa_cbnd_bubun',
                        key: vworldKey, size: 1000, page: page, format: 'json',
                        geometry: 'true', geomFilter: `BOX(${minLng},${minLat},${maxLng},${maxLat})`,
                        crs: 'EPSG:4326'
                    },
                    headers: { 'Referer': 'http://54.180.123.114:8080' }
                });
                const responseData = vworldRes.data.response;
                if (responseData?.status === 'OK') {
                    allFeatures.push(...responseData.result.featureCollection.features);
                    if (responseData.result.featureCollection.features.length === 1000) page++;
                    else hasMore = false;
                } else { 
                    console.log(`error ${responseData?.status}`);
                    hasMore = false; 
                }
                console.log(`${page}번 분석중`);
            }catch (err) {
                res.status(500).json({ error: err.message });
            }
        }

        // 5. 블록별 집계 (거리 계산 포함)
        const result = allFeatures
            .filter(f => {
                const jibun = f.properties.jibun || "";
                // 중심점 거리 계산 로직 (기존 유지)
                const coords = f.geometry.type === 'Polygon' ? f.geometry.coordinates[0][0] : f.geometry.coordinates[0][0][0];
                const dist = getDistance(centerLat, centerLng, coords[1], coords[0]);
                return dist <= limitRadius && (jibun.endsWith("대") || jibun.endsWith("차"));
            })
            .map(feature => {
                const polygonRing = feature.geometry.type === 'Polygon' 
                    ? feature.geometry.coordinates[0] 
                    : feature.geometry.coordinates[0][0];

                const pointsInBlock = allPoints.filter(p => isPointInPolygon(p, polygonRing));

                // 분석 데이터 계산
                const activeCount = pointsInBlock.filter(p => p.status === 1).length;
                const closedCount = pointsInBlock.filter(p => p.status === 3).length;

                return {
                    id: feature.id || feature.properties.pnu,
                    geometry: feature.geometry,
                    jibun: feature.properties.jibun,
                    properties: {
                        activeCount,
                        closedCount,
                        // 활력 지수: 개업(영업)이 많으면 양수(파랑), 폐업이 많으면 음수(빨강)
                        // (영업 - 폐업) / 전체
                        vitality: (activeCount + closedCount) > 0 
                                  ? (activeCount - closedCount) / (activeCount + closedCount) 
                                  : 0
                    }
                };
            });

        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

async function fetchRecentClosures(regionCode) {
    const apiPaths = Object.values(TARGET_APIS);
    let allResults = [];
    const BATCH_SIZE = 5; // 현재 설정 유지

    for (let i = 0; i < apiPaths.length; i += BATCH_SIZE) {
        const batch = apiPaths.slice(i, i + BATCH_SIZE);
        console.log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1}...`);

        try {
            // 한 배치의 실행 결과들을 기다림
            const batchPromises = batch.map(path => fetchCategoryWithPagination(path, regionCode));
            const results = await Promise.all(batchPromises); 
            
            // 가져온 데이터들을 합침
            results.forEach(data => {
                if (data && Array.isArray(data)) {
                    allResults.push(...data);
                }
            });
        } catch (err) {
            console.error(`Batch ${i} 처리 중 치명적 오류:`, err.message);
            // 여기서 중단되지 않고 다음 배치로 넘어가도록 함
        }
    }
    
    console.log(`모든 데이터 수집 완료! 총 건수: ${allResults.length}`);
    return allResults;
}

// Point-in-Polygon 알고리즘
function isPointInPolygon(point, polygon) {
    let x = point.lng, y = point.lat;
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        let xi = polygon[i][0], yi = polygon[i][1];
        let xj = polygon[j][0], yj = polygon[j][1];
        let intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}



async function fetchCategoryWithPagination(apiPath, regionCode) {
    let categoryData = [];
    let pageNo = 1;
    const numOfRows = 100;
    let hasMore = true;

    try {
        while (hasMore) {
            // URL은 TARGET_APIS의 value가 아니라 실제 API 경로 확인 필요 (보통 OP_L_... 형태)
            // 여기서는 TARGET_APIS의 value가 apiPath로 들어온다고 가정합니다.
            const url = `https://apis.data.go.kr/1741000/${apiPath}/info`;
            const res = await axios.get(url, {
                params: {
                    serviceKey: process.env.MOLIT_SERVICE_KEY,
                    pageNo: pageNo,
                    numOfRows: numOfRows,
                    "cond[SALS_STTS_CD::EQ]": '03',          // 폐업
                    "cond[OPN_ATMY_GRP_CD::EQ]": regionCode, // 자치단체코드
                    "cond[LCPMT_YMD::GTE]": START_DATE,
                    "cond[LCPMT_YMD::LT]": END_DATE,
                    type: 'json'
                }
            });

            const body = res.data.result;
            if (!body || !body.row) break;

            // 데이터 가공 및 좌표 변환
            const rows = body.row.map(item => {
                if (!item.x || !item.y) return null;
                try {
                    const coords = proj4(firstProjection, secondProjection, [parseFloat(item.x), parseFloat(item.y)]);
                    return { lat: coords[1], lng: coords[0] };
                } catch (e) { return null; }
            }).filter(r => r !== null);

            categoryData.push(...rows);

            // [핵심] totalCount와 현재까지 가져온 데이터 수 비교
            const totalCount = parseInt(body.header.totalCount || 0);
            if (pageNo * numOfRows < totalCount) {
                pageNo++;
            } else {
                hasMore = false;
            }
        }
    } catch (err) {
        console.error(`Error in ${apiPath}:`, err.message);
    }
    return categoryData;
}


async function fetchApiData(apiPath, startDate, endDate, pageNo) {
    const numOfRows = 100;
    const url = `https://apis.data.go.kr/1741000/${apiPath}/info`;
    
    try {
        const res = await axios.get(url, {
            params: {
                serviceKey: process.env.MOLIT_SERVICE_KEY,
                pageNo: pageNo,
                numOfRows: numOfRows,
                "cond[LCPMT_YMD::GTE]": startDate,
                "cond[LCPMT_YMD::LT]": endDate,
                type: 'json'
            },
            timeout: 20000
        });

        const responseBody = res.data.response?.body;
        const totalCount = Number(responseBody?.totalCount || 0);

        if (!responseBody || !responseBody.items || totalCount === 0) {
            return { data: [], totalCount: 0 };
        }

        let itemList = [];
        const items = responseBody.items.item;
        if (items) {
            itemList = Array.isArray(items) ? items : [items];
        }

        // --- 데이터 가공 로직 시작 ---
        const processed = itemList.map((item) => {
            const x = parseFloat(item.CRD_INFO_X);
            const y = parseFloat(item.CRD_INFO_Y);

            // 1. 좌표가 없거나 이상한 데이터 필터링
            if (!x || !y || isNaN(x) || isNaN(y)) return null;

            try {
                // 2. TM -> 위경도 변환 (proj4 사용)
                const [lng, lat] = proj4(EPSG5174, WGS84, [x, y]);

                // 3. 필요한 형식으로 매핑
                return {
                    title: item.BPLC_NM,
                    category: item.BZSTAT_SE_NM,
                    address: item.ROAD_NM_ADDR,
                    lat: lat,
                    lng: lng,
                    status: item.SALS_STTS_CD || '', // 영업상태
                    status_name:item.SALS_STTS_NM || '',
                    manageNo: item.MNG_NO,
                    updatedAt: item.DAT_UPDT_PNT
                };
            } catch (error) {
                return null;
            }
        }).filter(item => item !== null); // null값 제거
        // --- 데이터 가공 로직 끝 ---

        // ★ 'processed' 변수를 여기서 반환합니다.
        return { data: processed, totalCount: totalCount };

    } catch (err) {
        console.error(`❌ API Error (${apiPath}):`, err.message);
        return { data: [], totalCount: 0 };
    }
}


// 2. syncGovernmentData: totalCount 기반으로 루프 제어
async function syncGovernmentData(startDate, endDate) {
    let syncCount = 0;
    // Object.keys를 써야 OP_L_... 같은 API 코드가 들어옵/니다.
    const apiCodes = Object.keys(TARGET_APIS); 

    for (const apiPath of apiCodes) {
        let pageNo = 1;
        let totalCount = 0;
        const numOfRows = 100;

        console.log(`📡 [${TARGET_APIS[apiPath]}] 동기화 시작...`);

        while (true) {
            // fetchApiData가 이제 객체를 반환함 { data, totalCount }
            const result = await fetchApiData(TARGET_APIS[apiPath], startDate, endDate, pageNo);
            totalCount = result.totalCount;
            // 데이터가 있으면 저장
            if (result.data.length > 0) {
                for (const item of result.data) {
                    await pool.query(`
                        INSERT INTO gov_permit_info 
                        (manage_num, biz_name, addr_road, status_code, status_name, lat, lng)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                        ON DUPLICATE KEY UPDATE 
                            status_code = VALUES(status_code),
                            status_name = VALUES(status_name),
                            biz_name = VALUES(biz_name),
                            addr_road = VALUES(addr_road),
                            lat = VALUES(lat),
                            lng = VALUES(lng)
                    `, [
                            item.manageNo,   // fetchApiData에서 정의한 키값 사용
                            item.title,      // item.biz_name (X) -> item.title (O)
                            item.address,    // item.addr_road (X) -> item.address (O)
                            item.status,
                            item.status_name,     // item.status_name (X) -> item.status (O)
                            item.lat,
                            item.lng
                        ]);
                    syncCount++;
                }
            }

            console.log(`📑 [${apiPath}] ${pageNo}페이지 처리 완료 (현재까지 ${syncCount}건 저장)`);
            // ★ 핵심: 현재 페이지까지 불러온 개수가 전체 개수(totalCount)보다 적으면 다음 페이지로
            if (pageNo * numOfRows < totalCount) {
                pageNo++;
            } else {
                // 더 이상 가져올 데이터가 없으면 루프 종료
                break; 
            }
        }
    }
    
    await pool.query("INSERT INTO api_sync_log (sync_date, total_count, status) VALUES (?, ?, ?)", [endDate, syncCount, 'SUCCESS']);
    console.log(`✅ [${startDate}] 총 ${syncCount}건 동기화 완료`);
}

app.get('/api/asy', async (req, res) => {
    try {
        const queryStartDate = req.query.startDate;
        const queryEndDate = req.query.endDate;
        const startDate = queryStartDate || getDateStringByOffset(-14);
        const endDate = queryEndDate || getDateStringByOffset(-2);

        if (!isValidYyyymmdd(startDate) || !isValidYyyymmdd(endDate)) {
            return res.status(400).json({
                success: false,
                error: "startDate/endDate는 YYYYMMDD 형식이어야 합니다."
            });
        }
        if (startDate > endDate) {
            return res.status(400).json({
                success: false,
                error: "startDate는 endDate보다 클 수 없습니다."
            });
        }

        console.log(`🚀 [수동 동기화] ${startDate} ~ ${endDate} 구간 시작`);
        await syncGovernmentData(startDate, endDate);
        return res.json({
            success: true,
            message: "수동 동기화 완료",
            startDate,
            endDate
        });
    } catch (error) {
        console.error("❌ [수동 동기화] 실패:", error.message);
        return res.status(500).json({
            success: false,
            error: "수동 동기화 중 오류가 발생했습니다."
        });
    }
});


//인구 조사
app.get('/api/analysis/population', async (req, res) => {
    const { address } = req.query; // 클라이언트에서 보낸 주소 (예: "부산 강서구 명지동 3506-4")
    if (!address) return res.status(400).json({ error: "주소가 필요합니다." });

    try {
        const token = await getSgisToken();
        if (!token) throw new Error("토큰 발급 실패");

        // [STEP 1] 지오코딩을 통해 adm_cd(행정동 코드) 가져오기
        
        const geoRes = await axios.get(`https://sgisapi.mods.go.kr/OpenAPI3/addr/geocode.json`, {
            params: {
                accessToken: token,
                address: address
            }
        });

        const geoResult = geoRes.data.result?.resultdata[0];
        if (!geoResult) return res.status(404).json({ error: "해당 주소의 행정 코드를 찾을 수 없습니다." });

        const adm_cd = geoResult.adm_cd; // 예: 2112059 (명지1동)
        const adm_nm = geoResult.adm_nm; // 실제 매칭된 행정동 명칭

        // [STEP 2] 인구 데이터 조회 (성별/연령대)
        // searchpopulation은 조건에 맞는 인구 '수'를 반환합니다. 
        // 전체 성별/연령대를 한 번에 가져오기 위해 '인구 통계 API'를 사용하거나 
        // 루프를 돌려 필요한 연령대별로 호출할 수 있습니다.
        
        const requestConfigs = [
            { type: 'age_eq_10', gender: '0', age: '31' },
            { type: 'age_eq_20', gender: '0', age: '32' },
            { type: 'age_eq_30', gender: '0', age: '33' },
            { type: 'age_eq_40', gender: '0', age: '34' },
            { type: 'age_eq_50', gender: '0', age: '35' },
            { type: 'age_eq_60', gender: '0', age: '36' },
            { type: 'age_gte_70', gender: '0', age: '40' },
            { type: 'male',   gender: '1'},
            { type: 'female', gender: '2'}
        ];

        const populationResults = {};

        // [STEP 3] 3개씩 묶어서 3번 실행 (배치 처리)
        for (let i = 0; i < requestConfigs.length; i += 3) {
            const batch = requestConfigs.slice(i, i + 3);
            
            const batchPromises = batch.map(config => {
                // 파라미터 조립 (age가 있을 때만 포함)
                const params = {
                    accessToken: token,
                    year: '2023',
                    adm_cd: adm_cd,
                    gender: config.gender,
                    low_search: '0'
                };
                if (config.age) params.age_type = config.age;

                return axios.get(`https://sgisapi.mods.go.kr/OpenAPI3/stats/searchpopulation.json`, { params })
                    .then(r => ({
                        id: config.type,
                        count: parseInt(r.data.result?.[0]?.population || 0)
                    }));
            });

            const batchResults = await Promise.all(batchPromises);
            batchResults.forEach(res => {
                populationResults[res.id] = res.count;
            });

            console.log(`📦 배치 (${i/3 + 1}/3) 완료:`, batch.map(b => b.id).join(', '));

        }
        res.json({
            address,
            adm_nm,
            adm_cd,
            data: populationResults,
            total_sum: (populationResults.male || 0) + (populationResults.female || 0)
        });

    } catch (err) {
        console.error("인구 분석 오류:", err);
        res.status(500).json({ error: "데이터 조회 중 오류 발생" });
    }
});






const downloadFile = async (url, filename) => {
    try {
        const response = await axios({
            url,
            method: 'GET',
            responseType: 'stream'
        });
        
        // 파일 확장자 추출 (없으면 .tmp)
        let ext = path.extname(url).split('?')[0] || '.tmp';
        // hwp, hwpx, pdf가 아니면 강제로 처리 (공고문들이 url에 확장자가 없는 경우가 있음)
        if (!['.hwp', '.hwpx', '.pdf'].includes(ext.toLowerCase())) {
             // Content-Disposition 헤더 확인 로직이 복잡하므로, 
             // 여기서는 일단 hwp로 가정하거나 url 패턴에 따라 처리 필요.
             // 간단하게 사용자가 넘겨준 filename의 확장자를 우선 사용
             ext = path.extname(filename) || ext;
        }

        const savePath = path.join(TEMP_DIR, `download_${Date.now()}${ext}`);
        await pipeline(response.data, fs.createWriteStream(savePath));
        return savePath;
    } catch (error) {
        console.error('파일 다운로드 실패:', error);
        throw new Error('파일 다운로드에 실패했습니다.');
    }
};

/**
 * [함수 2] 파이썬 스크립트로 텍스트 추출
 */
const extractTextFromDoc = (filePath) => {
    return new Promise((resolve, reject) => {
        const command = `"${PYTHON_PATH}" "${PARSER_SCRIPT}" "${filePath}"`;
        
        exec(command, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
            if (error) {
                console.error("Extract Error:", stderr);
                reject(error);
                return;
            }
            resolve(stdout.trim());
        });
    });
};

/**
 * [함수 3] GPT에게 요약 요청
 */
const summarizeWithGPT = async (text) => {
    if (!text || text.length < 50) return "내용을 추출할 수 없거나 문서가 비어있습니다.";

    // 토큰 비용 절약을 위해 앞부분 4000자만 사용 (공고문 핵심은 보통 앞부분에 있음)
    const slicedText = text;

    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini", // 가성비 모델 사용
            messages: [
                {
                    role: "system",
                    content: "너는 소상공인 지원사업 전문가야. 공고문을 읽고 구체적으로 다음 5가지 항목을 불렛포인트 없이 줄글로 10줄 이내로 보기좋게 줄을 바꾸어서 요약해줘. [1.지원 대상, 2.지원 내용(금액), 3.신청 방법, 4.필수 서류, 5.유의 사항]. 말투는 '~~합니다.' 처럼 정중하게 해줘."
                },
                {
                    role: "user",
                    content: `다음 공고문 내용을 요약해줘:\n\n${slicedText}`
                }
            ],
            temperature: 0.5,
        });
        return completion.choices[0].message.content;
    } catch (error) {
        console.error("GPT Error:", error);
        throw new Error("AI 요약 중 오류가 발생했습니다.");
    }
};

/**
 * [API] 요약 생성 및 DB 업데이트 엔드포인트
 */
app.post('/api/support/summarize', async (req, res) => {
    const { id, fileUrl, fileName } = req.body;

    if (!fileUrl) return res.status(400).json({ error: '파일 URL이 없습니다.' });

    let savedFilePath = null;

    try {
        console.log(`[시작] 요약 요청: ID ${id}, 파일: ${fileName}`);

        // 1. 파일 다운로드
        savedFilePath = await downloadFile(fileUrl, fileName);
        console.log(`[1/4] 다운로드 완료: ${savedFilePath}`);

        // 2. 텍스트 추출
        const extractedText = await extractTextFromDoc(savedFilePath);
        console.log(`[2/4] 텍스트 추출 완료 (${extractedText.length}자)`);

        // 3. GPT 요약
        const summary = await summarizeWithGPT(extractedText);
        console.log(`[3/4] GPT 요약 완료`);

        // 4. DB 업데이트 (선택 사항: 다음에 또 요청하지 않도록 DB에 저장)
        // support_programs 테이블에 summary 컬럼이 있다고 가정
        //if (id) {
        //    await pool.query('UPDATE support_programs SET summary = ? WHERE id = ?', [summary, id]);
        //}

        // 5. 임시 파일 삭제
        fs.unlinkSync(savedFilePath);

        res.json({ success: true, summary });

    } catch (error) {
        console.error("요약 프로세스 실패:", error);
        // 에러 나도 임시 파일은 삭제 시도
        if (savedFilePath && fs.existsSync(savedFilePath)) fs.unlinkSync(savedFilePath);
        res.status(500).json({ error: error.message });
    }
});