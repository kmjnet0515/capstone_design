import os
import pandas as pd
import pymysql
from sqlalchemy import create_engine

def upload_all_csv_to_db(base_path):
    # 1. DB 연결 설정 (SQLAlchemy 사용 시 Pandas의 to_sql이 훨씬 빠름)
    db_url = "mysql+pymysql://root:12341234@localhost/capstone_db?charset=utf8mb4"
    engine = create_engine(db_url)
    
    categories = ['건강', '기타', '동물', '문화', '생활', '식품']
    
    # DB 컬럼과 매칭될 수 있는 CSV 컬럼 후보군 (리포트 분석 기반)
    col_map = {
        'biz_name': ['사업장명', '상호명', '업소명'],
        'addr_road': ['도로명주소', '도로명전체주소'],
        'addr_jibun': ['지번주소', '소재지전체주소'],
        'status_name': ['영업상태명'],
        'detail_status': ['상세영업상태명'],
        'permit_date': ['인허가일자'],
        'close_date': ['폐업일자'],
        'tel': ['전화번호'],
        'manage_num': ['관리번호']
    }

    print("🚀 데이터 적재를 시작합니다...")

    for cat in categories:
        cat_path = os.path.join(base_path, cat)
        if not os.path.exists(cat_path):
            continue
            
        csv_files = [f for f in os.listdir(cat_path) if f.endswith('.csv')]
        
        for file in csv_files:
            file_path = os.path.join(cat_path, file)
            try:
                # 2. 데이터 읽기 (공공데이터 특성상 cp949 인코딩)
                df = pd.read_csv(file_path, encoding='cp949', low_memory=False)
                
                # 3. 필요한 컬럼만 추출 및 이름 변경
                final_cols = {}
                for db_col, csv_candidates in col_map.items():
                    for candidate in csv_candidates:
                        if candidate in df.columns:
                            final_cols[candidate] = db_col
                            break # 찾으면 다음 DB 컬럼으로
                
                # 추출 및 컬럼명 변경
                subset_df = df[list(final_cols.keys())].rename(columns=final_cols)
                
                # 4. 정보 추가 (분류 정보)
                subset_df['main_cat'] = cat
                subset_df['sub_cat'] = file.replace('.csv', '').split('_')[-1] # 파일명에서 소분류 추출
                
                # 5. DB에 적재 (chunksize를 조절하여 메모리 효율화)
                subset_df.to_sql(name='gov_permit_info', con=engine, if_exists='append', index=False, chunksize=10000)
                
                print(f"✅ 적재 완료: {cat}/{file} ({len(subset_df):,}건)")
                
            except Exception as e:
                print(f"❌ 오류 발생 ({file}): {e}")

    print("\n✨ 모든 데이터가 성공적으로 DB에 저장되었습니다!")

# 실행 (경로는 사용자님의 환경에 맞게 수정)
if __name__ == "__main__":
    upload_all_csv_to_db('인허가정보')