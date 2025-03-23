const { getOAuth2Client } = require('./auth.js');

async function refreshAccessToken() {
    console.log('🔄 Attempting to refresh Access Token...');

    try {
        const oauth2Client = await getOAuth2Client();
        const newToken = await oauth2Client.getAccessToken();
        console.log('✅ Access Token refreshed successfully.');
    } catch (error) {
        console.error('❌ Failed to refresh Access Token:', error);
    }
}

// 📌 실행 시 바로 Refresh Token 갱신
refreshAccessToken();
