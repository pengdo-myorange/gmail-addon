/**
 * content.js — 오케스트레이터
 * MutationObserver, [검토하기] 버튼 주입, WeakMap 상태 관리
 */

(() => {
  const REVIEW_BTN_ATTR = 'data-email-review-btn';
  const DEBOUNCE_MS = 200;

  const composeStates = new WeakMap();

  let debounceTimer = null;

  function init() {
    GmailSelectors.runSelfTestWithRetry(3, 2000).then((result) => {
      if (!result.allCriticalPassed) {
        console.warn('[이메일 검토 도우미] 셀렉터 self-test 실패:', result.results.filter(r => r.critical && !r.found));
        chrome.runtime.sendMessage({ type: 'selectorFailure' });
      }
    });

    observeDOM();
    scanForComposeWindows();
  }

  function observeDOM() {
    const observer = new MutationObserver((mutations) => {
      if (debounceTimer) return;
      debounceTimer = setTimeout(() => {
        debounceTimer = null;

        let hasRelevant = false;
        for (const mutation of mutations) {
          if (mutation.addedNodes.length > 0) {
            for (const node of mutation.addedNodes) {
              if (node.nodeType === Node.ELEMENT_NODE) {
                if (node.matches?.('[role="dialog"]') || node.querySelector?.('[role="dialog"]')) {
                  hasRelevant = true;
                  break;
                }
              }
            }
          }
          if (hasRelevant) break;
        }

        if (hasRelevant) {
          scanForComposeWindows();
        }
      }, DEBOUNCE_MS);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  function scanForComposeWindows() {
    const containers = GmailSelectors.findComposeContainers();
    for (const container of containers) {
      injectReviewButton(container);
    }
  }

  function injectReviewButton(composeContainer) {
    if (composeContainer.querySelector(`[${REVIEW_BTN_ATTR}]`)) return;

    const sendBtn = GmailSelectors.findSendButton(composeContainer);
    if (!sendBtn) return;

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

    reviewBtn.addEventListener('click', () => startReview(composeContainer));
    reviewBtn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        startReview(composeContainer);
      }
    });

    const sendBtnParent = sendBtn.closest('td') || sendBtn.parentElement;
    if (sendBtnParent) {
      sendBtnParent.style.display = 'flex';
      sendBtnParent.style.alignItems = 'center';
      sendBtnParent.appendChild(reviewBtn);
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
