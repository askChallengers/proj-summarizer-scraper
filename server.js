const { BigQuery } = require("@google-cloud/bigquery");
const config = require('./config.js');
var express = require('express');
var app = express();

const port = `${config.port}`;

// BigQuery 클라이언트 초기화
const keyFile = `${config.keyFile}`;
const bigquery = new BigQuery({
    keyFilename: keyFile
});


// 네이버 검색 API 예제 - 뉴스 검색
const client_id = `${config.CLIENT_ID}`;
const client_secret = `${config.CLIENT_SECRET}`;

const query = `${config.query}`;    // 검색어.
const display= `${config.display}`; // 결과 개수
const start = `${config.start}`;    // 검색 시작 위치
const sort = `${config.sort}`;      // 검색결과 정렬

// 빅쿼리 데이터 적재용
const result = [];

app.get('/search/news', function (req, res) {
//    var api_url = 'https://openapi.naver.com/v1/search/news.json?query=' + encodeURI(req.query.query); // JSON 결과
    var api_url = 'https://openapi.naver.com/v1/search/news.json?query=' + encodeURI(query) + '&display=' + display + '&start=' + start + '&sort=' + encodeURI(sort); // JSON 결과
    console.log(api_url);
    var request = require('request');
    var options = {
        url: api_url,
        headers: {'X-Naver-Client-Id':client_id, 'X-Naver-Client-Secret': client_secret}
    };
    request.get(options, function (error, response, body) {
        console.log('response = ' + response);
        if (!error && response.statusCode == 200) {
            console.log('SUCCESS!!');
            // console.log(body);

            const jsonData = JSON.parse(body); // 문자열을 JSON 객체로 변환
            const items = jsonData.items;
            console.log('items : ' + items[0].title);

            res.writeHead(200, {'Content-Type': 'text/json;charset=utf-8'});
            res.end(body);
        } else {
            res.status(response.statusCode).end();
            console.log('error = ' + response.statusCode);
        }
    });
 });

 app.get('/search/blog', function (req, res) {
    var api_url = 'https://openapi.naver.com/v1/search/blog?query=' + encodeURI(query); // JSON 결과
    var request = require('request');
    var options = {
        url: api_url,
        headers: {'X-Naver-Client-Id':client_id, 'X-Naver-Client-Secret': client_secret}
     };
    request.get(options, function (error, response, body) {
      if (!error && response.statusCode == 200) {
        res.writeHead(200, {'Content-Type': 'text/json;charset=utf-8'});
        res.end(body);
      } else {
        res.status(response.statusCode).end();
        console.log('error = ' + response.statusCode);
      }
    });
  });

 app.listen(port, function () {
    console.log(`app listening on port ${port}!`);
 });

// async function crawlAndStore() {

//     // 1. Puppeteer로 브라우저 실행
//     const browser = await puppeteer.launch();
//     const page = await browser.newPage();

//     try {
//         // 2. 페이지 오픈
//         const url = "https://news.naver.com/factcheck/main";
//         await page.goto(url, { waitUntil: "networkidle2" });

//         // 3. 현재 날짜를 계산하여 page.evaluate에 전달
//         const currentRegDate = (() => {
//             const now = new Date();
//             const yyyy = now.getFullYear();
//             const mm = String(now.getMonth() + 1).padStart(2, "0"); // 월은 0부터 시작하므로 +1
//             const dd = String(now.getDate()).padStart(2, "0");
//             const hh = String(now.getHours()).padStart(2, "0");
//             const min = String(now.getMinutes()).padStart(2, "0");
//             const ss = String(now.getSeconds()).padStart(2, "0");
//             return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
//         })();

//         // 4. 필요한 데이터 추출
//         const dataToInsert = await page.evaluate(
//             (regDate) => {
//                 const cards = document.querySelectorAll("ul.factcheck_cards._card_list li");
//                 const result = [];
//                 cards.forEach((card) => {
//                     // a 태그의 링크 가져오기
//                     const link = card.querySelector("a")?.href;

//                     // span.factcheck_card_sub_item 태그의 모든 텍스트 가져오기
//                     const subItems = Array.from(card.querySelectorAll("span.factcheck_card_sub_item")).map(
//                         (span) => span.innerText.trim()
//                     );

//                     if (link && subItems.length > 0) {
//                         result.push({
//                             url: link,
//                             newsAgency: subItems[0],
//                             regDate: regDate,
//                         });
//                     }
//                 });
//                 return result;
//             },
//             currentRegDate // Node.js 컨텍스트에서 계산된 regDate 전달
//         );
//         console.log("크롤링 데이터:", dataToInsert);

//         // // 5. BigQuery 데이터셋 및 테이블 설정 
//         const datasetId = "summarizer";
//         const tableId = "scraped_url";

//         // // 6. BigQuery에 데이터 적재
//         await bigquery.dataset(datasetId).table(tableId).insert(dataToInsert);

//         console.log(`${dataToInsert.length}개의 데이터가 BigQuery에 적재되었습니다.`);
//     } catch (error) {
//         console.error("에러 발생:", error);
//     }
// }

// 크롤링 및 적재 실행
// crawlAndStore();