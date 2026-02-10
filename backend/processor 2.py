# processor.py
import sys
import os
import requests
import pyhwpx

def main():
    if len(sys.argv) < 3:
        print("USAGE: python processor.py [URL] [FILENAME]")
        sys.exit(1)

    url = sys.argv[1]
    file_name = sys.argv[2]
    
    # 1. 경로 설정 (현재 작업 디렉토리의 temp 폴더)
    base_path = os.path.join(os.getcwd(), "temp")
    if not os.path.exists(base_path):
        os.makedirs(base_path)

    hwp_path = os.path.join(base_path, f"{file_name}.hwp")
    hwpx_path = os.path.join(base_path, f"{file_name}.hwpx")

    try:
        # 2. 파일 다운로드
        print(f"Downloading from {url}...")
        response = requests.get(url, timeout=30)
        response.raise_for_status() # 에러 발생 시 예외 발생
        
        with open(hwp_path, "wb") as f:
            f.write(response.content)
        print(f"Saved: {hwp_path}")

        # 3. HWP -> HWPX 변환 (pyhwpx 사용)
        # ※ 주의: Windows 환경에 한컴오피스가 설치되어 있어야 합니다.
        hwp = pyhwpx.Hwp()
        hwp.open(hwp_path)
        hwp.save_as(hwpx_path, "HWPX")
        hwp.quit()
        
        # 4. 원본 HWP는 삭제 (선택 사항)
        #os.remove(hwp_path)
        
        # 5. 최종 변환된 파일 경로를 표준 출력으로 보냄 (Node.js가 읽을 수 있도록)
        print(f"CONVERT_SUCCESS:{hwpx_path}")

    except Exception as e:
        print(f"ERROR:{str(e)}")
        sys.exit(1)

if __name__ == "__main__":
    main()