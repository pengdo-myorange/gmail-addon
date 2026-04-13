/**
 * background.js — Service Worker
 * Gemini 스트리밍 API, Port 메시지 패싱, 온보딩, 뱃지, 통계/이력
 * v1.1: 모델 선택, 카테고리 필터, 커스텀 규칙, corrected_body, top3 인사이트
 */

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL = 'gemini-3.1-flash-lite-preview';
const STORAGE_KEY_USAGE = 'usage_events';
const STORAGE_KEY_HISTORY = 'review_history';
const MAX_USAGE_EVENTS = 1000;
const MAX_HISTORY_ENTRIES = 50;

const ALL_CATEGORY_IDS = [
  'recipient_title', 'duplicate', 'spacing', 'typo',
  'honorific', 'particle', 'paragraph',
];

const CATEGORY_DESCRIPTIONS = {
  recipient_title: '수신자 호칭 오류: 받는 사람 이름/직책 잘못 표기',
  duplicate: '중복 표현: 동일 인사말/맺음말 반복',
  spacing: '띄어쓰기 오류: 명백한 띄어쓰기 오류만 지적',
  typo: '오타/맞춤법: 단순 입력 실수, 맞춤법 오류',
  honorific: '경어체 불일치: 문장 내/간 존칭 수준 혼용',
  particle: '조사 오류: 잘못된 조사 사용',
  paragraph: '문단 구분 오류: 연속 빈 줄(2줄 이상) 과다',
};

// --- Onboarding ---

const MODEL_MIGRATION = {
  'gemini-3.1-flash-lite': 'gemini-3.1-flash-lite-preview',
  'gemini-3.0-flash': 'gemini-3-flash-preview',
  'gemini-3.0-pro': 'gemini-3.1-pro-preview',
};

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('options.html?onboarding=true') });
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#FF6B2C' });
  }

  chrome.storage.sync.get(['selectedModel'], (result) => {
    const old = result.selectedModel;
    if (old && MODEL_MIGRATION[old]) {
      chrome.storage.sync.set({ selectedModel: MODEL_MIGRATION[old] });
    }
  });
});

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

// --- Port-based streaming communication ---

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'review') return;

  port.onMessage.addListener(async (msg) => {
    if (msg.type === 'startReview') {
      await handleReview(port, msg.emailBody, {
        recipients: msg.recipients,
        quotedContext: msg.quotedContext,
      });
    } else if (msg.type === 'testApiKey') {
      await handleTestApiKey(port, msg.apiKey);
    }
  });
});

// --- Simple message listener ---

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'getApiKey') {
    chrome.storage.sync.get(['apiKey'], (result) => {
      sendResponse({ apiKey: result.apiKey || '' });
    });
    return true;
  }

  if (msg.type === 'saveApiKey') {
    chrome.storage.sync.set({ apiKey: msg.apiKey }, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (msg.type === 'logUsageEvent') {
    logUsageEvent(msg.event).then(() => sendResponse({ success: true }));
    return true;
  }

  if (msg.type === 'saveReviewHistory') {
    saveReviewHistory(msg.entry).then(() => sendResponse({ success: true }));
    return true;
  }

  if (msg.type === 'getUsageEvents') {
    chrome.storage.local.get([STORAGE_KEY_USAGE], (result) => {
      sendResponse({ events: result[STORAGE_KEY_USAGE] || [] });
    });
    return true;
  }

  if (msg.type === 'getReviewHistory') {
    chrome.storage.local.get([STORAGE_KEY_HISTORY], (result) => {
      sendResponse({ history: result[STORAGE_KEY_HISTORY] || [] });
    });
    return true;
  }

  if (msg.type === 'getTopCategories') {
    getTopCategories().then((top) => sendResponse({ topCategories: top }));
    return true;
  }

  if (msg.type === 'clearBadge') {
    chrome.action.setBadgeText({ text: '' });
    sendResponse({ success: true });
    return true;
  }

  if (msg.type === 'selectorFailure') {
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#D93025' });
    sendResponse({ success: true });
    return true;
  }
});

// --- Gemini Streaming Review ---

