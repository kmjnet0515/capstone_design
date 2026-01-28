import os
import pandas as pd
import pymysql
from sqlalchemy import create_engine, text
from pyproj import Transformer
from dotenv import load_dotenv

# 1. .env 환경 변수 로드
load_dotenv()

def get_db_engine():
    user = os.getenv('DB_USER')
    password = os.getenv('DB_PASS')
    host = os.getenv('DB_HOST')
    dbname = os.getenv('DB_NAME')
    db_url = f"mysql+pymysql://{user}:{password}@{host}/{dbname}?charset=utf8mb4"
    return create_engine(db_url)

def setup_database():
    """기존 테이블 삭제 후 신규 테이블 생성 (인덱스 최소화하여 속도 향상)"""
    engine = get_db_engine()
    
    drop_table_query = text("DROP TABLE IF EXISTS gov_permit_info;")
    
    # 인덱스는 데이터 적재 완료 후 별도로 생성합니다.
    create_table_query = text("""
    CREATE TABLE gov_permit_info (
        manage_num VARCHAR(100) PRIMARY KEY, 
        biz_name VARCHAR(255),
        addr_road VARCHAR(500),
        status_code INT,
        status_name VARCHAR(50),
        permit_date VARCHAR(20),
        close_date VARCHAR(20),
        lat DOUBLE,
        lng DOUBLE,
        main_cat VARCHAR(50),
        sub_cat VARCHAR(100)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """)
    
    try:
        with engine.begin() as conn:
            conn.execute(drop_table_query)
            conn.execute(create_table_query)
        print("✅ 테이블 초기화 완료. (인덱스 미생성 상태)")
    except Exception as e:
        print(f"❌ 테이블 설정 중 에러 발생: {e}")

def upload_csv_with_coord_conversion(base_path):
    engine = get_db_engine()
    # 좌표 변환기 설정: EPSG:5174 (Bessel 중부원점) -> EPSG:4326 (WGS84 위경도)
    transformer = Transformer.from_crs("EPSG:5174", "EPSG:4326", always_xy=True)
    
    categories = ['건강', '기타', '동물', '문화', '생활', '식품']
    
    # CSV 한글 컬럼명 -> DB 영문 컬럼명 매핑
    col_map = {
        '사업장명': 'biz_name', 
        '도로명주소': 'addr_road', 
        '영업상태코드': 'status_code',
        '영업상태명': 'status_name', 
        '인허가일자': 'permit_date', 
        '폐업일자': 'close_date',
        '좌표정보(X)': 'x', 
        '좌표정보(Y)': 'y', 
        '관리번호': 'manage_num'
    }

    # 본 테이블 구조와 일치시키기 위해 반드시 존재해야 하는 컬럼 리스트
    required_cols = [
        'manage_num', 'biz_name', 'addr_road', 'status_code', 
        'status_name', 'permit_date', 'close_date'
    ]

    print("🚀 데이터 변환 및 적재 시작...")

    for cat in categories:
        cat_path = os.path.join(base_path, cat)
        if not os.path.exists(cat_path): continue
            
        for file in [f for f in os.listdir(cat_path) if f.endswith('.csv')]:
            file_path = os.path.join(cat_path, file)
            try:
                # 1. 데이터 로드 (cp949)
                df = pd.read_csv(file_path, encoding='cp949', low_memory=False)
                
                # 2. 필요한 컬럼만 추출 및 이름 변경
                available_cols = [c for c in col_map.keys() if c in df.columns]
                df = df[available_cols].rename(columns=col_map)
                
                # [핵심] CSV에 없는 컬럼(예: 폐업일자)을 빈 값으로 강제 생성하여 DB 구조와 일치시킴
                for col in required_cols:
                    if col not in df.columns:
                        df[col] = None

                # 3. 필수 데이터 정제 (좌표와 관리번호가 없는 행 제거)
                df = df.dropna(subset=['x', 'y', 'manage_num'])
                
                # 4. 상태 코드 정규화 (03 -> 3, 01 -> 1)
                df['status_code'] = pd.to_numeric(df['status_code'], errors='coerce').fillna(0).astype(int)
                
                # 5. 좌표 변환 실행 (X, Y -> Lng, Lat)
                lngs, lats = transformer.transform(df['x'].values, df['y'].values)
                df['lng'] = lngs
                df['lat'] = lats
                
                # 6. 메타 정보 추가 및 파일 내 중복 제거
                df['main_cat'] = cat
                df['sub_cat'] = file.replace('.csv', '')
                df = df.drop(columns=['x', 'y']).drop_duplicates(subset=['manage_num'])

                # 7. 임시 테이블에 업로드 (컬럼 순서/개수 강제 고정)
                # 본 테이블 컬럼 순서와 동일하게 정렬하여 전송
                final_col_order = [
                    'manage_num', 'biz_name', 'addr_road', 'status_code', 'status_name', 
                    'permit_date', 'close_date', 'lat', 'lng', 'main_cat', 'sub_cat'
                ]
                df = df[final_col_order]
                
                df.to_sql(name='temp_gov_info', con=engine, if_exists='replace', index=False)
                
                # 8. UPSERT 실행 (INSERT ... ON DUPLICATE KEY UPDATE)
                upsert_query = text("""
                    INSERT INTO gov_permit_info (
                        manage_num, biz_name, addr_road, status_code, status_name, 
                        permit_date, close_date, lat, lng, main_cat, sub_cat
                    )
                    SELECT 
                        manage_num, biz_name, addr_road, status_code, status_name, 
                        permit_date, close_date, lat, lng, main_cat, sub_cat 
                    FROM temp_gov_info
                    ON DUPLICATE KEY UPDATE
                        status_code = VALUES(status_code),
                        status_name = VALUES(status_name),
                        close_date = VALUES(close_date),
                        biz_name = VALUES(biz_name),
                        lat = VALUES(lat),
                        lng = VALUES(lng);
                """)
                
                with engine.begin() as conn:
                    conn.execute(upsert_query)
                print(f"✅ {cat}/{file} 적재 완료 (건수: {len(df)})")
                
            except Exception as e:
                print(f"❌ 오류 발생 ({file}): {e}")

    # 9. 모든 작업 완료 후 임시 테이블 삭제
    with engine.begin() as conn:
        conn.execute(text("DROP TABLE IF EXISTS temp_gov_info;"))
    print("✨ 모든 데이터 적재가 완료되었습니다.")

if __name__ == "__main__":
    setup_database()
    upload_csv_with_coord_conversion('인허가정보')