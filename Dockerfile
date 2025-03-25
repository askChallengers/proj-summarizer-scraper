# Dockerfile

# Node.js 이미지를 기반으로 설정
FROM node:16

# 한글 폰트 설치
RUN apt-get update && apt-get install -y \
    fonts-nanum \
    --no-install-recommends && \
    fc-cache -fv && \
    rm -rf /var/lib/apt/lists/*

# Install necessary packages for Puppeteer
RUN apt-get update && apt-get install -y \
    ca-certificates \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libgdk-pixbuf2.0-0 \
    libnspr4 \
    libnss3 \
    libxcomposite1 \
    libxrandr2 \
    xdg-utils \
    libdrm2 \
    libgbm1 \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# 작업 디렉토리를 설정 (프로젝트 루트)
WORKDIR /app

# package.json과 package-lock.json을 복사
COPY package*.json ./

# 프로덕션 환경에서 필요한 모듈만 설치
RUN npm install

# 나머지 애플리케이션 파일 복사
COPY . .

RUN ls -R
# Make the start script executable
RUN chmod +x start.sh