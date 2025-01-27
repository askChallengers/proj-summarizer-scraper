const puppeteer = require("puppeteer");
const { BigQuery } = require("@google-cloud/bigquery");
const config = require('./config.js');

// BigQuery 클라이언트 초기화
const keyFile = `${config.keyFile}`;
const bigquery = new BigQuery({
    keyFilename: keyFile
});

async function crawlAndStore() {

    // 1. Puppeteer로 브라우저 실행
    const browser = await puppeteer.launch();
    const page = await browser.newPage();

    try {
        // 2. 페이지 오픈
        const url = "https://news.naver.com/factcheck/main";
        await page.goto(url, { waitUntil: "networkidle2" });

        // 3. 필요한 데이터 추출
        const dataToInsert = await page.evaluate(() => {
            const cards = document.querySelectorAll("ul.factcheck_cards._card_list li");
            const result = [];
            cards.forEach((card) => {
                // a 태그의 링크 가져오기
                const link = card.querySelector("a")?.href;
        
                // span.factcheck_card_sub_item 태그의 모든 텍스트 가져오기
                const subItems = Array.from(card.querySelectorAll("span.factcheck_card_sub_item")).map(
                    (span) => span.innerText.trim()
                );
        
                if (link && subItems.length > 0) {
                    result.push({
                    url: link,
                    newsAgency: subItems[0], // 모든 span 데이터를 배열로 저장
                    regDate: null,
                    });
                }
                });
        
                return result;
        });
        console.log("크롤링 데이터:", dataToInsert);

        // // 4. BigQuery 데이터셋 및 테이블 설정 
        const datasetId = "summarizer"; // 수정: 데이터셋 ID
        const tableId = "scraped_url"; // 수정: 테이블 ID

        // // 5. BigQuery에 데이터 적재
        await bigquery.dataset(datasetId).table(tableId).insert(dataToInsert);

        console.log(`${dataToInsert.length}개의 데이터가 BigQuery에 적재되었습니다.`);
    } catch (error) {
        console.error("에러 발생:", error);
    }
}

// 크롤링 및 적재 실행
crawlAndStore();