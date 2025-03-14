const express = require('express');
const { google } = require('googleapis');
const cron = require('node-cron');
const fs = require('fs');
const { BigQuery } = require('@google-cloud/bigquery');
const { Storage } = require('@google-cloud/storage');
const config = require('./config.js');

console.error('@@@@@@@@@@@', `${config.keyFile_gmail}`);
// 🔹 Google Cloud Storage 설정 (환경 변수 활용)
const storage = new Storage({
    keyFilename: `${config.keyFile_bigquery}`
});
const bucketName = 'team-ask-storage';
const tokenFilePath = 'proj-newsletter-scraper/gmail-api-token/token.json';

// 🔹 Google BigQuery 설정
const bigquery = new BigQuery({
    keyFilename: `${config.keyFile_bigquery}`
});

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
const CREDENTIALS_PATH = `${config.keyFile_gmail}`; // 환경 변수 활용
const REDIRECT_URI = 'http://localhost:3000/oauth2callback';

const app = express();
const port = 3000;
let oauth2Client;

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

/** 📌 GCS에서 토큰 불러오기 */
async function loadTokenFromStorage() {
    try {
        const file = storage.bucket(bucketName).file(tokenFilePath);
        const [exists] = await file.exists();

        if (!exists) {
            console.log('❌ Token file does not exist in Cloud Storage.');
            return null;
        }

        const [contents] = await file.download();
        return JSON.parse(contents.toString());
    } catch (error) {
        console.error('❌ Error loading token from Cloud Storage:', error);
        return null;
    }
}

/** 📌 GCS에 토큰 저장 */
async function saveTokenToStorage(token) {
    try {
        const file = storage.bucket(bucketName).file(tokenFilePath);
        await file.save(JSON.stringify(token), { contentType: 'application/json' });
        console.log('✅ Token saved to Cloud Storage successfully.');
    } catch (error) {
        console.error('❌ Error saving token to Cloud Storage:', error);
    }
}

/** 📌 OAuth 2.0 인증 처리 */
async function getOAuth2Client() {
    const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
    const { client_id, client_secret } = credentials.web;

    oauth2Client = new google.auth.OAuth2(client_id, client_secret, REDIRECT_URI);

    let token = await loadTokenFromStorage();
    
    if (token) {
        console.log('🔑 Using existing token...');
        oauth2Client.setCredentials(token);

        // 🔹 토큰 자동 갱신 로직 추가
        oauth2Client.on('tokens', async (newTokens) => {
            token = { ...token, ...newTokens };
            await saveTokenToStorage(token);
            console.log('🔄 Token refreshed and saved.');
        });

        try {
            await oauth2Client.getAccessToken();
        } catch (error) {
            console.error('❌ Failed to refresh access token:', error);
        }
    } else {
        console.log("❌ No token found. Please authenticate.");
        const authUrl = oauth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: SCOPES,
        });
        console.log(`🔗 Authenticate here: ${authUrl}`);

        return new Promise((resolve, reject) => {
            app.get('/oauth2callback', async (req, res) => {
                const code = req.query.code;
                if (!code) {
                    res.send('❌ No code received from Google');
                    return reject(new Error('No code received from Google'));
                }

                try {
                    const { tokens } = await oauth2Client.getToken(code);
                    oauth2Client.setCredentials(tokens);
                    await saveTokenToStorage(tokens);
                    console.log('✅ Authentication successful!');
                    res.send('Authentication successful! You can now scrape emails.');
                    resolve();
                } catch (error) {
                    console.error('❌ Authentication error:', error);
                    res.send('Authentication failed');
                    reject(error);
                }
            });
        });
    }
}

/** 📌 이메일 스크래핑 */
async function scrapeEmails() {
    const getFormattedDate = (date) => 
        `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;

    const today = new Date();
    const oneWeekAgo = new Date(today);
    oneWeekAgo.setDate(today.getDate() - 7);

    const query = `label:newsletter after:${getFormattedDate(oneWeekAgo)} before:${getFormattedDate(today)}`;
    console.log(`📩 Fetching emails with query: ${query}`);

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const response = await gmail.users.messages.list({ userId: 'me', q: query, maxResults: 5 });

    const messages = response.data.messages;
    if (!messages || messages.length === 0) {
        console.log('📭 No emails found.');
        return;
    }

    for (const msg of messages) {
        const emailData = await gmail.users.messages.get({ userId: 'me', id: msg.id });
        if (emailData) await saveToBigQuery(emailData);
    }
}

/** 📌 이메일 데이터를 BigQuery에 저장 */
async function saveToBigQuery(emailData) {
    const emailHeaders = emailData.data.payload.headers;
    const id = emailData.data.id;
    const subject = emailHeaders.find(header => header.name === 'Subject')?.value;
    const from = emailHeaders.find(header => header.name === 'From')?.value;
    const date = emailHeaders.find(header => header.name === 'Date')?.value;

    const receivedDate = parseDate(date);

    let emailBody = '';
    let decodedBody = '';
    const parts = emailData.data.payload.parts;
    emailBody = emailData.data.payload.body.data;

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
        await bigquery.dataset('summarizer').table('newsletter_raw').insert(rows);
        console.log('✅ Data inserted into BigQuery.');
    } catch (error) {
        console.error('❌ Error inserting data into BigQuery:', error);
    }
}

/** 📌 스케줄러: 매주 월요일 오전 9시 실행 */
cron.schedule('0 9 * * 1', async () => {
    console.log('⏳ Running scheduled email scraping job...');
    await getOAuth2Client();
    await scrapeEmails();
});

/** 📌 수동 실행 핸들러 */
app.get('/scrape-emails', async (req, res) => {
    console.log('📥 Manual email scraping triggered...');
    await getOAuth2Client();
    await scrapeEmails();
    res.send('✅ Email scraping completed and data inserted into BigQuery.');
});

/** 📌 서버 실행 */
app.listen(port, () => console.log(`🚀 Server running at http://localhost:${port}`));
