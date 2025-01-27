require('dotenv').config();     // env 설정 파일 임포트

// 공통으로 사용되는 변수
const commonConfig = {
};

// 환경별로 다르게 설정해야 하는 변수
const devConfig = {
    keyFile: './service-account-file.json'

};

const prodConfig = {
    keyFile: '/secrets/team-ask-visualizer-google-cloud-access-info-json'
};

// 환경 변수로 프로파일 결정 (default: 'prod')
const profile = process.env.PROFILE  || 'prod';
console.log("Current Profile : " + process.env.PROFILE);

// 환경별 설정 적용
const environmentConfig = profile === 'dev' ? devConfig : prodConfig;

// 공통 변수와 환경별 변수를 합치기
const config = {
    ...commonConfig,
    ...environmentConfig,
};

module.exports = config;