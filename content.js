/**
 * content.js — 오케스트레이터
 * MutationObserver, [검토하기] 버튼 주입, WeakMap 상태 관리
 * v1.1: 모달 패널, 부분 반영(서식 보존), 오렌지 디자인
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

  function startReview(composeContainer, _retryCount = 0) {
    const composeBody = GmailSelectors.findComposeBody(composeContainer);
    if (!composeBody) {
      console.warn('[보내기 전에] 작성 본문을 찾을 수 없습니다.');
      return;
    }

    const emailText = EmailExtractor.extractText(composeBody);

    if ((!emailText || emailText.trim().length === 0) && _retryCount < 3) {
      setTimeout(() => startReview(composeContainer, _retryCount + 1), 300);
      return;
    }

    const recipients = GmailSelectors.findRecipients(composeContainer);
    const quotedContext = EmailExtractor.extractQuotedContext(composeBody);

    const panelCallbacks = {
      onApplySelected: (selectedIssues) => {
        const snapshot = _createBodySnapshot(composeBody);
        const { applied, failed } = TextReplacer.applyAllCorrections(composeBody, selectedIssues);

        // 서명/인용 블록이 변경됐다면 전체 롤백 (방어적 안전장치)
        const violated = _verifyProtectedBlocks(composeBody, snapshot);
        if (violated) {
          _restoreBodySnapshot(composeBody, snapshot);
          _showApplyResultToast(0, selectedIssues.length, null, null, {
            reason: 'protected_violation',
          });
          return;
        }

        _showApplyResultToast(applied, failed, composeBody, snapshot);
      },
      onApplySingle: (issue) => {
        const snapshot = _createBodySnapshot(composeBody);
        const ok = TextReplacer.applyCorrection(composeBody, issue.original, issue.corrected);

        const violated = _verifyProtectedBlocks(composeBody, snapshot);
        if (violated) {
          _restoreBodySnapshot(composeBody, snapshot);
          _showApplyResultToast(0, 1, null, null, { reason: 'protected_violation' });
          return false;
        }

        if (ok) {
          _showApplyResultToast(1, 0, composeBody, snapshot);
          if (_isContextValid()) {
            try {
              chrome.runtime.sendMessage({
                type: 'logUsageEvent',
                event: { event_type: 'issue_applied', category: issue.category },
              });
            } catch {}
          }
        } else {
          _showApplyResultToast(0, 1);
        }
        return ok;
      },
      onRetry: () => startReview(composeContainer),
    };

    const panelState = ReviewPanel.create(panelCallbacks);
    if (!panelState) {
      _showRefreshNotice();
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

  // --- 본문 스냅샷 (Undo + 자동 롤백용) ---

  const PROTECTED_SELECTORS = [
    'div[data-smartmail="gmail_signature"]',
    'div.gmail_signature',
    'div.gmail_signature_prefix',
    '.gmail_quote',
    'blockquote[class*="gmail"]',
    'div.gmail_quote',
  ];

  function _createBodySnapshot(composeBody) {
    if (!composeBody) return null;
    const protectedBlocks = [];
    for (const sel of PROTECTED_SELECTORS) {
      composeBody.querySelectorAll(sel).forEach(el => {
        protectedBlocks.push(el.outerHTML);
      });
    }
    return {
      innerHTML: composeBody.innerHTML,
      protectedBlocks: protectedBlocks.join('\n'),
      timestamp: Date.now(),
    };
  }

  function _restoreBodySnapshot(composeBody, snapshot) {
    if (!composeBody || !snapshot) return;
    try {
      composeBody.innerHTML = snapshot.innerHTML;
      composeBody.dispatchEvent(new Event('input', { bubbles: true }));
    } catch (e) { /* noop */ }
  }

  function _verifyProtectedBlocks(composeBody, snapshot) {
    if (!composeBody || !snapshot) return false;
    const current = [];
    for (const sel of PROTECTED_SELECTORS) {
      composeBody.querySelectorAll(sel).forEach(el => {
        current.push(el.outerHTML);
      });
    }
    return current.join('\n') !== snapshot.protectedBlocks;
  }

  function _showApplyResultToast(applied, failed, composeBody, snapshot, opts = {}) {
    const existing = document.getElementById('beforesend-apply-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'beforesend-apply-toast';

    let message;
    let showUndo = false;
    if (opts.reason === 'protected_violation') {
      message = '서명·인용부가 영향을 받을 뻔해서 자동으로 되돌렸습니다.';
    } else if (failed > 0) {
      message = applied > 0
        ? `수정 ${applied}건 반영. ${failed}건은 본문에서 찾지 못했습니다.`
        : `적용 실패 (${failed}건). 원문과 제안이 일치하지 않을 수 있습니다.`;
      showUndo = applied > 0;
    } else {
      message = `수정 ${applied}건을 반영했습니다.`;
      showUndo = applied > 0;
    }

    Object.assign(toast.style, {
      position: 'fixed',
      bottom: '24px',
      left: '50%',
      transform: 'translateX(-50%)',
      background: '#202124',
      color: '#fff',
      padding: '10px 16px 10px 20px',
      borderRadius: '12px',
      fontSize: '14px',
      fontFamily: 'Pretendard, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif',
      zIndex: '999999',
      boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
      maxWidth: 'min(480px, calc(100vw - 32px))',
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
    });

    const text = document.createElement('span');
    text.textContent = message;
    text.style.flex = '1';
    text.style.lineHeight = '1.4';
    toast.appendChild(text);

    if (showUndo && composeBody && snapshot) {
      const undoBtn = document.createElement('button');
      Object.assign(undoBtn.style, {
        background: 'transparent',
        color: '#FFB088',
        border: '1px solid #FFB088',
        borderRadius: '8px',
        padding: '6px 12px',
        fontSize: '13px',
        fontWeight: '600',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        fontFamily: 'inherit',
        transition: 'background-color 100ms, color 100ms',
      });
      undoBtn.textContent = '되돌리기';
      undoBtn.addEventListener('mouseenter', () => {
        undoBtn.style.background = '#FFB088';
        undoBtn.style.color = '#202124';
      });
      undoBtn.addEventListener('mouseleave', () => {
        undoBtn.style.background = 'transparent';
        undoBtn.style.color = '#FFB088';
      });
      undoBtn.addEventListener('click', () => {
        _restoreBodySnapshot(composeBody, snapshot);
        toast.remove();
        _showUndoneToast();
      });
      toast.appendChild(undoBtn);
    }

    document.body.appendChild(toast);
    // 되돌리기 가능 토스트는 좀 더 오래 표시
    const lifetime = showUndo ? 7000 : 4500;
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, lifetime);
  }

  function _showUndoneToast() {
    const existing = document.getElementById('beforesend-apply-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'beforesend-apply-toast';
    Object.assign(toast.style, {
      position: 'fixed',
      bottom: '24px',
      left: '50%',
      transform: 'translateX(-50%)',
      background: '#202124',
      color: '#fff',
      padding: '12px 24px',
      borderRadius: '12px',
      fontSize: '14px',
      fontFamily: 'Pretendard, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif',
      zIndex: '999999',
      boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
      maxWidth: 'min(420px, calc(100vw - 32px))',
      textAlign: 'center',
    });
    toast.textContent = '수정을 되돌렸습니다.';
    document.body.appendChild(toast);
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 2500);
  }

  function _showRefreshNotice() {
    const existing = document.getElementById('beforesend-refresh-notice');
    if (existing) existing.remove();

    const notice = document.createElement('div');
    notice.id = 'beforesend-refresh-notice';
    Object.assign(notice.style, {
      position: 'fixed',
      bottom: '24px',
      left: '50%',
      transform: 'translateX(-50%)',
      background: '#202124',
      color: '#fff',
      padding: '12px 24px',
      borderRadius: '12px',
      fontSize: '14px',
      fontFamily: 'Pretendard, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif',
      zIndex: '999999',
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
      animation: 'none',
    });

    const text = document.createElement('span');
    text.textContent = '확장기능이 업데이트되었습니다.';

    const btn = document.createElement('button');
    Object.assign(btn.style, {
      background: '#FF6B2C',
      color: '#fff',
      border: 'none',
      borderRadius: '8px',
      padding: '6px 14px',
      fontSize: '13px',
      fontWeight: '500',
      cursor: 'pointer',
      whiteSpace: 'nowrap',
    });
    btn.textContent = '새로고침';
    btn.addEventListener('click', () => location.reload());

    notice.appendChild(text);
    notice.appendChild(btn);
    document.body.appendChild(notice);

    setTimeout(() => { if (notice.parentNode) notice.remove(); }, 10000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
