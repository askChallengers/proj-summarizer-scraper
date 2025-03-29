const fs = require("fs");
const { BigQuery } = require("@google-cloud/bigquery");
const puppeteer = require('puppeteer');
const config = require("./config.js");
const OpenAI = require("openai");
const path = require("path");

// BigQuery 설정
const datasetId = "summarizer";
const rawTableId = "newsletter_raw";
const summaryTableId = "newsletter_summary";
const keyFile = config.keyFile_bigquery;
const bigquery = new BigQuery({
  keyFilename: keyFile,
});

// OpenAI API 설정
const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
});

// 📌 Assistant ID 저장 (한 번만 생성되도록)
let assistantId = config.ASSISTANT_ID || null;

// BigQuery에서 금주 뉴스레터 데이터 가져오기
async function getNewsletterDataFromBigQuery() {
  const query = `
    DECLARE end_date DATE DEFAULT CURRENT_DATE('Asia/Seoul') - 1;
    DECLARE start_date DATE DEFAULT end_date - 6;

    SELECT 
        id
        , email_content
    FROM 
        \`${datasetId}.${rawTableId}\`
    WHERE 1 = 1
        AND received_date BETWEEN start_date AND end_date;
  `;

  console.log("query :", query);
  try {
    const [rows] = await bigquery.query(query);
    console.log("✅ Fetched emails:", rows.length);
    return rows;
  } catch (error) {
    console.error("❌ Error fetching data from BigQuery:", error);
    return [];
  }
}

async function saveEmailAsPDF(emailContent, filePath) {
    
    
    const browser = await puppeteer.launch();
    const page = await browser.newPage();

    // 이메일 HTML 내용 로드
    await page.setContent(emailContent, { waitUntil: 'domcontentloaded' });

    // PDF 저장
    await page.pdf({ path: filePath, format: 'A4' });

    await browser.close();
    console.log(`PDF saved: ${filePath}`);
}

// 📌 1️⃣ OpenAI Assistants에 파일 업로드
async function uploadFile(filePath) {
  try {
    const response = await openai.files.create({
      file: fs.createReadStream(filePath),
      purpose: "assistants",
    });
    console.log("✅ 파일 업로드 완료! file_id:", response.id);
    return response.id;
  } catch (error) {
    console.error("❌ 파일 업로드 실패:", error);
    return null;
  }
}

// 📌 2️⃣ 새로운 스레드 생성
async function createThread() {
  try {
    const thread = await openai.beta.threads.create();
    console.log("✅ 스레드 생성 완료! thread_id:", thread.id);
    return thread.id;
  } catch (error) {
    console.error("❌ 스레드 생성 실패:", error);
    return null;
  }
}

// 📌 3️⃣ Assistant 생성 (한 번만 실행)
async function createAssistant() {
  if (assistantId) {
    console.log("✅ 기존 Assistant 사용:", assistantId);
    return assistantId;
  }

  try {
    const assistant = await openai.beta.assistants.create({
        name: "Newsletter Summarizer",
        instructions: `
            당신은 PDF 파일에서 주간 이슈를 정리하는 역할을 합니다.  
            파일의 원문은 **한글**로 작성되어 있으며, 변환된 내용도 반드시 **한글로 유지**해야 합니다.  

            🔹 처리 방법:
            1. 먼저, PDF 파일의 내용을 OCR 처리하여 **한글 원문 그대로** 텍스트로 변환하세요.  
            2. 텍스트로 변환된 전체 내용을 분석하여 제목과 내용으로 정리합니다.  
            (📌 **요약하거나 번역하지 말고, 원문을 그대로 정리하세요!**)  
            3. 기본적으로 전체 내용에 대한 정리를 진행하고, 특수한 케이스에도 정리된 내용의 응답은 최소 5가지 이상으로 합니다.  
            4. 정리된 내용의 응답은 **반드시 JSON 형식**으로 반환해야 합니다.  
            5. **추가 설명, 마크다운(\`\`\`json\`\`\` 등)을 포함하지 마세요.**  
            6. 🔥 **반드시 모든 응답은 한글로 반환하세요.**  
            (📌 **영어로 번역하지 마세요! 원문이 한글이면 응답도 반드시 한글이어야 합니다.**)  

            🔹 JSON 응답 예시:
            {
            "issues": [
                { "title": "이슈 제목1", "content": "이슈 내용1" },
                { "title": "이슈 제목2", "content": "이슈 내용2" }
            ]
            } 
        `,
        model: "gpt-4-turbo",
        tools: [{ type: "file_search" }],
    });

    assistantId = assistant.id;
    console.log("✅ Assistant 생성 완료! assistant_id:", assistant.id);
    return assistant.id;
  } catch (error) {
    console.error("❌ Assistant 생성 실패:", error);
    return null;
  }
}

