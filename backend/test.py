import asyncio
from playwright.async_api import async_playwright

async def get_attachment_links(url):
    async with async_playwright() as p:
        # 1. 브라우저 실행 (headless=False로 하면 실제 돌아가는 화면을 볼 수 있음)
        browser = await p.chromium.launch(headless=False)
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36"
        )
        page = await context.new_page()

        # 2. 공고 상세 페이지 접속
        print(f"접속 중: {url}")
        await page.goto(url, wait_until="networkidle")

        # 3. 첨부파일 영역 찾기 (사이트마다 선택자는 수정 필요)
        # 예: .file-list, a[href*='download'], .attachment-item 등
        # 여기서는 흔히 쓰이는 '첨부파일' 텍스트를 포함한 링크를 찾아봅니다.
        file_links = await page.query_selector_all("a[href*='download'], a[href*='file'], .file_area a")
        
        print(f"찾은 파일 링크 수: {len(file_links)}개")

        results = []
        for link in file_links:
            text = await link.inner_text()
            href = await link.get_attribute("href")
            
            # 4. 자바스크립트 다운로드 버튼 대응 (클릭 시 다운로드 이벤트 캡처)
            if href == "#" or "javascript" in href:
                try:
                    # 클릭과 동시에 다운로드 시작을 기다림
                    async with page.expect_download() as download_info:
                        await link.click()
                    download = await download_info.value
                    
                    # 실제 다운로드 URL과 파일명 확보
                    results.append({
                        "name": download.suggested_filename,
                        "url": download.url,
                        "type": "dynamic_js"
                    })
                except Exception as e:
                    print(f"다운로드 캡처 실패: {e}")
            else:
                # 일반적인 URL 형태인 경우
                results.append({
                    "name": text.strip(),
                    "url": page.url + href if href.startswith('/') else href,
                    "type": "static_link"
                })

        await browser.close()
        return results

# 실행부
async def main():
    target_url = "https://www.bizinfo.go.kr/web/lay1/bbs/S1T122C128/AS/74/view.do?pblancId=PBLN_000000000117673"# 실제 공고문 주소로 변경
    files = await get_attachment_links(target_url)
    
    print("\n--- 추출된 첨부파일 목록 ---")
    for f in files:
        print(f"파일명: {f['name']}")
        print(f"링크: {f['url']}")
        print("-" * 30)

if __name__ == "__main__":
    asyncio.run(main())