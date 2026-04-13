/**
 * content.js — 오케스트레이터
 * MutationObserver, [검토하기] 버튼 주입, WeakMap 상태 관리
 * v1.1: 모달 패널, 전체 반영, 오렌지 디자인
 */

(() => {
  const REVIEW_BTN_ATTR = 'data-email-review-btn';
  const DEBOUNCE_MS = 200;
  const POLL_INTERVAL_MS = 1500;

  const composeStates = new WeakMap();
  const processedBodies = new WeakSet();

  let debounceTimer = null;
  let pollTimer = null;

  function _isContextValid() {
    try {
      return typeof chrome !== 'undefined' && !!chrome.runtime && !!chrome.runtime.id;
    } catch (e) {
      return false;
    }
  }

  function init() {
    console.log('[보내기 전에] 초기화 시작');
    observeDOM();
    scanForComposeWindows();
    startPolling();
  }

  function observeDOM() {
    const observer = new MutationObserver(() => {
      if (!_isContextValid()) {
        observer.disconnect();
        return;
      }
      if (debounceTimer) return;
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        scanForComposeWindows();
      }, DEBOUNCE_MS);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  function startPolling() {
    pollTimer = setInterval(() => {
      if (!_isContextValid()) {
        clearInterval(pollTimer);
        console.log('[보내기 전에] 확장기능 컨텍스트 무효화 — 폴링 중지');
        return;
      }
      scanForComposeWindows();
    }, POLL_INTERVAL_MS);
  }

  function scanForComposeWindows() {
    const bodies = GmailSelectors.findAllComposeBodies();

    for (const body of bodies) {
      if (processedBodies.has(body)) continue;

      const container = GmailSelectors.findComposeContainer(body);
      if (!container) continue;

      if (container.querySelector(`[${REVIEW_BTN_ATTR}]`)) {
        processedBodies.add(body);
        continue;
      }

      const sendBtn = GmailSelectors.findSendButton(container);
      if (!sendBtn) continue;

      processedBodies.add(body);
      injectReviewButton(container, sendBtn);
      console.log('[보내기 전에] 검토하기 버튼 주입 완료');
    }
  }

  function injectReviewButton(composeContainer, sendBtn) {
    const reviewBtn = document.createElement('div');
    reviewBtn.setAttribute(REVIEW_BTN_ATTR, 'true');
    reviewBtn.setAttribute('role', 'button');
    reviewBtn.setAttribute('tabindex', '0');
    reviewBtn.setAttribute('aria-label', '이메일 검토하기');
    reviewBtn.textContent = '검토하기';

    Object.assign(reviewBtn.style, {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '36px',
      padding: '0 16px',
      marginLeft: '8px',
      borderRadius: '18px',
      border: '1px solid #FF6B2C',
      backgroundColor: '#ffffff',
      color: '#FF6B2C',
      fontSize: '14px',
      fontWeight: '500',
      fontFamily: 'Pretendard, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif',
      cursor: 'pointer',
      userSelect: 'none',
      letterSpacing: '-0.01em',
      lineHeight: '1',
      transition: 'background-color 100ms',
      verticalAlign: 'middle',
      position: 'relative',
      zIndex: '1',
    });

    reviewBtn.addEventListener('mouseenter', () => {
      reviewBtn.style.backgroundColor = '#FFF3E0';
    });
    reviewBtn.addEventListener('mouseleave', () => {
      reviewBtn.style.backgroundColor = '#ffffff';
    });
    reviewBtn.addEventListener('mousedown', () => {
      reviewBtn.style.transform = 'scale(0.98)';
    });
    reviewBtn.addEventListener('mouseup', () => {
      reviewBtn.style.transform = '';
    });

    reviewBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      startReview(composeContainer);
    });
    reviewBtn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        startReview(composeContainer);
      }
    });

    const toolbar = GmailSelectors.findSendButtonToolbar(sendBtn);
    if (toolbar) {
      const computedDisplay = window.getComputedStyle(toolbar).display;
      if (!computedDisplay.includes('flex')) {
        toolbar.style.display = 'flex';
        toolbar.style.alignItems = 'center';
      }
      toolbar.appendChild(reviewBtn);
    } else {
      sendBtn.parentElement.appendChild(reviewBtn);
    }
  }

  function startReview(composeContainer) {
    const composeBody = GmailSelectors.findComposeBody(composeContainer);
    if (!composeBody) {
      console.warn('[보내기 전에] 작성 본문을 찾을 수 없습니다.');
      return;
    }

    const emailText = EmailExtractor.extractText(composeBody);
    const recipients = GmailSelectors.findRecipients(composeContainer);
    const quotedContext = EmailExtractor.extractQuotedContext(composeBody);

    const panelCallbacks = {
      onApplyAll: (correctedBody) => {
        TextReplacer.replaceEntireBody(composeBody, correctedBody);
      },
      onApplySelected: (selectedIssues) => {
        TextReplacer.applyAllCorrections(composeBody, selectedIssues);
      },
      onRetry: () => startReview(composeContainer),
    };

    const panelState = ReviewPanel.create(panelCallbacks);
    if (!panelState) {
      console.warn('[보내기 전에] 확장기능 컨텍스트가 무효화되었습니다. 페이지를 새로고침해주세요.');
      return;
    }
    composeStates.set(composeContainer, { panelState, composeBody });

    if (!emailText || emailText.trim().length === 0) {
      ReviewPanel.showError(panelState, 'EMPTY', '이메일 본문이 비어있습니다.');
      return;
    }

    if (!EmailExtractor.isKorean(emailText)) {
      ReviewPanel.showError(panelState, 'NOT_KOREAN', '한국어 이메일만 검토할 수 있습니다.');
      return;
    }

    ReviewPanel.showLoading(panelState);

    if (!_isContextValid()) {
      ReviewPanel.showError(panelState, 'CONTEXT_INVALID', '확장기능이 업데이트되었습니다. 페이지를 새로고침해주세요.');
      return;
    }

    let port;
    try {
      port = chrome.runtime.connect({ name: 'review' });
    } catch (e) {
      ReviewPanel.showError(panelState, 'CONTEXT_INVALID', '확장기능이 업데이트되었습니다. 페이지를 새로고침해주세요.');
      return;
    }

    port.onMessage.addListener((msg) => {
      switch (msg.type) {
        case 'status':
          if (msg.status === 'loading') {
            ReviewPanel.showLoading(panelState);
          }
          break;

        case 'streamingCount':
          ReviewPanel.showStreaming(panelState, msg.count);
          break;

        case 'complete':
          ReviewPanel.showComplete(
            panelState,
            msg.correctedBody,
            msg.issues,
            msg.totalIssues
          );
          break;

        case 'error':
          ReviewPanel.showError(panelState, msg.code, msg.message);
          break;
      }
    });

    port.onDisconnect.addListener(() => {
      let err;
      try { err = chrome.runtime?.lastError; } catch { err = null; }
      const valid = _isContextValid();
      if (err || !valid) {
        const msg = !valid
          ? '확장기능이 업데이트되었습니다. 페이지를 새로고침해주세요.'
          : '연결이 끊어졌습니다. 다시 시도해주세요.';
        const code = !valid ? 'CONTEXT_INVALID' : 'DISCONNECT';
        ReviewPanel.showError(panelState, code, msg);
      }
    });

    const message = { type: 'startReview', emailBody: emailText };
    if (recipients.length > 0) {
      message.recipients = recipients.map(r => ({ name: r.name, email: r.email, type: r.type }));
    }
    if (quotedContext) {
      message.quotedContext = quotedContext;
    }
    port.postMessage(message);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