// 📌 4️⃣ 파일을 첨부한 메시지 추가
async function addMessageToThread(threadId, fileId) {
  try {
    await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: "Please summarize all issues in the newsletter. Extract all titles and contents.",
      attachments: [
        {
          file_id: fileId,
          tools: [{ type: "file_search" }],
        },
      ],
    });
    console.log("✅ 메시지 추가 완료!");
  } catch (error) {
    console.error("❌ 메시지 추가 실패:", error);
  }
}

// 📌 5️⃣ Assistant 실행 후 결과 가져오기
async function runAssistant(threadId, assistantId) {
    try {
        const run = await openai.beta.threads.runs.create(threadId, {
            assistant_id: assistantId,
        });

        let runStatus = run.status;
        while (runStatus === "queued" || runStatus === "in_progress") {
            await new Promise((resolve) => setTimeout(resolve, 15000));
            const updatedRun = await openai.beta.threads.runs.retrieve(threadId, run.id);
            runStatus = updatedRun.status;
            console.log("⏳ Assistant 상태 업데이트:", runStatus);
        }

        // ❗ 오류 발생 시 상세 원인 출력
        if (runStatus !== "completed") {
            const failedRun = await openai.beta.threads.runs.retrieve(threadId, run.id);
            console.error("❌ Assistant 실행 실패! 상태:", runStatus);
            console.error("🛑 오류 상세 정보:", failedRun.last_error);
            return null;
        }

        const messages = await openai.beta.threads.messages.list(threadId);
        console.log("✅ Assistant 응답 메시지:", messages.data);
        return messages.data;
    } catch (error) {
        console.error("❌ Assistant 실행 오류:", error);
        return null;
    }
}

  


// 📌 6️⃣ GPT에 HTML 파일을 전달하여 요약받기
async function getSummarizedJson(filePath) {
    const fileId = await uploadFile(filePath);
    if (!fileId) return;

    const threadId = await createThread();
    if (!threadId) return;

    await addMessageToThread(threadId, fileId);

    // const assistantId = await createAssistant();
    const assistantId = 'asst_b1WSFL02LMf41BzQXVKR0gR2';
    if (!assistantId) return;

    const response = await runAssistant(threadId, assistantId);
    
    // 🔹 response가 null이거나 올바르지 않은 경우 처리
    if (!response || !Array.isArray(response)) {
        console.error("❌ Invalid response structure:", response);
        return null;
    }

    // 🔹 'assistant' 역할의 응답 찾기
    const assistantResponse = response.find((msg) => msg.role === "assistant");

    if (!assistantResponse || !assistantResponse.content?.length) {
        console.error("⚠️ No assistant response found! Response:", JSON.stringify(response, null, 2));
        return null;
    }

    try {
        let rawText = assistantResponse.content[0].text?.value || "";
        
        console.log("🔹 Raw Assistant Response:", rawText);

        // 🔹 불필요한 마크다운 및 출처 제거
        rawText = rawText.replace(/```json|```/g, "").trim();
        rawText = rawText.replace(/【\d+:\d+†source】/g, "");

        console.log("🔹 Cleaned JSON String:", rawText);

        const jsonData = JSON.parse(rawText);
        console.log("✅ Parsed JSON Data:", jsonData);
        return jsonData;
    } catch (error) {
        console.error("❌ JSON 변환 실패:", error);
        console.error("❌ 원본 데이터:", assistantResponse);
        return null;
    }
}

// 📌 7️⃣ JSON 데이터를 BigQuery에 저장
async function saveJsonToBigQuery(newletterRawId, jsonData) {
  const rows = jsonData.issues.map((item) => ({
    raw_id: newletterRawId,
    title: item.title,
    content: item.content,
  }));

  try {
    await bigquery.dataset(datasetId).table(summaryTableId).insert(rows);
    console.log("✅ Summary inserted into BigQuery");
  } catch (error) {
    console.error("❌ BigQuery 저장 실패:", error);
  }
}

// 📌 8️⃣ HTML 파일을 저장하고 처리한 후 삭제
async function processNewsletters() {
  const newsletters = await getNewsletterDataFromBigQuery();

  for (const newsletter of newsletters) {
    const newletterRawId = newsletter.id;
    const emailContent = newsletter.email_content;
    const filePath = path.join(__dirname, `temp-email-${Date.now()}.pdf`);
    // const filePath = path.join(__dirname, `temp-email-${Date.now()}.html`);
    // fs.writeFileSync(filePath, emailContent);

    await saveEmailAsPDF(emailContent, filePath)

    const summarizedJson = await getSummarizedJson(filePath);

    if (summarizedJson) {
      await saveJsonToBigQuery(newletterRawId, summarizedJson);
    }

    fs.unlinkSync(filePath);
    console.log("✅ 임시 파일 삭제 완료");
  }
}

// 실행
processNewsletters();