async function handleReview(port, emailBody, { recipients, quotedContext } = {}) {
  let apiKey, selectedModel, enabledCategories, customRules;
  try {
    const result = await chrome.storage.sync.get([
      'apiKey', 'selectedModel', 'enabledCategories', 'customRules'
    ]);
    apiKey = result.apiKey;
    selectedModel = MODEL_MIGRATION[result.selectedModel] || result.selectedModel || DEFAULT_MODEL;
    enabledCategories = result.enabledCategories || ALL_CATEGORY_IDS;
    customRules = result.customRules || '';
  } catch (e) {
    port.postMessage({ type: 'error', code: 'STORAGE_ERROR', message: 'API 키를 읽을 수 없습니다.' });
    return;
  }

  if (!apiKey) {
    port.postMessage({ type: 'error', code: 'NO_API_KEY', message: 'API 키가 설정되지 않았습니다.' });
    return;
  }

  await logUsageEvent({ event_type: 'review_started' });
  port.postMessage({ type: 'status', status: 'loading' });

  const systemPrompt = buildSystemPrompt({ enabledCategories, customRules });
  const userPrompt = _buildUserPrompt(emailBody, { recipients, quotedContext });

  const url = `${GEMINI_API_BASE}/${selectedModel}:streamGenerateContent?key=${apiKey}&alt=sse`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.1,
    },
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      let code = 'API_ERROR';
      if (response.status === 429) code = 'RATE_LIMIT';
      else if (response.status === 401 || response.status === 403) code = 'INVALID_KEY';
      port.postMessage({ type: 'error', code, message: `API 오류 (${response.status})` });
      await logUsageEvent({ event_type: 'error', error_code: code });
      return;
    }

    port.postMessage({ type: 'status', status: 'streaming' });

    let accumulated = '';
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let lastParsedCount = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6).trim();
        if (!jsonStr || jsonStr === '[DONE]') continue;

        try {
          const parsed = JSON.parse(jsonStr);
          const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            accumulated += text;
            const issues = tryParsePartialIssues(accumulated);
            if (issues && issues.length > lastParsedCount) {
              port.postMessage({ type: 'streamingCount', count: issues.length });
              lastParsedCount = issues.length;
            }
          }
        } catch (e) {
          // partial JSON, continue
        }
      }
    }

    const finalResult = tryParseFinalResult(accumulated);
    if (finalResult) {
      port.postMessage({
        type: 'complete',
        totalIssues: finalResult.issues.length,
        correctedBody: finalResult.corrected_body || null,
        issues: finalResult.issues,
      });

      await saveReviewHistory({
        timestamp: Date.now(),
        total_issues: finalResult.issues.length,
        categories: summarizeCategories(finalResult.issues),
        applied_count: 0,
        ignored_count: 0,
      });

      for (const issue of finalResult.issues) {
        await logUsageEvent({
          event_type: 'issue_found',
          category: issue.category,
        });
      }
      await logUsageEvent({ event_type: 'review_completed' });

      chrome.action.setBadgeText({ text: '' });
    } else {
      port.postMessage({ type: 'error', code: 'PARSE_ERROR', message: '검토 결과를 해석할 수 없습니다.' });
      await logUsageEvent({ event_type: 'error', error_code: 'PARSE_ERROR' });
    }

  } catch (e) {
    if (e.name === 'TypeError' && e.message.includes('Failed to fetch')) {
      port.postMessage({ type: 'error', code: 'NETWORK_ERROR', message: '네트워크 연결을 확인해주세요.' });
    } else {
      port.postMessage({ type: 'error', code: 'UNKNOWN', message: '알 수 없는 오류가 발생했습니다.' });
    }
    await logUsageEvent({ event_type: 'error', error_code: 'NETWORK_ERROR' });
  }
}

// --- API Key Test ---

