const { BigQuery } = require("@google-cloud/bigquery");
const config = require('./config.js');
var express = require('express');
var app = express();

const port = `${config.port}`;

// BigQuery 클라이언트 초기화
const datasetId = 'summarizer'; // BigQuery 데이터셋 이름
const tableId = 'news'; // BigQuery 테이블 이름
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

// 날짜 문자열을 Date 객체로 변환
var parseDate = (pubDateStr) => {
    const dateObj = new Date(pubDateStr);
    dateObj.setHours(dateObj.getHours() + 9); // 한국 시간 적용

    // BigQuery DATETIME 형식인 "YYYY-MM-DD HH:MM:SS"로 변환
    const formattedDate = dateObj.toISOString().slice(0, 19).replace('T', ' '); 
    return formattedDate;
};

app.get('/search/news', function (req, res) {
//    var api_url = 'https://openapi.naver.com/v1/search/news.json?query=' + encodeURI(req.query.query); // JSON 결과
    var api_url = 'https://openapi.naver.com/v1/search/news.json?query=' + encodeURI(query) + '&display=' + display + '&start=' + start + '&sort=' + encodeURI(sort); // JSON 결과
    console.log(api_url);
    var request = require('request');
    var options = {
        url: api_url,
        headers: {'X-Naver-Client-Id':client_id, 'X-Naver-Client-Secret': client_secret}
    };
    request.get(options, async function (error, response, body) {
        console.log('response = ' + response);
        if (!error && response.statusCode == 200) {
            console.log('SUCCESS!!');
            // console.log(body);

            const jsonData = JSON.parse(body); // 문자열을 JSON 객체로 변환
            const items = jsonData.items;
            console.log('items : ' + items[0].title);

            // BigQuery에 삽입할 데이터 변환
            const rows = items.map((item, index) => ({
                title: item.title.replace(/<[^>]*>/g, ''), // HTML 태그 제거
                originalLink: item.originallink,
                naverLink: item.link,
                description: item.description.replace(/<[^>]*>/g, ''), // HTML 태그 제거
                pubDate: parseDate(item.pubDate), // 날짜 변환
                order: index + 1,
                keyword: query
            }));

            // BigQuery에 데이터 삽입
            await insertIntoBigQuery(rows);

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

 // BigQuery에 데이터 삽입하는 함수
async function insertIntoBigQuery(rows) {
    try {
        await bigquery.dataset(datasetId).table(tableId).insert(rows);
        console.log(`BigQuery에 ${rows.length}개의 뉴스 데이터 삽입 완료`);
    } catch (err) {
        console.error('BigQuery 데이터 삽입 오류:', err);
    }
}