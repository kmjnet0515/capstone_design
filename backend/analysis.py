import os
import mysql.connector
import requests
import pandas as pd
from dotenv import load_dotenv
import time
import json
import math
import sys
import select
# 1. 환경 설정
load_dotenv()
SERVICE_KEY = os.getenv("MOLIT_SERVICE_KEY")
BASE_URL = "https://apis.data.go.kr/1741000"
CSV_FILE = "address_mapping_results.csv"

def get_db_connection():
    return mysql.connector.connect(
        host=os.getenv("DB_HOST"),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASS"),
        database=os.getenv("DB_NAME")
    )

def get_value_deep(d, target_key):
    if not isinstance(d, dict): return None
    if target_key in d: return d[target_key]
    for v in d.values():
        res = get_value_deep(v, target_key)
        if res is not None: return res
    return None

def fetch_mapping_data():
    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)
    
    # [STEP 0] 체크포인트 로직
    completed_categories = set()
    if os.path.exists(CSV_FILE):
        try:
            df_existing = pd.read_csv(CSV_FILE)
            if not df_existing.empty:
                completed_categories = set(df_existing['internal_category'].unique())
                print(f"✅ 완료 업종 건너뜀: {len(completed_categories)}개")
        except: pass

    cursor.execute("SELECT DISTINCT small_name FROM categories")
    category_list = [row['small_name'] for row in cursor.fetchall() if row['small_name'] not in completed_categories]
    
    # target_apis는 사용자님의 기존 195개 리스트를 그대로 사용하세요 (여기선 생략)
    target_apis = {
'식품_즉석판매제조가공업' : 'instant_food_processors',
'식품_휴게음식점' : 'rest_cafes',
'식품_유흥주점영업' : 'entertainment_bars',
'식품_축산판매업' : 'livestock_retail',
'식품_축산물운반업' : 'livestock_transport',
'식품_용기및포장지제조업' : 'container_packaging_manufacturers',
'식품_유통전문판매업' : 'distribution_specialty_retailers',
'식품_식품냉동냉장업' : 'food_freezing_refrigeration',
'식품_식용얼음판매업' : 'edible_ice_retailers',
'자원환경_고압가스업' : 'high_pressure_gas',
'식품_식품제조가공업' : 'food_manufacturing_processors',
'자원환경_계랑기제조업' : 'weighing_instrument_manufacturing',
'식품_식품자동판매기업' : 'food_vending_machines',
'자원환경_계랑기수입업' : 'weighing_instrument_import',
'자원환경_계랑기수리업' : 'weighing_instrument_repair',
'식품_식품소분업' : 'food_repackagers',
'생활_통신판매업' : 'ecommerce_businesses',
'자원환경_건설폐기물처리업' : 'construction_waste_disposal',
'자원환경_가축분뇨수집운반업' : 'manure_collection_transport',
'자원환경_개인하수처리시설관리업(사업장)' : 'small_sewage_facility_management',
'자원환경_가촉분뇨배출시설관리업(사업장)' : 'manure_facility_management',
'식품_용기냉동기특정설비' : 'container_refrigeration_equipment',
'식품_옹기류제조업' : 'onggi_manufacturers',
'자원환경_제재업' : 'sawmills',
'자원환경_저수조청소업' : 'water_tank_cleaning',
'자원환경_전력기술설계업체' : 'power_design_companies',
'생활_방문판매업' : 'door_to_door_sales',
'자원환경_지하수정화업체' : 'groundwater_remediation',
'자원환경_전력기술감리업체' : 'power_supervision_companies',
'건강_의류기기판매(임대)업' : 'medical_device_sales_rental',
'건강_의류기기수리업' : 'medical_device_repair',
'건강_의원' : 'clinics',
'건강_의료유사업' : 'medical_related_businesses',
'건강_의료법인' : 'medical_corporations',
'건강_응급환자이송업' : 'emergency_patient_transport',
'건강_약국' : 'pharmacies',
'건강_부속의료기관' : 'affiliated_medical_institutions',
'건강_병원' : 'hospitals',
'기타_유료직업소개소' : 'paid_job_centers',
'기타_장례지도사_교육기관' : 'funeral_director_training',
'기타_승강기제조및수입업체' : 'elevator_manufacturers_importers',
'기타_상조업' : 'funeral_service_providers',
'기타_민방위급수시설' : 'civil_defense_water_facilities',
'기타_물류창고업체' : 'logistics_warehouses',
'기타_국제물류주선업' : 'international_logistics_forwarders',
'기타_담배수입판매업체' : 'tobacco_import_retailers',
'기타_담배소매업' : 'tobacco_retailers',
'기타_담배도매업' : 'tobacco_wholesalers',
'기타_출판사' : 'publishers',
'기타_인쇄사' : 'printing_shops',
'기타_옥외광고업' : 'outdoor_advertising_companies',
'건강_산후조리업' : 'postpartum_care',
'건강_치과기공소' : 'dental_labs',
'문화_관광궤도업' : 'tourist_railways',
'문화_관광공연장업' : 'tourist_performance_halls',
'문화_일반게임제공업' : 'general_game_providers',
'문화_게임물제작업' : 'game_producers',
'생활_승마장업' : 'horse_riding',
'생활_의료기관세탁물처리업' : 'medical_laundry',
'문화_영화배급업' : 'film_distributors',
'문화_국내외여행업' : 'domestic_international_travel_agencies',
'문화_국내여행업' : 'domestic_travel_agencies',
'문화_한옥체험업' : 'hanok_experience',
'문화_자동차야영장업' : 'auto_campgrounds',
'문화_일반야영장업' : 'general_campgrounds',
'문화_테마파크업(기타)' : 'amusement_facilities_other',
'문화_박물관_및_미술관' : 'museums_and_art_galleries',
'문화_국제회의시설업' : 'international_convention_facilities',
'문화_관광사업자' : 'tourism_businesses',
'문화_전통사찰' : 'traditionalles',
'문화_전문휴양업' : 'special_resorts',
'문화_문화예술법인' : 'cultural_art_corporations',
'문화_비디오물감상실업' : 'video_viewing_rooms',
'문화_숙박업' : 'lodgings',
'생활_목욕장업' : 'public_baths',
'문화_비디오물제작업' : 'video_producers',
'생활_요트장업' : 'yacht_marinas',
'문화_비디오물배급업' : 'video_distributors',
'문화_비디오물소극장업' : 'video_mini_theaters',
'생활_무도학원업' : 'dance_academies',
'생활_무도장업' : 'dance_halls',
'생활_등록체육시설업' : 'registered_sports_facilities',
'생활_당구장업' : 'billiard_halls',
'생활_골프장' : 'golf_courses',
'생활_골프연습장업' : 'golf_practice_ranges',
'문화_공연장' : 'performance_halls',
'생활_전화권유판매업' : 'telemarketing_sales',
'생활_다단계판매업체' : 'multilevel_marketing',
'생활_세탁업' : 'laundries',
'생활_이용업' : 'barber_shops',
'문화_음반물제작업' : 'record_producers',
'문화_음반및음악영상물제작업' : 'music_video_producers',
'문화_온라인음악서비스제공업' : 'online_music_services',
'문화_영화제작업' : 'film_producers',
'문화_영화수입업' : 'film_importers',
'문화_영화상영업' : 'film_screenings',
'문화_영화상영관' : 'movie_theaters',
'동물_동물약국' : 'animal_pharmacies',
'동물_동물생산업' : 'animal_breeding',
'동물_동물미용업' : 'pet_grooming',
'식품_집유업' : 'milk_collection',
'동물_동물전시업' : 'animal_exhibition',
'자원환경_석유및석유대체연료판매업체' : 'petroleum_alt_fuel_retailers',
'자원환경_석유판매업' : 'oil_retailers',
'동물_동물장묘업' : 'animal_cremation',
'동물_동물위탁관리업' : 'animal_boarding',
'동물_동물운송업' : 'animal_transport',
'동물_동물용의약품도매상' : 'veterinary_drug_wholesalers',
'동물_사료제조업' : 'feed_manufacturers',
'동물_부화업' : 'hatcheries',
'동물_도축업' : 'slaughterhouses',
'동물_가축인공수정소' : 'artificial_insemination_centers',
'동물_가축사육업' : 'livestock_farming',
'동물_동물판매업' : 'animal_sales',
'자원환경_석연탄제조업' : 'briquette_manufacturers',
'자원환경_원목생산업' : 'log_production',
'자원환경_목재수입유통업' : 'lumber_import_distribution',
'자원환경_쓰레기종량제봉투판매업' : 'pay_as_you_throw_bag_retailers',
'자원환경_소독업' : 'disinfection_companies',
'자원환경_분뇨수집운반업' : 'night_soil_collection_transport',
'동물_동물수입업' : 'animal_import',
'동물_동물병원' : 'animal_hospitals',
'자원환경_환경컨설팅회사' : 'environment_consulting_companies',
'자원환경_환경측정대행업' : 'environment_measurement_agencies',
'자원환경_환경전문공사업' : 'environment_contractors',
'자원환경_환경관리대행기관' : 'environment_management_agencies',
'식품_집단급식소식품판매업' : 'group_meal_food_retailers',
'식품_축산물보관업' : 'livestock_storage',
'식품_제과점영업' : 'bakeries',
'식품_단란주점영업' : 'singing_bars',
'식품_축산가공업' : 'livestock_processing',
'식품_관광식당' : 'tourist_restaurants',
'기타_무료직업' : '소개소free_job_centers',
'식품_식품판매업(기타)' : 'other_food_retailers',
'기타_요양보호사교육기관' : 'caregiver_training',
'기타_승강기유지관리업체' : 'elevator_maintenance',
'식품_식품첨가물제조업' : 'food_additive_manufacturers',
'문화_외국인관광도시민박업' : 'foreigner_city_homestays',
'문화_농어촌민박업' : 'rural_homestays',
'식품_식품운반업' : 'food_transporters',
'문화_관광펜션업' : 'tourist_pensions',
'문화_관광숙박업' : 'tourist_accommodations',
'식품_식육포장처리업' : 'meat_packers',
'문화_비디오물시청제공업' : 'video_streaming_providers',
'식품_건강기능식품일반판매업' : 'health_functional_food_general_retailers',
'문화_노래연습장업' : 'karaoke_rooms',
'식품_집단급식소' : 'group_meal_facilities',
'식품_위탁급식영업' : 'contract_catering',
'문화_대중문화예술기획업' : 'pop_culture_art_planners',
'문화_국제회의기획업' : 'international_convention_planners',
'생활_체육도장업' : 'martial_arts_dojo',
'생활_체력단련장업' : 'fitness_centers',
'문화_지방문화원' : 'local_culture_centers',
'생활_종합체육시설업' : 'comprehensive_sports_facilities',
'문화_종합휴양업' : 'comprehensive_resorts',
'자원환경_수질오염원설치시설(기타)' : 'water_pollution_source_other',
'문화_종합테마파크업' : 'comprehensive_amusement_facilities',
'생활_썰매장업' : 'sledding',
'문화_일반테마파크업' : 'general_amusement_facilities',
'자원환경_배출가스전문정비사업자(확인검사대행자)' : 'emission_inspection_agencies',
'문화_시내순환관광업' : 'city_tour_businesses',
'자원환경_대기오염물질배출시설설치사업장' : 'air_pollution_facility_installation',
'생활_스키장' : 'ski_resorts',
'자원환경_단독정화조_및_오수처리시설설계시공업' : 'septic_sewage_design_build',
'생활_수영장업' : 'swimming_pools',
'문화_관광유람선업' : 'tourist_cruises',
'자원환경_급수공사대행업' : 'water_supply_agents',
'생활_빙상장업' : 'ice_rinks',
'문화_관광극장유흥업' : 'tourist_theater_entertainment',
'자원환경_건물위생관리업' : 'building_sanitation',
'문화_청소년게임제공업' : 'youth_game_providers',
'문화_인터넷컴퓨터게임시설제공업' : 'pc_bangs',
'문화_복합유통게임제공업' : 'mixed_game_providers',
'문화_복합영상물제공업' : 'mixed_video_content_providers',
'생활_후원방문판매업체' : 'sponsored_door_to_door_sales',
'문화_게임물배급업' : 'game_distributors',
'동물_종축업' : 'breeding_stock_businesses',
'자원환경_지하수영향조사기관' : 'groundwater_impact_assessment',
'자원환경_지하수시공업체' : 'groundwater_construction',
'자원환경_특정고압가스업' : 'specific_high_pressure_gas',
'생활_대규모점포' : 'large_scale_retail_stores',
'자원환경_일반도시가스업체' : 'city_gas_companies',
'자원환경_액화석유가스용품제조업체' : 'lpg_equipment_manufacturers',
'생활_미용업' : 'beauty_salons',
'문화_음반물배급업' : 'record_distributors',
'문화_음반및음악영상물배급업' : 'music_video_distributors',
'자원환경_계랑기증명업' : 'weighing_instrument_certification',
'건강_안경업' : 'optical_shops',
'문화_종합여행업' : 'comprehensive_travel_agencies',
'식품_일반음식점' : 'general_restaurants',
'식품_외국인전용유흥음식점업' : 'foreigners_entertainment_restaurants',
'건강_안전상비의약품_판매업소' : 'over_the_counter_medicine_stores',
'식품_관광유흥음식점업' : 'tourist_entertainment_restaurants'}

    mapping_results = []
    if os.path.exists(CSV_FILE):
        mapping_results = pd.read_csv(CSV_FILE).to_dict('records')

    for small_cat in category_list:
        print(f"\n🔎 [분석 시작] {small_cat}")
        print(small_cat)
        print(">> 3초 안에 Enter를 치면 스킵합니다...")
        # sys.stdin에 데이터가 들어오는지 3초간 감시
        i, o, e = select.select([sys.stdin], [], [], 3)

        if i:
            sys.stdin.readline() # 입력 버퍼 비우기
            print(f"⏩ {small_cat} 스킵!")
            continue
        else:
            print("⏰ 시간 초과: 분석을 시작합니다.")
        cursor.execute("""
            SELECT store_name, address_road, category_small_name FROM market_info 
            WHERE category_small_name = %s AND CHAR_LENGTH(store_name) >= 5 AND address_road IS NOT NULL LIMIT 30
        """, (small_cat,))
        samples = cursor.fetchall()
        if not samples: continue

        category_found = False
        c = 0

        for api_name, api_path in target_apis.items():
            c += 1
            if category_found: break # 이미 찾았으면 다음 API 안 봄

            for row in samples:
                if category_found: break
                
                store = row['store_name']
                addr_parts = row['address_road'].split(' ')
                search_addr = " ".join(addr_parts[0:4]) if len(addr_parts) >= 4 else row['address_road']

                # --- [핵심: 페이지네이션 루프 시작] ---
                page_no = 1
                num_of_rows = 100 # 한 번에 최대치로 가져옴
                
                while True:
                    params = {
                        "serviceKey": SERVICE_KEY,
                        "pageNo": str(page_no),
                        "numOfRows": str(num_of_rows),
                        "cond[ROAD_NM_ADDR::LIKE]": search_addr,
                        "type": "json"
                    }
                    
                    try:
                        api_url = f"{BASE_URL}/{api_path}/info"
                        response = requests.get(api_url, params=params, timeout=10)
                        if response.status_code != 200: break
                        
                        data = response.json()
                        total_count = get_value_deep(data, 'totalCount')
                        print(c, row, total_count, api_path)
                        total_count = int(get_value_deep(data, 'totalCount') or 0)
                        
                        # 아이템 추출
                        items_wrapper = get_value_deep(data, 'items')
                        items = []
                        if isinstance(items_wrapper, dict): items = items_wrapper.get('item', [])
                        elif isinstance(items_wrapper, list): items = items_wrapper
                        if isinstance(items, dict): items = [items] # 단일 항목 예외처리

                        if not items: break # 더 이상 데이터 없으면 종료

                        # 상호명 비교
                        for item in items:
                            gov_store_name = item.get('BPLC_NM', '')
                            if store in gov_store_name or gov_store_name in store:
                                print(f"🎯 매칭 성공: {small_cat} (Page {page_no}/{math.ceil(total_count/num_of_rows)})")
                                mapping_results.append({
                                    "internal_category": small_cat, "gov_api_name": api_name,
                                    "gov_endpoint": api_path, "gov_business_type": item.get('BZSTAT_SE_NM'),
                                    "matched_store": store, "matched_addr": item.get('RDNWH_DETAIL_ADDR')
                                })
                                category_found = True
                                break
                        
                        if category_found: break
                        
                        # 다음 페이지로 가야 하는지 판단
                        if page_no * num_of_rows >= total_count:
                            break # 모든 데이터 다 봤음
                        else:
                            page_no += 1
                            time.sleep(0.05) # 서버 부하 방지
                            
                    except Exception as e:
                        print(f"⚠️ 에러: {e}")
                        break
                # --- [페이지네이션 루프 끝] ---

            if category_found:
                pd.DataFrame(mapping_results).to_csv(CSV_FILE, index=False, encoding="utf-8-sig")

    conn.close()
if __name__ == "__main__":
    fetch_mapping_data()