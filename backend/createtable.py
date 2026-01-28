import pymysql

def create_gov_table():
    # 1. DB 연결 설정 (사용자님 정보 반영)
    db_config = {
        'host': 'localhost',
        'user': 'root',
        'password': '12341234',
        'charset': 'utf8mb4'
    }

    try:
        # DB 연결
        conn = pymysql.connect(**db_config)
        cursor = conn.cursor()

        # 2. 데이터베이스 생성 및 선택
        db_name = "capstone_db"
        cursor.execute(f"CREATE DATABASE IF NOT EXISTS {db_name} DEFAULT CHARACTER SET utf8mb4;")
        cursor.execute(f"USE {db_name};")
        print(f"✅ 데이터베이스 '{db_name}' 준비 완료.")

        # 3. 기존 테이블 삭제 (초기화가 필요한 경우만 사용, 아니면 주석 처리)
        # cursor.execute("DROP TABLE IF EXISTS gov_permit_info;")

        # 4. 통합 테이블 생성 쿼리
        # 업로드해주신 리포트를 분석하여 모든 파일에 공통적인 핵심 컬럼 위주로 구성했습니다.
        create_table_query = """
        CREATE TABLE IF NOT EXISTS gov_permit_info (
            id INT AUTO_INCREMENT PRIMARY KEY,
            biz_name VARCHAR(255) COMMENT '사업장명',
            addr_road VARCHAR(500) COMMENT '도로명전체주소',
            addr_jibun VARCHAR(500) COMMENT '소재지전체주소',
            status_name VARCHAR(50) COMMENT '영업상태명',
            detail_status VARCHAR(50) COMMENT '상세영업상태명',
            permit_date VARCHAR(20) COMMENT '인허가일자',
            close_date VARCHAR(20) COMMENT '폐업일자',
            tel VARCHAR(50) COMMENT '전화번호',
            main_cat VARCHAR(50) COMMENT '대분류(폴더명)',
            sub_cat VARCHAR(100) COMMENT '소분류(파일명)',
            manage_num VARCHAR(100) COMMENT '관리번호',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            
            -- 검색 성능 향상을 위한 인덱스 설정
            INDEX idx_biz_name (biz_name),
            INDEX idx_addr_road (addr_road(100)),
            INDEX idx_cats (main_cat, sub_cat)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        """

        cursor.execute(create_table_query)
        print("✅ 'gov_permit_info' 테이블 생성 완료 (인덱스 포함).")

        conn.commit()

    except Exception as e:
        print(f"❌ 에러 발생: {e}")
    finally:
        if conn:
            conn.close()
            print("🔌 DB 연결 종료.")

if __name__ == "__main__":
    create_gov_table()