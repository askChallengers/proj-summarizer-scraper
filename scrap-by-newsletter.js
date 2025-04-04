const express = require('express');
const fs = require('fs');
const config = require('./config.js');
const cheerio = require('cheerio');

const { google } = require('googleapis');
const { BigQuery } = require('@google-cloud/bigquery');
const { Storage } = require('@google-cloud/storage');
const { getOAuth2Client } = require('./auth.js');

// 🔹 Google Cloud Storage 설정 (환경 변수 활용)
const storage = new Storage({
    keyFilename: `${config.keyFile_bigquery}`
});

// 🔹 Google BigQuery 설정
const bigquery = new BigQuery({
    keyFilename: `${config.keyFile_bigquery}`
});

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

function extractPlainTextFromHtml(htmlContent) {
    const $ = cheerio.load(htmlContent);
    return $('body').text();  // <body> 태그 내의 텍스트만 추출
}

/** 📌 이메일 스크래핑 */
async function scrapEmails() {
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
    let plainText = '';
    emailBody = emailData.data.payload.body.data;

    if (emailBody) {
        // Base64로 인코딩된 본문 디코딩
        const decodedBody = Buffer.from(emailBody, 'base64').toString('utf8');
        plainText = extractPlainTextFromHtml(decodedBody);
        console.log('Remove HTML source ->> ', plainText);
    } else {
        console.log('No body found for email.');
    }

    const rows = [{
        id: id,
        subject: subject,
        sender: from,
        received_date: receivedDate,
        email_content: plainText  // HTML 제거된 내용 저장
    }];
    
    try {
        await bigquery.dataset('summarizer').table('newsletter_raw').insert(rows);
        console.log('✅ Data inserted into BigQuery.');
    } catch (error) {
        console.error('❌ Error inserting data into BigQuery:', error);
    }
}

async function scrapByNewsletter() {
    console.log('📥 Manual email scraping triggered...');
    // await getOAuth2Client();
    oauth2Client = await getOAuth2Client();
    await scrapEmails();
}

scrapByNewsletter();
