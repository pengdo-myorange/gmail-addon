/**
 * options.js — 설정 페이지 로직
 * v1.1: API 키, 모델 선택, 카테고리 토글, 커스텀 규칙, 검토 이력, 사용 통계
 */

const CATEGORIES = [
  { id: 'recipient_title', name: '수신자 호칭 오류' },
  { id: 'duplicate', name: '중복 표현' },
  { id: 'spacing', name: '띄어쓰기 오류' },
  { id: 'typo', name: '오타/맞춤법' },
  { id: 'honorific', name: '경어체 불일치' },
  { id: 'particle', name: '조사 오류' },
  { id: 'paragraph', name: '문단 구분 오류' },
];

const DEFAULT_MODEL = 'gemini-3.1-flash-lite-preview';

document.addEventListener('DOMContentLoaded', () => {
  initOnboarding();
  initApiKey();
  initModelSelect();
  initCategories();
  initCustomRules();
  loadHistory();
  loadStats();
});

// --- 온보딩 ---

function initOnboarding() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('onboarding') === 'true') {
    document.getElementById('onboarding-guide').style.display = 'block';
  }
}

// --- API 키 ---

function initApiKey() {
  const input = document.getElementById('api-key-input');
  const toggleBtn = document.getElementById('toggle-visibility');
  const testBtn = document.getElementById('test-btn');
  const saveBtn = document.getElementById('save-btn');
  const resultEl = document.getElementById('test-result');

  chrome.storage.sync.get(['apiKey'], (result) => {
    if (result.apiKey) {
      input.value = result.apiKey;
    }
  });

  toggleBtn.addEventListener('click', () => {
    input.type = input.type === 'password' ? 'text' : 'password';
    toggleBtn.textContent = input.type === 'password' ? '보기' : '숨기기';
  });

  saveBtn.addEventListener('click', () => {
    const key = input.value.trim();
    chrome.storage.sync.set({ apiKey: key }, () => {
      resultEl.style.display = 'block';
      resultEl.className = 'test-result success';
      resultEl.textContent = '✓ 저장되었습니다';
      setTimeout(() => { resultEl.style.display = 'none'; }, 3000);
    });
  });

  testBtn.addEventListener('click', () => {
    const key = input.value.trim();
    if (!key) {
      resultEl.style.display = 'block';
      resultEl.className = 'test-result error';
      resultEl.textContent = '✕ API 키를 입력해주세요';
      return;
    }

    testBtn.disabled = true;
    testBtn.textContent = '테스트 중...';
    resultEl.style.display = 'none';

    const port = chrome.runtime.connect({ name: 'review' });
    port.postMessage({ type: 'testApiKey', apiKey: key });

    port.onMessage.addListener((msg) => {
      testBtn.disabled = false;
      testBtn.textContent = '연결 테스트';

      if (msg.type === 'testResult') {
        resultEl.style.display = 'block';
        if (msg.success) {
          resultEl.className = 'test-result success';
          resultEl.textContent = '✓ 연결 성공';

          const onboardingGuide = document.getElementById('onboarding-guide');
          if (onboardingGuide && onboardingGuide.style.display !== 'none') {
            onboardingGuide.innerHTML = `
              <div style="text-align:center; padding: 16px;">
                <div style="font-size:24px; margin-bottom:8px;">✓</div>
                <strong>설정 완료!</strong>
                <p style="color:#5f6368; margin-top:4px;">Gmail에서 [검토하기] 버튼을 눌러보세요</p>
              </div>
            `;
          }
        } else {
          resultEl.className = 'test-result error';
          resultEl.textContent = msg.status === 401 || msg.status === 403
            ? '✕ API 키가 유효하지 않습니다'
            : msg.error === 'network'
              ? '✕ 네트워크 연결을 확인해주세요'
              : `✕ 연결 실패 (${msg.status || '알 수 없는 오류'})`;
        }
      }
      port.disconnect();
    });
  });
}

// --- 모델 선택 ---

function initModelSelect() {
  const input = document.getElementById('model-input');

  chrome.storage.sync.get(['selectedModel'], (result) => {
    input.value = result.selectedModel || DEFAULT_MODEL;
  });

  input.addEventListener('change', () => {
    const model = input.value.trim() || DEFAULT_MODEL;
    input.value = model;
    chrome.storage.sync.set({ selectedModel: model });
  });
}

// --- 카테고리 토글 ---

