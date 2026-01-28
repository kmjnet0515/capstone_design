import os
import pymysql
import pandas as pd
from dotenv import load_dotenv

# 환경 변수 로드
load_dotenv()

aws_config = {
    'host': os.getenv('DB_HOST'),
    'user': os.getenv('DB_USER'),
    'password': os.getenv('DB_PASS'),
    'db': os.getenv('DB_NAME'),
    'charset': 'utf8mb4'
}

local_config = {
    'host': 'localhost',
    'user': 'root',
    'password': '12341234',
    'db': 'capstone_db',
    'charset': 'utf8mb4'
}

def get_address_prefix(address):
    if not address: return ""
    parts = address.split()
    return " ".join(parts[:4]) if len(parts) >= 4 else address

def start_mapping_analysis():
    aws_conn = pymysql.connect(**aws_config)
    local_conn = pymysql.connect(**local_config)
    
    # 중복 체크를 위한 set (AWS업종, 정부업종)
    seen_mappings = set()
    mapping_results = []
    before = 0
    try:
        with aws_conn.cursor(pymysql.cursors.DictCursor) as aws_cur, \
             local_conn.cursor(pymysql.cursors.DictCursor) as local_cur:
            
            # 1. AWS 업종 리스트 가져오기
            aws_cur.execute("SELECT DISTINCT category_small_name FROM market_info WHERE category_small_name IS NOT NULL")
            categories = [row['category_small_name'] for row in aws_cur.fetchall()]
            
            for idx, cat in enumerate(categories):
                print(f"🔄 [{idx+1}/{len(categories)}] '{cat}' 분석 중 (전국 랜덤 300건)...")
                
                # 2. ORDER BY RAND()를 사용하여 전국에서 랜덤하게 300건 추출
                aws_query = """
                    SELECT store_name, address_road, category_small_name 
                    FROM market_info 
                    WHERE category_small_name = %s 
                    AND address_road IS NOT NULL
                    AND CHAR_LENGTH(store_name) >= 4;
                """
                aws_cur.execute(aws_query, (cat,))
                samples = aws_cur.fetchall()
                
                for row in samples:
                    s_name = row['store_name']
                    addr_prefix = get_address_prefix(row['address_road'])
                    
                    # 3. 로컬 DB 매칭
                    local_query = """
                        SELECT sub_cat FROM gov_permit_info 
                        WHERE biz_name = %s AND addr_road LIKE %s
                    """
                    local_cur.execute(local_query, (f"{s_name}", f"{addr_prefix}%"))
                    matches = local_cur.fetchall()
                    
                    for m in matches:
                        gov_cat = m['sub_cat']
                        # 4. (AWS업종, 정부업종) 쌍이 처음 발견된 경우만 저장
                        mapping_pair = (cat, gov_cat)
                        if mapping_pair not in seen_mappings:
                            seen_mappings.add(mapping_pair)
                            mapping_results.append({
                                'AWS_소분류업종': cat,
                                '정부_상세업종': gov_cat,
                                '예시_상호명': s_name # 확인용 샘플 상호
                            })
                after = len(mapping_results)
                print(f"개수 : {after - before}")
                before = after
        # 5. 결과 저장
        if mapping_results:
            df = pd.DataFrame(mapping_results)
            df.to_csv('industry_mapping_map2.csv', index=False, encoding='utf-8-sig')
            print(f"\n✨ 분석 완료! 'industry_mapping_map2.csv'를 확인하세요.")
            print(f"총 {len(mapping_results)}개의 유니크한 업종 매핑 쌍을 찾았습니다.")

    finally:
        aws_conn.close()
        local_conn.close()

if __name__ == "__main__":
    start_mapping_analysis()