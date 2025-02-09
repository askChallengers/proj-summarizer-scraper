require('dotenv').config();     // env 설정 파일 임포트

// 공통으로 사용되는 변수
const commonConfig = {
    port: 3000,
    query: "정치",      // 검색어. UTF-8로 인코딩되어야 합니다.
    display: 10,       // 한 번에 표시할 검색 결과 개수(기본값: 10, 최댓값: 100)
    start: 1,          // 검색 시작 위치(기본값: 1, 최댓값: 1000)
    sort: "sim"        // 검색결과 정렬 sim: 정확도 내림차순, date: 날짜 내림차순
};

// 환경별로 다르게 설정해야 하는 변수
const devConfig = {
    keyFile: './service-account-file.json',
    CLIENT_ID: process.env.CLIENT_ID,
    CLIENT_SECRET: process.env.CLIENT_SECRET
};

const prodConfig = {
    keyFile: '/secrets/team-ask-visualizer-google-cloud-access-info-json'
};

// 환경 변수로 프로파일 결정 (default: 'prod')
const profile = process.env.PROFILE  || 'prod';
console.log("Current Profile : " + profile);

// 환경별 설정 적용
const environmentConfig = profile === 'dev' ? devConfig : prodConfig;

// 공통 변수와 환경별 변수를 합치기
const config = {
    ...commonConfig,
    ...environmentConfig,
};

module.exports = config;