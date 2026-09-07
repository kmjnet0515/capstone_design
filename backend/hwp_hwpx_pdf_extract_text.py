import zipfile
import xml.etree.ElementTree as ET

def extract_hwpx_text(file_path):
    texts = []
    try:
        with zipfile.ZipFile(file_path, 'r') as z:
            # hwpx의 실제 텍스트는 Contents 폴더 내 section 파일들에 들어있음
            section_files = [f for f in z.namelist() if f.startswith('Contents/section')]
            for section in section_files:
                with z.open(section) as f:
                    tree = ET.parse(f)
                    root = tree.getroot()
                    # <hp:t> 태그 안에 실제 글자가 들어있음
                    for t in root.iter('{http://www.hancom.co.kr/hwpml/2011/paragraph}t'):
                        if t.text:
                            texts.append(t.text)
        return "\n".join(texts)
    except Exception as e:
        return f"HWPX 변환 에러: {e}"

import fitz  # PyMuPDF
def extract_pdf_text(file_path):
    try:
        doc = fitz.open(file_path)
        text = ""
        for page in doc:
            text += page.get_text()
        return text
    except Exception as e:
        return f"PDF 변환 에러: {e}"
    
import sys
import os

def main():
    if len(sys.argv) < 2:
        return
    
    file_path = sys.argv[1]
    ext = os.path.splitext(file_path)[1].lower()

    if ext == '.hwp':
        # 아까 성공한 hwp5txt 로직 호출
        # (라이브러리 임포트가 꼬이면 os.system으로 hwp5txt 실행)
        os.system(f"hwp5txt \"{file_path}\"")
    
    elif ext == '.hwpx':
        print(extract_hwpx_text(file_path))
        
    elif ext == '.pdf':
        print(extract_pdf_text(file_path))

if __name__ == "__main__":
    main()