function initCategories() {
  const list = document.getElementById('category-list');

  chrome.storage.sync.get(['enabledCategories'], (result) => {
    const enabled = result.enabledCategories || CATEGORIES.map(c => c.id);

    for (const cat of CATEGORIES) {
      const item = document.createElement('div');
      item.className = 'category-item';

      const label = document.createElement('label');
      label.setAttribute('for', `cat-${cat.id}`);
      label.textContent = cat.name;

      const toggle = document.createElement('label');
      toggle.className = 'toggle-switch';

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.id = `cat-${cat.id}`;
      input.checked = enabled.includes(cat.id);
      input.addEventListener('change', saveCategories);

      const slider = document.createElement('span');
      slider.className = 'toggle-slider';

      toggle.appendChild(input);
      toggle.appendChild(slider);

      item.appendChild(label);
      item.appendChild(toggle);
      list.appendChild(item);
    }
  });
}

function saveCategories() {
  const enabled = [];
  for (const cat of CATEGORIES) {
    const checkbox = document.getElementById(`cat-${cat.id}`);
    if (checkbox && checkbox.checked) {
      enabled.push(cat.id);
    }
  }
  chrome.storage.sync.set({ enabledCategories: enabled });
}

// --- 사용자 규칙 ---

function initCustomRules() {
  const textarea = document.getElementById('custom-rules');
  const saveBtn = document.getElementById('save-rules-btn');
  const feedback = document.getElementById('rules-save-feedback');

  chrome.storage.sync.get(['customRules'], (result) => {
    if (result.customRules) {
      textarea.value = result.customRules;
    }
  });

  saveBtn.addEventListener('click', () => {
    chrome.storage.sync.set({ customRules: textarea.value }, () => {
      feedback.classList.add('visible');
      setTimeout(() => feedback.classList.remove('visible'), 2000);
    });
  });
}

// --- 검토 이력 ---

function loadHistory() {
  chrome.runtime.sendMessage({ type: 'getReviewHistory' }, (response) => {
    const container = document.getElementById('history-container');
    const history = response?.history || [];

    if (history.length === 0) {
      container.innerHTML = '<p class="empty-state">아직 검토 이력이 없습니다.</p>';
      return;
    }

    const recentHistory = history.slice(-20).reverse();
    let html = `
      <table class="history-table">
        <thead>
          <tr><th>날짜</th><th>이슈 수</th><th>반영</th><th>무시</th></tr>
        </thead>
        <tbody>
    `;

    for (const entry of recentHistory) {
      const date = new Date(entry.timestamp).toLocaleDateString('ko-KR', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      });
      html += `
        <tr>
          <td>${date}</td>
          <td>${entry.total_issues}건</td>
          <td>${entry.applied_count}건</td>
          <td>${entry.ignored_count}건</td>
        </tr>
      `;
    }

    html += '</tbody></table>';
    container.innerHTML = html;
  });
}

// --- 사용 통계 ---

function loadStats() {
  chrome.runtime.sendMessage({ type: 'getUsageEvents' }, (response) => {
    const container = document.getElementById('stats-container');
    const events = response?.events || [];

    if (events.length === 0) {
      container.innerHTML = '<p class="empty-state">아직 사용 통계가 없습니다.</p>';
      return;
    }

    const totalReviews = events.filter(e => e.event_type === 'review_started').length;
    const totalApplied = events.filter(e => e.event_type === 'issue_applied').length;
    const totalIgnored = events.filter(e => e.event_type === 'issue_ignored').length;
    const totalIssues = events.filter(e => e.event_type === 'issue_found').length;

    const categoryCounts = {};
    for (const e of events) {
      if (e.event_type === 'issue_found' && e.category) {
        categoryCounts[e.category] = (categoryCounts[e.category] || 0) + 1;
      }
    }

    const topCategories = Object.entries(categoryCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3);

    const maxCount = topCategories.length > 0 ? topCategories[0][1] : 1;

    let html = `
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">${totalReviews}</div>
          <div class="stat-label">총 검토 수</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${totalIssues}</div>
          <div class="stat-label">발견된 이슈</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${totalApplied}</div>
          <div class="stat-label">반영된 수정</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${totalApplied + totalIgnored > 0 ? Math.round(totalApplied / (totalApplied + totalIgnored) * 100) : 0}%</div>
          <div class="stat-label">반영 비율</div>
        </div>
      </div>
    `;

    if (topCategories.length > 0) {
      html += '<div class="top-categories"><h3>자주 발견되는 오류 TOP 3</h3>';
      for (const [catId, count] of topCategories) {
        const catInfo = CATEGORIES.find(c => c.id === catId);
        const name = catInfo ? catInfo.name : catId;
        const width = Math.round((count / maxCount) * 100);
        html += `
          <div class="category-bar">
            <span style="min-width:100px">${name}</span>
            <div style="flex:1;background:#e8eaed;border-radius:4px;overflow:hidden;">
              <div class="category-bar-fill" style="width:${width}%"></div>
            </div>
            <span>${count}건</span>
          </div>
        `;
      }
      html += '</div>';
    }

    container.innerHTML = html;
  });
}
