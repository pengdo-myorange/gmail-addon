/**
 * review-panel.js — 모달 다이얼로그 리뷰 패널
 * document.body에 Shadow DOM 모달 삽입
 * v1.1: 수정본 + 변경 요약 리스트 + TOP 3 인사이트
 */

const ReviewPanel = (() => {
  const MODAL_ATTR = 'data-email-review-modal';

  function _isContextValid() {
    try {
      return !!chrome.runtime?.id;
    } catch (e) {
      return false;
    }
  }

  const CATEGORY_NAMES = {
    recipient_title: '수신자 호칭',
    duplicate: '중복 표현',
    spacing: '띄어쓰기',
    typo: '오타/맞춤법',
    honorific: '경어체',
    missing: '누락 요소',
    awkward: '어색한 표현',
    particle: '조사 오류',
    paragraph: '문단 구분',
  };

  function create(callbacks) {
    if (!_isContextValid()) return null;
    destroyAll();

    const host = document.createElement('div');
    host.setAttribute(MODAL_ATTR, 'true');
    host.style.position = 'fixed';
    host.style.top = '0';
    host.style.left = '0';
    host.style.width = '0';
    host.style.height = '0';
    host.style.zIndex = '999999';
    document.body.appendChild(host);

    const shadow = host.attachShadow({ mode: 'open' });

    let cssUrl;
    try {
      cssUrl = chrome.runtime.getURL('review-panel.css');
    } catch (e) {
      host.remove();
      return null;
    }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = cssUrl;
    shadow.appendChild(link);

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', '이메일 검토 결과');
    shadow.appendChild(overlay);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) destroy(state);
    });

    const container = document.createElement('div');
    container.className = 'modal-container';
    overlay.appendChild(container);

    const state = {
      host,
      shadow,
      overlay,
      container,
      callbacks,
      issues: [],
      correctedBody: null,
      streamingCount: 0,
    };

    document.addEventListener('keydown', state._escHandler = (e) => {
      if (e.key === 'Escape') destroy(state);
    });

    return state;
  }

  function destroy(state) {
    if (!state || !state.host) return;
    if (state._escHandler) {
      document.removeEventListener('keydown', state._escHandler);
    }
    state.overlay.classList.add('closing');
    setTimeout(() => {
      state.host.remove();
    }, 150);
  }

  function destroyAll() {
    document.querySelectorAll(`[${MODAL_ATTR}]`).forEach(el => el.remove());
  }

  // --- State Screens ---

  function showLoading(state) {
    if (!state?.container) return;
    state.container.innerHTML = '';

    const header = _buildHeader('검토 중...', state);
    state.container.appendChild(header);

    const body = document.createElement('div');
    body.className = 'modal-body';
    for (let i = 0; i < 3; i++) {
      const skeleton = document.createElement('div');
      skeleton.className = 'skeleton-card';
      skeleton.innerHTML = `
        <div class="skeleton-line short"></div>
        <div class="skeleton-line long"></div>
        <div class="skeleton-line medium"></div>
      `;
      body.appendChild(skeleton);
    }
    state.container.appendChild(body);
  }

  function showStreaming(state, count) {
    if (!state?.container) return;
    state.streamingCount = count || state.streamingCount;
    const titleEl = state.container.querySelector('.modal-title');
    if (titleEl) {
      titleEl.textContent = `검토 중... (${state.streamingCount}건 발견)`;
    }
  }

  function showComplete(state, correctedBody, issues, totalIssues) {
    if (!state?.container) return;
    state.correctedBody = correctedBody;
    state.issues = issues || [];
    state.container.innerHTML = '';

    if (totalIssues === 0 || state.issues.length === 0) {
      _showNoIssues(state);
      return;
    }

    const header = _buildHeader(`검토 완료 — ${totalIssues}건의 수정 제안`, state);
    state.container.appendChild(header);

    const body = document.createElement('div');
    body.className = 'modal-body';

    if (correctedBody) {
      const correctedSection = document.createElement('div');
      correctedSection.className = 'corrected-body-section';

      const label = document.createElement('div');
      label.className = 'section-label';
      label.textContent = '수정된 이메일';
      correctedSection.appendChild(label);

      const card = document.createElement('div');
      card.className = 'corrected-body-card';
      card.innerHTML = _highlightCorrections(correctedBody, issues);
      correctedSection.appendChild(card);

      body.appendChild(correctedSection);
    }

    const divider = document.createElement('div');
    divider.className = 'section-divider';
    body.appendChild(divider);

    const summarySection = document.createElement('div');
    summarySection.className = 'changes-summary-section';

    const summaryLabel = document.createElement('div');
    summaryLabel.className = 'section-label';
    summaryLabel.textContent = `변경 사항 (${issues.length}건)`;
    summarySection.appendChild(summaryLabel);

    const changesList = document.createElement('ul');
    changesList.className = 'changes-list';

    for (const issue of issues) {
      const item = _buildChangeItem(issue);
      changesList.appendChild(item);
    }

    summarySection.appendChild(changesList);
    body.appendChild(summarySection);

    state.container.appendChild(body);

    _loadInsight(state);

    const footer = _buildFooter(state, totalIssues);
    state.container.appendChild(footer);
  }

  function showError(state, code, message) {
    if (!state?.container) return;
    state.container.innerHTML = '';

    const header = _buildHeader('오류', state);
    state.container.appendChild(header);

    const body = document.createElement('div');
    body.className = 'modal-body';

    const screen = document.createElement('div');
    screen.className = 'state-screen';

    if (code === 'NO_API_KEY') {
      screen.innerHTML = `
        <div class="state-icon">🔑</div>
        <div class="state-message">API 키를 설정해주세요</div>
        <a class="btn-settings-link" id="open-settings">설정 열기</a>
      `;
    } else if (code === 'EMPTY') {
      screen.innerHTML = `
        <div class="state-icon">📝</div>
        <div class="state-message">${_escapeHtml(message)}</div>
      `;
    } else if (code === 'NOT_KOREAN') {
      screen.innerHTML = `
        <div class="state-icon">🇰🇷</div>
        <div class="state-message">${_escapeHtml(message)}</div>
      `;
    } else if (code === 'CONTEXT_INVALID') {
      screen.innerHTML = `
        <div class="state-icon">🔄</div>
        <div class="state-message">${_escapeHtml(message)}</div>
      `;
    } else {
      screen.innerHTML = `
        <div class="state-icon">⚠️</div>
        <div class="state-message">${_escapeHtml(message || '검토 서비스를 사용할 수 없습니다')}</div>
      `;
    }
    body.appendChild(screen);
    state.container.appendChild(body);

    const footer = document.createElement('div');
    footer.className = 'modal-footer';

    const left = document.createElement('div');
    left.className = 'footer-left';

    if (code !== 'NO_API_KEY' && code !== 'EMPTY' && code !== 'NOT_KOREAN' && code !== 'CONTEXT_INVALID') {
      const retryBtn = document.createElement('button');
      retryBtn.className = 'btn-retry';
      retryBtn.textContent = '다시 시도';
      retryBtn.addEventListener('click', () => {
        destroy(state);
        if (state.callbacks && state.callbacks.onRetry) state.callbacks.onRetry();
      });
      left.appendChild(retryBtn);
    }

    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn-retry';
    closeBtn.textContent = '닫기';
    closeBtn.addEventListener('click', () => destroy(state));
    left.appendChild(closeBtn);

    footer.appendChild(left);
    state.container.appendChild(footer);

    const settingsLink = body.querySelector('#open-settings');
    if (settingsLink) {
      settingsLink.addEventListener('click', (e) => {
        e.preventDefault();
        if (_isContextValid()) chrome.runtime.openOptionsPage?.();
        destroy(state);
      });
    }
  }

  function _showNoIssues(state) {
    state.container.innerHTML = '';

    const header = _buildHeader('검토 완료', state);
    state.container.appendChild(header);

    const body = document.createElement('div');
    body.className = 'modal-body';

    const screen = document.createElement('div');
    screen.className = 'state-screen';
    screen.innerHTML = `
      <div class="state-icon">✅</div>
      <div class="state-message">수정 사항이 없습니다.<br>잘 작성된 이메일입니다!</div>
    `;
    body.appendChild(screen);
    state.container.appendChild(body);

    const footer = document.createElement('div');
    footer.className = 'modal-footer';
    const left = document.createElement('div');
    left.className = 'footer-left';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn-apply-all';
    closeBtn.textContent = '닫기';
    closeBtn.addEventListener('click', () => destroy(state));
    left.appendChild(closeBtn);
    footer.appendChild(left);
    state.container.appendChild(footer);
  }

  // --- Builders ---

  function _buildHeader(titleText, state) {
    const header = document.createElement('div');
    header.className = 'modal-header';

    const title = document.createElement('div');
    title.className = 'modal-title';
    title.textContent = titleText;
    header.appendChild(title);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'close-btn';
    closeBtn.setAttribute('aria-label', '닫기');
    closeBtn.innerHTML = '&#10005;';
    closeBtn.addEventListener('click', () => destroy(state));
    header.appendChild(closeBtn);

    return header;
  }

  function _buildChangeItem(issue) {
    const item = document.createElement('li');
    item.className = 'change-item';

    const categoryInfo = EmailReviewPrompts ? EmailReviewPrompts.getCategoryInfo(issue.category) : null;
    const catName = CATEGORY_NAMES[issue.category] || issue.category;
    const catBg = categoryInfo ? categoryInfo.color.bg : '#f1f3f4';
    const catText = categoryInfo ? categoryInfo.color.text : '#5f6368';

    const pill = document.createElement('span');
    pill.className = 'change-category';
    pill.style.backgroundColor = catBg;
    pill.style.color = catText;
    pill.textContent = catName;
    item.appendChild(pill);

    const detail = document.createElement('div');
    detail.className = 'change-detail';

    const textLine = document.createElement('div');
    textLine.className = 'change-text';
    textLine.innerHTML = `${_escapeHtml(issue.original)}<span class="arrow">&rarr;</span>${_escapeHtml(issue.corrected)}`;
    detail.appendChild(textLine);

    if (issue.explanation) {
      const explanation = document.createElement('div');
      explanation.className = 'change-explanation';
      explanation.textContent = issue.explanation;
      detail.appendChild(explanation);
    }

    item.appendChild(detail);
    return item;
  }

  function _buildFooter(state, totalIssues) {
    const footer = document.createElement('div');
    footer.className = 'modal-footer';

    const left = document.createElement('div');
    left.className = 'footer-left';

    const applyBtn = document.createElement('button');
    applyBtn.className = 'btn-apply-all';
    applyBtn.textContent = `반영하기 (${totalIssues}건 수정)`;
    applyBtn.addEventListener('click', () => {
      if (state.callbacks && state.callbacks.onApplyAll && state.correctedBody) {
        state.callbacks.onApplyAll(state.correctedBody);
      }
      if (_isContextValid()) {
        for (const issue of state.issues) {
          chrome.runtime.sendMessage({
            type: 'logUsageEvent',
            event: { event_type: 'issue_applied', category: issue.category },
          });
        }
      }
      destroy(state);
    });
    left.appendChild(applyBtn);

    const retryBtn = document.createElement('button');
    retryBtn.className = 'btn-retry';
    retryBtn.textContent = '다시 검토';
    retryBtn.addEventListener('click', () => {
      destroy(state);
      if (state.callbacks && state.callbacks.onRetry) state.callbacks.onRetry();
    });
    left.appendChild(retryBtn);

    footer.appendChild(left);

    const status = document.createElement('span');
    status.className = 'footer-status';
    status.textContent = `${totalIssues}건 수정`;
    footer.appendChild(status);

    return footer;
  }

  // --- Insight Card ---

  async function _loadInsight(state) {
    if (!_isContextValid()) return;
    try {
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'getTopCategories' }, resolve);
      });

      if (!response || !response.topCategories || response.topCategories.length === 0) return;

      const totalReviews = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'getReviewHistory' }, (res) => {
          resolve(res?.history?.length || 0);
        });
      });

      if (totalReviews < 5) return;

      const insightText = response.topCategories
        .map(c => `${CATEGORY_NAMES[c.category] || c.category}(${c.count})`)
        .join(', ');

      const card = document.createElement('div');
      card.className = 'insight-card';
      card.innerHTML = `
        <span class="insight-icon">💡</span>
        <span class="insight-text"><strong>자주 하는 실수:</strong> ${insightText}</span>
      `;

      const body = state.container.querySelector('.modal-body');
      if (body) body.appendChild(card);
    } catch (e) {
      // silently skip insight
    }
  }

  // --- Highlight ---

  function _highlightCorrections(bodyText, issues) {
    let html = _escapeHtml(bodyText);
    const sortedIssues = [...issues]
      .filter(i => i.corrected)
      .sort((a, b) => b.corrected.length - a.corrected.length);

    for (const issue of sortedIssues) {
      const escaped = _escapeHtml(issue.corrected);
      const idx = html.indexOf(escaped);
      if (idx !== -1) {
        html = html.substring(0, idx)
          + `<mark class="highlight">${escaped}</mark>`
          + html.substring(idx + escaped.length);
      }
    }
    return html;
  }

  function _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  return {
    create,
    destroy,
    destroyAll,
    showLoading,
    showStreaming,
    showComplete,
    showError,
  };
})();