async function handleTestApiKey(port, apiKey) {
  let selectedModel;
  try {
    const result = await chrome.storage.sync.get(['selectedModel']);
    selectedModel = MODEL_MIGRATION[result.selectedModel] || result.selectedModel || DEFAULT_MODEL;
  } catch (e) {
    selectedModel = DEFAULT_MODEL;
  }

  const url = `${GEMINI_API_BASE}/${selectedModel}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: '안녕' }] }],
    generationConfig: { maxOutputTokens: 10 },
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (response.ok) {
      port.postMessage({ type: 'testResult', success: true });
    } else {
      port.postMessage({ type: 'testResult', success: false, status: response.status });
    }
  } catch (e) {
    port.postMessage({ type: 'testResult', success: false, error: 'network' });
  }
}

// --- System Prompt Builder ---

function buildSystemPrompt({ enabledCategories, customRules } = {}) {
  const activeCats = enabledCategories && enabledCategories.length > 0
    ? enabledCategories.filter(id => CATEGORY_DESCRIPTIONS[id])
    : ALL_CATEGORY_IDS;

  const categoryList = activeCats
    .map((id, i) => `${i + 1}. ${id} (${CATEGORY_DESCRIPTIONS[id]})`)
    .join('\n');

  let prompt = `당신은 한국어 비즈니스 이메일 전문 검토자입니다.
사용자가 제출한 이메일 본문을 분석하여, 아래 카테고리에 해당하는 오류를 찾아 수정하세요.

## 검토 카테고리
${categoryList}

## 문단 구분 규칙 (매우 중요)
- 연속 빈 줄이 2줄 이상이면 1줄로 축소
- 의미가 달라지는 문단 사이에만 빈 줄(\\n\\n) 1개를 삽입
- 같은 문단 안의 문장들은 빈 줄 없이 줄바꿈(\\n)으로만 연결
- 절대로 모든 줄 사이에 빈 줄을 넣지 말 것

corrected_body의 줄바꿈 형식 예시:
"OOO님께,\\n안녕하세요?\\n\\n본문 첫째 문단 문장1\\n본문 첫째 문단 문장2\\n\\n본문 둘째 문단 문장1\\n본문 둘째 문단 문장2\\n본문 둘째 문단 문장3\\n\\n감사합니다.\\nOOO 드림"

위 예시에서 \\n은 줄바꿈, \\n\\n은 빈 줄(문단 구분)입니다. 같은 문단 내 문장 사이에는 \\n만 사용하세요.

## 수정하지 말 것 (금지 규칙)
- 호칭과 인사말이 바로 이어지는 경우(예: "OOO님께,\\n안녕하세요?") 사이에 빈 줄을 삽입하지 마세요. 호칭 뒤 줄바꿈 패턴은 원본 그대로 유지하세요.
- "OOO 드림", "OOO 올림" 등은 맺음말의 일부이지 별도 서명이 아닙니다. 앞에 빈 줄을 삽입하지 마세요.
- "드림"을 "올림"으로 바꾸지 마세요. 맺음 표현("드림", "올림", "배상" 등)은 작성자의 선택이므로 수정 대상이 아닙니다.
- 맺음말(예: "감사합니다.\\nOOO 드림")의 줄바꿈 패턴은 원본 그대로 유지하세요.
- 날짜, 기한, 일정, 숫자를 수정하지 마세요. 문맥상 불일치해 보여도 작성자의 의도이므로 변경하지 않습니다. 다른 카테고리(typo, spacing 등)로도 날짜를 수정하지 마세요.
- 경어체 불일치는 존대("~합니다", "~해요")와 반말("~해라", "~해")이 섞인 명백한 오류만 지적하세요. "~합니다"와 "~해요" 혼재, 정중한 우회 표현(예: "~될지요?", "~될까요?")은 수정 대상이 아닙니다.`;

  if (customRules && customRules.trim()) {
    prompt += `

## 사용자 지정 규칙
${customRules.trim()}`;
  }

  prompt += `

## 출력 규칙
- 반드시 JSON 형식으로 응답하세요.
- corrected_body: 모든 수정 사항을 반영한 전체 이메일 본문을 포함하세요.
- issues 배열: 각 수정 사항을 개별 항목으로 나열하세요.
- 오류가 없으면: {"corrected_body": "원본 그대로", "issues": []}
- original 필드: 문제가 되는 원문 텍스트 (문맥 파악 가능한 최소 범위)
- corrected 필드: 수정된 텍스트
- explanation 필드: 왜 수정이 필요한지 한국어로 간결하게 설명
- 작성자의 문체와 어투를 최대한 유지하세요.
- 확실한 오류만 지적하세요. 스타일 선호도 차이는 지적하지 마세요.
- 오탐(false positive)을 최소화하세요.
- 매 검토 시 모든 오류를 빠짐없이 한 번에 찾아내세요. 누락 없이 전수 검사하세요.
- 수신자 정보나 원본 메일 컨텍스트가 함께 제공되면, 본문에서 사용된 호칭(이름, 직책)이 해당 정보와 일치하는지 반드시 대조하세요.

## 응답 형식
\`\`\`json
{
  "corrected_body": "수정된 전체 이메일 본문",
  "issues": [
    {
      "category": "카테고리_id",
      "original": "문제 원문",
      "corrected": "수정안",
      "explanation": "수정 이유"
    }
  ]
}
\`\`\``;

  return prompt;
}

