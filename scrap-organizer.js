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
        AND received_date BETWEEN start_date AND end_date
        AND is_delete = 'N'
        ;
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
            당신은 이메일 뉴스레터의 본문에서 핵심 주제를 추출하고, 각 주제에 대한 원문 내용을 구조화하는 역할을 합니다.

            처리 방식:
            1. 내가 전달하는 텍스트는 이메일 본문의 HTML 태그가 제거된 원문입니다.
            2. 전체 텍스트에서 임의로 의역하거나 요약하지 말고, **있는 그대로의 문장들을 기반**으로 주요 주제를 구분하세요.
            3. 각 주제에 대해 관련 문장들을 묶어서 정리하세요.
            4. 뉴스레터이다보니 뉴스레터를 제작한 플랫폼의 홍보나 개인적인 의견이 처음, 마지막 부분에 들어있을 수 있습니다. 해당 부분은 당신이 진행하는 역할에서 제외시키세요.
            5. 본문에서 추출하는 것에 개수 제한은 없습니다. 있는 그대로의 본문에서 파악되는 각 주제에 맞게 정리하세요.
            5. 오직 JSON 형식으로만 응답하세요. 추가 텍스트나 설명, 마크다운 없이 JSON 그 자체만 반환하세요.

            주의사항:
            - 절대로 요약하지 마세요.
            - 절대로 번역하지 마세요.
            - 절대로 내용을 임의로 재구성하거나 해석하지 마세요.
            - 반드시 원문에 있는 문장만 주제별로 정리하세요.
            - 응답은 반드시 **JSON만 출력**하세요. 아무 다른 설명도 붙이지 마세요.

            JSON 응답 형식 예시:
            {
              "issues": [
                { "title": "주제 제목1", "content": "관련 문장들" },
                { "title": "주제 제목2", "content": "관련 문장들" }
              ]
            }
        `,
        model: "gpt-4-turbo",
        tools: [],
    });

    assistantId = assistant.id;
    console.log("✅ Assistant 생성 완료! assistant_id:", assistant.id);
    return assistant.id;
  } catch (error) {
    console.error("❌ Assistant 생성 실패:", error);
    return null;
  }
}

// 📌 4️⃣ 메일 내용을 직접 전달하는 메시지 추가
async function addTextMessageToThread(threadId, emailContent) {
  try {
    await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: emailContent // HTML 태그 제거된 본문 텍스트
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

// 📌 6️⃣ GPT에 아매알 본문 전달하여 요약받기
async function getSummarizedJson(emailContent) {
    const threadId = await createThread();
    if (!threadId) return;

    //@ await addMessageToThread(threadId, fileId);
    await addTextMessageToThread(threadId, emailContent);

    // const assistantId = await createAssistant();
    const assistantId = 'asst_jIUgX5VlK84AbE9aWjP7Zrk2';
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

    const summarizedJson = await getSummarizedJson(emailContent);

    if (summarizedJson) {
      await saveJsonToBigQuery(newletterRawId, summarizedJson);
    }
  }
}

// 실행
processNewsletters();
