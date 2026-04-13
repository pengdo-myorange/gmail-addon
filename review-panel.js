/**
 * review-panel.js — Shadow DOM 리뷰 패널 UI
 * 6개 상태 화면, 카드 스트리밍, 접근성
 */

const ReviewPanel = (() => {
  const PANEL_ATTR = 'data-email-review-panel';

  function create(composeContainer, callbacks) {
    const existing = composeContainer.querySelector(`[${PANEL_ATTR}]`);
    if (existing) existing.remove();

    const host = document.createElement('div');
    host.setAttribute(PANEL_ATTR, 'true');
    composeContainer.appendChild(host);

    const shadow = host.attachShadow({ mode: 'open' });

    const cssUrl = chrome.runtime.getURL('review-panel.css');
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = cssUrl;
    shadow.appendChild(link);

    const panel = document.createElement('div');
    panel.className = 'review-panel';
    panel.setAttribute('role', 'complementary');
    panel.setAttribute('aria-label', '이메일 검토 결과');
    shadow.appendChild(panel);

    const state = {
      host,
      shadow,
      panel,
      issues: [],
      resolvedCount: 0,
      totalIssues: 0,
      callbacks,
    };

    showLoading(state);
    return state;
  }

  function destroy(state) {
    if (!state || !state.host) return;
    state.panel.classList.add('closing');
    setTimeout(() => {
      state.host.remove();
    }, 150);
  }

  // --- State screens ---

  function showLoading(state) {
    state.panel.innerHTML = '';

    const summaryBar = _createSummaryBar('검토 중...', state);
    state.panel.appendChild(summaryBar);

    for (let i = 0; i < 3; i++) {
      const skeleton = document.createElement('div');
      skeleton.className = 'skeleton-card';
      skeleton.innerHTML = `
        <div class="skeleton-line short"></div>
        <div class="skeleton-line long"></div>
        <div class="skeleton-line medium"></div>
      `;
      state.panel.appendChild(skeleton);
    }
  }

  function showStreaming(state) {
    state.panel.innerHTML = '';

    const summaryBar = _createSummaryBar(`검토 중... (${state.issues.length}건 발견)`, state);
    summaryBar.id = 'streaming-summary';
    state.panel.appendChild(summaryBar);

    const list = document.createElement('ul');
    list.className = 'issue-list';
    list.setAttribute('role', 'list');
    state.panel.appendChild(list);

    for (let i = 0; i < state.issues.length; i++) {
      const card = _createIssueCard(state.issues[i], i, state);
      card.style.animationDelay = `${i * 100}ms`;
      list.appendChild(card);
    }

    const indicator = document.createElement('div');
    indicator.className = 'streaming-indicator';
    indicator.innerHTML = '<div class="spinner"></div><span>추가 오류 검색 중...</span>';
    state.panel.appendChild(indicator);
  }

  function addStreamingIssue(state, issue) {
    state.issues.push(issue);

    const summary = state.panel.querySelector('#streaming-summary .summary-text');
    if (summary) {
      summary.textContent = `검토 중... (${state.issues.length}건 발견)`;
    }

    const list = state.panel.querySelector('.issue-list');
    if (list) {
      const card = _createIssueCard(issue, state.issues.length - 1, state);
      card.style.animationDelay = `${(state.issues.length - 1) * 100}ms`;
      list.appendChild(card);
    }
  }

  function showComplete(state, totalIssues) {
    state.totalIssues = totalIssues;
    state.panel.innerHTML = '';

    if (totalIssues === 0) {
      _showNoIssues(state);
      return;
    }

    const summaryBar = _createSummaryBar(`${totalIssues}건의 수정 제안`, state);
    state.panel.appendChild(summaryBar);

    const list = document.createElement('ul');
    list.className = 'issue-list';
    list.setAttribute('role', 'list');
    state.panel.appendChild(list);

    for (let i = 0; i < state.issues.length; i++) {
      const card = _createIssueCard(state.issues[i], i, state);
      list.appendChild(card);
    }

    const actionBar = _createActionBar(state);
    state.panel.appendChild(actionBar);

    const firstApply = state.shadow.querySelector('.btn-apply');
    if (firstApply) firstApply.focus();
  }

  function showError(state, code, message) {
    state.panel.innerHTML = '';

    const summaryBar = _createSummaryBar('오류', state);
    state.panel.appendChild(summaryBar);

    const screen = document.createElement('div');
    screen.className = 'state-screen';

    if (code === 'NO_API_KEY') {
      screen.innerHTML = `
        <div class="state-icon">🔑</div>
        <div class="state-message">API 키를 설정해주세요</div>
        <a class="btn-settings-link" id="open-settings">설정 열기</a>
      `;
    } else {
      screen.innerHTML = `
        <div class="state-icon">⚠️</div>
        <div class="state-message">${_escapeHtml(message || '검토 서비스를 사용할 수 없습니다')}</div>
      `;
    }
    state.panel.appendChild(screen);

    const actionBar = document.createElement('div');
    actionBar.className = 'action-bar';
    actionBar.innerHTML = '<div class="action-left"></div>';

    if (code !== 'NO_API_KEY') {
      const retryBtn = document.createElement('button');
      retryBtn.className = 'btn-retry';
      retryBtn.textContent = '다시 시도';
      retryBtn.addEventListener('click', () => {
        if (state.callbacks && state.callbacks.onRetry) state.callbacks.onRetry();
      });
      actionBar.querySelector('.action-left').appendChild(retryBtn);
    }

    state.panel.appendChild(actionBar);

    const settingsLink = screen.querySelector('#open-settings');
    if (settingsLink) {
      settingsLink.addEventListener('click', (e) => {
        e.preventDefault();
        chrome.runtime.sendMessage({ type: 'openOptions' });
        chrome.runtime.openOptionsPage?.();
      });
    }
  }

  function _showNoIssues(state) {
    state.panel.innerHTML = '';

    const summaryBar = _createSummaryBar('검토 완료', state);
    state.panel.appendChild(summaryBar);

    const screen = document.createElement('div');
    screen.className = 'state-screen';
    screen.innerHTML = `
      <div class="state-icon">✅</div>
      <div class="state-message">수정 사항이 없습니다</div>
    `;
    state.panel.appendChild(screen);

    state.panel.classList.add('auto-close-panel');
    setTimeout(() => destroy(state), 3000);
  }

  // --- Helpers ---

  function _createSummaryBar(text, state) {
    const bar = document.createElement('div');
    bar.className = 'summary-bar';
    bar.setAttribute('role', 'heading');
    bar.setAttribute('aria-level', '2');

    const span = document.createElement('span');
    span.className = 'summary-text';
    span.textContent = text;
    bar.appendChild(span);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'close-btn';
    closeBtn.setAttribute('aria-label', '검토 패널 닫기');
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => destroy(state));
    bar.appendChild(closeBtn);

    return bar;
  }

  function _createIssueCard(issue, index, state) {
    const card = document.createElement('li');
    card.className = 'issue-card';
    card.setAttribute('role', 'listitem');
    card.dataset.index = index;

    const categoryInfo = EmailReviewPrompts.getCategoryInfo(issue.category);
    const catName = categoryInfo ? categoryInfo.name : issue.category;
    const catBg = categoryInfo ? categoryInfo.color.bg : '#f1f3f4';
    const catText = categoryInfo ? categoryInfo.color.text : '#5f6368';

    const header = document.createElement('div');
    header.className = 'card-header';

    const content = document.createElement('div');
    content.className = 'card-content';

    const pill = document.createElement('span');
    pill.className = 'category-pill';
    pill.style.backgroundColor = catBg;
    pill.style.color = catText;
    pill.textContent = catName;
    content.appendChild(pill);

    const original = document.createElement('div');
    original.className = 'original-text';
    original.textContent = issue.original;
    content.appendChild(original);

    const corrected = document.createElement('div');
    corrected.className = 'corrected-text';
    corrected.textContent = issue.corrected;
    content.appendChild(corrected);

    if (issue.explanation) {
      const explanation = document.createElement('div');
      explanation.className = 'explanation-text';
      explanation.textContent = issue.explanation;
      content.appendChild(explanation);
    }

    header.appendChild(content);

    const actions = document.createElement('div');
    actions.className = 'card-actions';

    const applyBtn = document.createElement('button');
    applyBtn.className = 'btn-apply';
    applyBtn.textContent = '반영';
    applyBtn.setAttribute('aria-label', `${catName} 수정 반영`);
    applyBtn.addEventListener('click', () => _handleApply(state, card, issue, index));

    const ignoreBtn = document.createElement('button');
    ignoreBtn.className = 'btn-ignore';
    ignoreBtn.textContent = '무시';
    ignoreBtn.setAttribute('aria-label', `${catName} 수정 무시`);
    ignoreBtn.addEventListener('click', () => _handleIgnore(state, card, issue, index));

    actions.appendChild(applyBtn);
    actions.appendChild(ignoreBtn);
    header.appendChild(actions);
    card.appendChild(header);

    return card;
  }

  function _handleApply(state, card, issue, index) {
    card.classList.add('applied');
    const actions = card.querySelector('.card-actions');
    if (actions) {
      actions.innerHTML = '<span class="card-status-icon">✓</span>';
    }

    state.resolvedCount++;
    if (state.callbacks && state.callbacks.onApply) {
      state.callbacks.onApply(issue, index);
    }

    chrome.runtime.sendMessage({
      type: 'logUsageEvent',
      event: { event_type: 'issue_applied', category: issue.category },
    });

    setTimeout(() => {
      card.classList.add('collapsing');
      setTimeout(() => card.remove(), 200);
      _updateActionBar(state);
    }, 500);
  }

  function _handleIgnore(state, card, issue, index) {
    card.classList.add('ignored');
    const actions = card.querySelector('.card-actions');
    if (actions) {
      actions.innerHTML = '<span class="card-status-icon" style="opacity:0.4">—</span>';
    }

    state.resolvedCount++;
    if (state.callbacks && state.callbacks.onIgnore) {
      state.callbacks.onIgnore(issue, index);
    }

    chrome.runtime.sendMessage({
      type: 'logUsageEvent',
      event: { event_type: 'issue_ignored', category: issue.category },
    });

    setTimeout(() => {
      card.classList.add('collapsing');
      setTimeout(() => card.remove(), 200);
      _updateActionBar(state);
    }, 300);
  }

  function _createActionBar(state) {
    const bar = document.createElement('div');
    bar.className = 'action-bar';
    bar.id = 'action-bar';

    const left = document.createElement('div');
    left.className = 'action-left';

    const applyAllBtn = document.createElement('button');
    applyAllBtn.className = 'btn-apply-all';
    applyAllBtn.textContent = '전체 반영하기';
    applyAllBtn.setAttribute('aria-label', '모든 수정 사항 반영');
    applyAllBtn.addEventListener('click', () => {
      if (state.callbacks && state.callbacks.onApplyAll) {
        state.callbacks.onApplyAll(state.issues);
      }
      const cards = state.panel.querySelectorAll('.issue-card');
      cards.forEach((c) => {
        c.classList.add('applied');
        const a = c.querySelector('.card-actions');
        if (a) a.innerHTML = '<span class="card-status-icon">✓</span>';
      });
      state.resolvedCount = state.totalIssues;

      for (const issue of state.issues) {
        chrome.runtime.sendMessage({
          type: 'logUsageEvent',
          event: { event_type: 'issue_applied', category: issue.category },
        });
      }

      setTimeout(() => {
        cards.forEach(c => { c.classList.add('collapsing'); });
        setTimeout(() => {
          cards.forEach(c => c.remove());
          _updateActionBar(state);
        }, 200);
      }, 500);
    });
    left.appendChild(applyAllBtn);

    const retryBtn = document.createElement('button');
    retryBtn.className = 'btn-retry';
    retryBtn.textContent = '다시 검토하기';
    retryBtn.addEventListener('click', () => {
      if (state.callbacks && state.callbacks.onRetry) state.callbacks.onRetry();
    });
    left.appendChild(retryBtn);

    bar.appendChild(left);

    const status = document.createElement('span');
    status.className = 'action-status';
    status.id = 'action-status';
    status.textContent = `검토 완료 (${state.totalIssues}건)`;
    bar.appendChild(status);

    return bar;
  }

  function _updateActionBar(state) {
    const statusEl = state.panel.querySelector('#action-status');
    if (statusEl) {
      const remaining = state.panel.querySelectorAll('.issue-card').length;
      if (remaining === 0) {
        statusEl.textContent = '모든 항목 처리 완료';
        const applyAllBtn = state.panel.querySelector('.btn-apply-all');
        if (applyAllBtn) applyAllBtn.disabled = true;
      }
    }
  }

  function _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  return {
    create,
    destroy,
    showLoading,
    showStreaming,
    addStreamingIssue,
    showComplete,
    showError,
  };
})();