// --- User Prompt Builder ---

function _buildUserPrompt(emailBody, { recipients, quotedContext } = {}) {
  let prompt = '';

  if (recipients && recipients.length > 0) {
    const recipientList = recipients
      .map(r => {
        const label = r.type === 'cc' ? ' (참조)' : r.type === 'bcc' ? ' (숨은참조)' : '';
        return r.name ? `${r.name}${label}` : `${r.email}${label}`;
      })
      .join(', ');
    prompt += `[수신자 정보] ${recipientList}\n`;
  }

  if (quotedContext) {
    prompt += '[원본 메일 컨텍스트]\n';
    if (quotedContext.header) {
      prompt += `헤더: ${quotedContext.header}\n`;
    }
    if (quotedContext.opening) {
      prompt += `원본 서두: ${quotedContext.opening}\n`;
    }
    if (quotedContext.signature) {
      prompt += `원본 서명: ${quotedContext.signature}\n`;
    }
  }

  if (prompt) {
    prompt += '\n---\n\n';
  }

  prompt += `다음 이메일 본문을 검토해주세요:\n\n${emailBody}`;
  return prompt;
}

// --- Parsing helpers ---

function tryParsePartialIssues(text) {
  try {
    const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (parsed && Array.isArray(parsed.issues)) {
      return parsed.issues;
    }
  } catch (e) {
    try {
      const match = text.match(/"issues"\s*:\s*\[/);
      if (match) {
        const startIdx = text.indexOf('[', match.index);
        let bracketCount = 0;
        let lastCompleteItem = -1;
        for (let i = startIdx; i < text.length; i++) {
          if (text[i] === '{') bracketCount++;
          else if (text[i] === '}') {
            bracketCount--;
            if (bracketCount === 0) lastCompleteItem = i;
          }
        }
        if (lastCompleteItem > startIdx) {
          const partial = text.substring(startIdx, lastCompleteItem + 1) + ']';
          return JSON.parse(partial);
        }
      }
    } catch (e2) {
      // not parseable yet
    }
  }
  return null;
}

function tryParseFinalResult(text) {
  try {
    const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (parsed && Array.isArray(parsed.issues)) return parsed;
  } catch (e) {
    // ignore
  }
  return null;
}

function summarizeCategories(issues) {
  const counts = {};
  for (const issue of issues) {
    counts[issue.category] = (counts[issue.category] || 0) + 1;
  }
  return Object.entries(counts).map(([name, count]) => ({ name, count }));
}

// --- Top 3 Categories ---

async function getTopCategories() {
  try {
    const result = await chrome.storage.local.get([STORAGE_KEY_USAGE]);
    const events = result[STORAGE_KEY_USAGE] || [];
    const categoryCounts = {};
    for (const evt of events) {
      if (evt.event_type === 'issue_found' && evt.category) {
        categoryCounts[evt.category] = (categoryCounts[evt.category] || 0) + 1;
      }
    }
    const sorted = Object.entries(categoryCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([category, count]) => ({ category, count }));
    return sorted;
  } catch (e) {
    return [];
  }
}

// --- Usage stats & review history ---

async function logUsageEvent(event) {
  try {
    const result = await chrome.storage.local.get([STORAGE_KEY_USAGE]);
    const events = result[STORAGE_KEY_USAGE] || [];
    events.push({ ...event, timestamp: Date.now() });
    if (events.length > MAX_USAGE_EVENTS) {
      events.splice(0, events.length - MAX_USAGE_EVENTS);
    }
    await chrome.storage.local.set({ [STORAGE_KEY_USAGE]: events });
  } catch (e) {
    console.error('Failed to log usage event:', e);
  }
}

async function saveReviewHistory(entry) {
  try {
    const result = await chrome.storage.local.get([STORAGE_KEY_HISTORY]);
    const history = result[STORAGE_KEY_HISTORY] || [];
    history.push(entry);
    if (history.length > MAX_HISTORY_ENTRIES) {
      history.splice(0, history.length - MAX_HISTORY_ENTRIES);
    }
    await chrome.storage.local.set({ [STORAGE_KEY_HISTORY]: history });
  } catch (e) {
    console.error('Failed to save review history:', e);
  }
}
