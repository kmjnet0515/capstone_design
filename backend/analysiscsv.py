import os
import pandas as pd

def save_columns_report(base_path, output_file="column_report_by_file.txt"):
    categories = ['건강', '기타', '동물', '문화', '생활', '식품']
    
    with open(output_file, "w", encoding="utf-8") as f:
        f.write("=" * 80 + "\n")
        f.write("📂 인허가 정보 파일별 컬럼 전수 조사 리포트\n")
        f.write("=" * 80 + "\n\n")

        for cat in categories:
            cat_path = os.path.join(base_path, cat)
            if not os.path.exists(cat_path):
                continue
            
            f.write(f"\n[분류: {cat}]\n")
            f.write("-" * 40 + "\n")
            
            csv_files = [file for file in os.listdir(cat_path) if file.endswith('.csv')]
            
            for csv_file in csv_files:
                file_path = os.path.join(cat_path, csv_file)
                try:
                    # 헤더만 읽기
                    df = pd.read_csv(file_path, encoding='cp949', nrows=0)
                    cols = df.columns.tolist()
                    
                    # 파일에 쓰기
                    f.write(f"📄 파일명: {csv_file}\n")
                    f.write(f"📊 컬럼수: {len(cols)}개\n")
                    f.write(f"🔹 컬럼목록: {', '.join(cols)}\n")
                    f.write("." * 80 + "\n")
                    
                except Exception as e:
                    f.write(f"❌ {csv_file} 읽기 실패: {e}\n")
                    f.write("." * 80 + "\n")

    print(f"✅ 분석 완료! '{output_file}' 파일을 확인해 주세요.")

# 실행
save_columns_report('인허가정보')