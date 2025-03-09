const config = require('./config.js');
const express = require('express');
const { google } = require('googleapis');
const fs = require('fs');
const cron = require('node-cron');
const { BigQuery } = require('@google-cloud/bigquery');

// OAuth 2.0 설정
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
const CREDENTIALS_PATH = './client_secret_to_get_gmail.json';
const TOKEN_PATH = './token.json';  // 저장된 토큰 경로
const REDIRECT_URI = 'http://localhost:3000/oauth2callback';

const app = express();
const port = 3000;

let oauth2Client;

// BigQuery 클라이언트 초기화
const datasetId = 'summarizer'; // BigQuery 데이터셋 이름
const rawTableId = 'newsletter_raw'; // BigQuery 테이블 이름
const keyFile = `${config.keyFile}`;
const bigquery = new BigQuery({
    keyFilename: keyFile
});

const parseDate = (pubDateStr) => {
    const dateObj = new Date(pubDateStr); // Date 객체 생성 (자동 UTC 변환)
    
    // 한국 시간대로 변환
    const year = dateObj.getUTCFullYear();
    const month = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getUTCDate()).padStart(2, '0');
    const hours = String(dateObj.getUTCHours() + 9).padStart(2, '0'); // KST 변환
    const minutes = String(dateObj.getUTCMinutes()).padStart(2, '0');
    const seconds = String(dateObj.getUTCSeconds()).padStart(2, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};

// 1. 인증을 위한 토큰 불러오기 또는 새로 생성
async function getOAuth2Client() {
    const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
    const { client_id, client_secret } = credentials.web;
  
    oauth2Client = new google.auth.OAuth2(client_id, client_secret, REDIRECT_URI);
  
    // 저장된 토큰이 있다면 불러오기
    const token = await checkToken();
  
    if (token) {
      console.log('Token found. Setting credentials...');
      oauth2Client.setCredentials(token);
    } else {
      console.log("No token found. Please authenticate.");
      // 인증 URL을 생성하여 출력하고 인증을 받도록 유도
      const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
      });
      console.log(`Please visit this URL to authenticate: ${authUrl}`);
      
      // 인증이 완료될 때까지 기다립니다.
      return new Promise((resolve, reject) => {
        app.get('/oauth2callback', async (req, res) => {
          const code = req.query.code;

          if (code) {
            try {
              // 받은 인증 코드로 토큰을 교환
              const { tokens } = await oauth2Client.getToken(code);
              oauth2Client.setCredentials(tokens);

              // 토큰을 파일에 저장
              fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));

              console.log('Authentication successful');
              res.send('Authentication successful! You can now scrape emails.');

              // 인증이 완료되면 resolve 호출
              resolve();
            } catch (error) {
              console.error('Error during authentication:', error);
              res.send('Authentication failed');
              reject(error);
            }
          } else {
            res.send('No code received from Google');
            reject(new Error('No code received from Google'));
          }
        });
      });
    }
}

// 2. 토큰 파일에서 토큰 확인
async function checkToken() {
  try {
    const token = fs.readFileSync(TOKEN_PATH);
    return JSON.parse(token);
  } catch (error) {
    return null;  // 토큰 파일이 없다면 null 반환
  }
}

// 3. 이메일 스크래핑 및 BigQuery 적재
async function scrapeEmails() {
    const getFormattedDate = (date) => {
        return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
    };
    
    const today = new Date();
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(today.getDate() - 7); // 일주일 전 날짜 계산
    
    const query = `label:newsletter after:${getFormattedDate(oneWeekAgo)} before:${getFormattedDate(today)}`;
    console.log("이메일 스크랩 라벨 및 기간 설정 :: " + query);

    //   const query = `label:newsletter after:2025/02/23 before:2025/03/01`;
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Gmail API 호출 예시 (예: 최신 5개의 이메일 목록 가져오기)
    const response = await gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: 5,
  });

  const messages = response.data.messages;

  if (messages && messages.length) {
    for (let msg of messages) {
        const emailData = await gmail.users.messages.get({ userId: 'me', id: msg.id });
  
        if (emailData) {
          // BigQuery에 이메일 데이터를 삽입
          await saveToBigQuery(emailData);
        } else {
          console.log('No body found for email.');
        }
    }
  } else {
    console.log('No emails found.');
  }
}

// 4. BigQuery에 이메일 데이터를 삽입하는 함수
async function saveToBigQuery(emailData) {
    const emailHeaders = emailData.data.payload.headers;
    const id = emailData.data.id;
    const subject = emailHeaders.find(header => header.name === 'Subject')?.value;
    const from = emailHeaders.find(header => header.name === 'From')?.value;
    const date = emailHeaders.find(header => header.name === 'Date')?.value;
    console.log("date BEFORE :: " + date);
    const receivedDate = parseDate(date);
    console.log("date AFTER :: " + receivedDate);

    // 본문 내용 가져오기
    let emailBody = '';
    let decodedBody = '';
    const parts = emailData.data.payload.parts;

    if (parts) {
        // 이메일 본문 파트가 여러 개 있을 수 있으므로, 각 파트를 순차적으로 확인
        for (const part of parts) {
        if (part.mimeType === 'text/plain' || part.mimeType === 'text/html') {
            const body = part.body.data;
            if (body) {
            emailBody = body;
            break; // 본문을 찾으면 반복을 종료
            }
        }
        }
    } else {
        // parts가 없는 경우에는 body.data에서 본문을 찾을 수 있음
        emailBody = emailData.data.payload.body.data;
    }

    if (emailBody) {
        // Base64로 인코딩된 본문 디코딩
        decodedBody = Buffer.from(emailBody, 'base64').toString('utf8');
    } else {
        console.log('No body found for email.');
    }
  
    const rows = [{
        id: id,
        subject: subject,
        sender: from,
        received_date: receivedDate,
        email_content: decodedBody  // HTML 내용 저장
    }];

    try {
        // BigQuery에 데이터 삽입
        await bigquery.dataset(datasetId).table(rawTableId).insert(rows);
        console.log('Data inserted into BigQuery');
    } catch (error) {
        console.error('Error inserting data into BigQuery:', error);
    }
}

// 5. 주기적으로 이메일을 수집하는 스케줄러 설정 (예: 매주 월요일 오전 9시)
cron.schedule('0 9 * * 1', async () => {
  console.log('Running scheduled email scraping job...');
  await getOAuth2Client();  // 인증
  await scrapeEmails();  // 이메일 스크래핑 및 BigQuery에 저장
});

// 5. 이메일 수집을 위한 GET 요청 핸들러
app.get('/scrape-emails', async (req, res) => {
    console.log('Starting email scraping...');
    
    await getOAuth2Client();  // 인증
    await scrapeEmails();  // 이메일 스크래핑 및 BigQuery에 저장
  
    res.send('Email scraping completed and data inserted into BigQuery');
});

// 6. 서버 시작
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});