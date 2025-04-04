const express = require('express');
const fs = require('fs');
const { google } = require('googleapis');
const { Storage } = require('@google-cloud/storage');
const config = require('./config.js');

const app = express();
const port = 3000;

const storage = new Storage({
    keyFilename: `${config.keyFile_bigquery}`
});

const bucketName = 'team-ask-storage';
const tokenFilePath = 'proj-newsletter-scraper/gmail-api-token/token.json';

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
const CREDENTIALS_PATH = `${config.keyFile_gmail}`; // 환경 변수 활용
const REDIRECT_URI = 'http://localhost:3000/oauth2callback';

let oauth2Client;

// 📌 GCS에서 토큰 불러오기
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

// 📌 GCS에 토큰 저장
async function saveTokenToStorage(token) {
    try {
        const file = storage.bucket(bucketName).file(tokenFilePath);
        await file.save(JSON.stringify(token), { contentType: 'application/json' });
        console.log('✅ Token saved to Cloud Storage successfully.');
    } catch (error) {
        console.error('❌ Error saving token to Cloud Storage:', error);
    }
}

// 📌 OAuth 2.0 클라이언트 생성
async function getOAuth2Client() {
    const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
    const { client_id, client_secret } = credentials.web;

    oauth2Client = new google.auth.OAuth2(client_id, client_secret, REDIRECT_URI);
    let token = await loadTokenFromStorage();

    if (token) {
        console.log('🔑 Using existing token...');
        oauth2Client.setCredentials(token);

        // 🔹 Refresh Token 자동 갱신
        oauth2Client.on('tokens', async (newTokens) => {
            if (newTokens.refresh_token) {
                token.refresh_token = newTokens.refresh_token; // 새 Refresh Token이 있으면 업데이트
            }
            token.access_token = newTokens.access_token; // Access Token 갱신
            await saveTokenToStorage(token); // GCS에 업데이트
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
            prompt: 'consent', // Refresh Token을 항상 요청
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

            app.listen(port, () => {
                console.log(`OAuth 서버가 http://localhost:${port} 에서 대기 중`);
              });
        });
    }

    return oauth2Client;
}

module.exports = { getOAuth2Client, loadTokenFromStorage, saveTokenToStorage };
