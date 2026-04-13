/**
 * content.js — 오케스트레이터
 * MutationObserver, [검토하기] 버튼 주입, WeakMap 상태 관리
 * Bottom-up: compose body를 찾아서 컨테이너/버튼을 파생
 */

(() => {
  const REVIEW_BTN_ATTR = 'data-email-review-btn';
  const DEBOUNCE_MS = 200;
  const POLL_INTERVAL_MS = 1500;

  const composeStates = new WeakMap();
  const processedBodies = new WeakSet();

  let debounceTimer = null;

  function init() {
    console.log('[이메일 검토 도우미] 초기화 시작');
    observeDOM();
    scanForComposeWindows();
    startPolling();
  }

  function observeDOM() {
    const observer = new MutationObserver(() => {
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
    setInterval(() => {
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
      console.log('[이메일 검토 도우미] 검토하기 버튼 주입 완료');
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
      border: '1px solid #1a73e8',
      backgroundColor: '#ffffff',
      color: '#1a73e8',
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
      reviewBtn.style.backgroundColor = '#e8f0fe';
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
    const existingState = composeStates.get(composeContainer);
    if (existingState && existingState.panelState) {
      ReviewPanel.destroy(existingState.panelState);
    }

    const composeBody = GmailSelectors.findComposeBody(composeContainer);
    if (!composeBody) {
      console.warn('[이메일 검토 도우미] 작성 본문을 찾을 수 없습니다.');
      return;
    }

    const emailText = EmailExtractor.extractText(composeBody);
    if (!emailText || emailText.trim().length === 0) {
      const panelState = ReviewPanel.create(composeContainer, {});
      ReviewPanel.showError(panelState, 'EMPTY', '이메일 본문이 비어있습니다.');
      composeStates.set(composeContainer, { panelState });
      return;
    }

    if (!EmailExtractor.isKorean(emailText)) {
      const panelState = ReviewPanel.create(composeContainer, {});
      ReviewPanel.showError(panelState, 'NOT_KOREAN', '한국어 이메일만 검토할 수 있습니다.');
      composeStates.set(composeContainer, { panelState });
      return;
    }

    const panelCallbacks = {
      onApply: (issue) => {
        TextReplacer.applyCorrection(composeBody, issue.original, issue.corrected);
      },
      onIgnore: () => {},
      onApplyAll: (issues) => {
        TextReplacer.applyAllCorrections(composeBody, issues);
      },
      onRetry: () => startReview(composeContainer),
    };

    const panelState = ReviewPanel.create(composeContainer, panelCallbacks);
    composeStates.set(composeContainer, { panelState, composeBody });

    const port = chrome.runtime.connect({ name: 'review' });

    port.onMessage.addListener((msg) => {
      switch (msg.type) {
        case 'status':
          if (msg.status === 'loading') {
            ReviewPanel.showLoading(panelState);
          } else if (msg.status === 'streaming') {
            ReviewPanel.showStreaming(panelState);
          }
          break;

        case 'issue':
          if (panelState.panel.querySelector('.skeleton-card')) {
            ReviewPanel.showStreaming(panelState);
          }
          ReviewPanel.addStreamingIssue(panelState, msg.issue);
          break;

        case 'complete':
          ReviewPanel.showComplete(panelState, msg.totalIssues);
          break;

        case 'error':
          ReviewPanel.showError(panelState, msg.code, msg.message);
          break;
      }
    });

    port.onDisconnect.addListener(() => {
      if (chrome.runtime.lastError) {
        ReviewPanel.showError(panelState, 'DISCONNECT', '연결이 끊어졌습니다. 다시 시도해주세요.');
      }
    });

    port.postMessage({ type: 'startReview', emailBody: emailText });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
