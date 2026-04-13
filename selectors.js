/**
 * selectors.js — Gmail DOM 셀렉터 중앙 관리
 * Bottom-up 전략: compose body를 먼저 찾고 위로 올라가서 컨테이너/버튼 탐색
 */

const GmailSelectors = (() => {
  const VERSION = '1.1.0';

  const COMPOSE_BODY_SELECTORS = [
    'div[role="textbox"][contenteditable="true"][aria-label]',
    'div[role="textbox"][contenteditable="true"][g_editable="true"]',
    'div[contenteditable="true"][aria-label*="본문"]',
    'div[contenteditable="true"][aria-label*="Message Body"]',
    'div[contenteditable="true"][aria-label*="message body"]',
  ];

  const SEND_BUTTON_SELECTORS = [
    'div[role="button"][aria-label*="보내기"]',
    'div[role="button"][aria-label*="Send"]',
    'div[role="button"][data-tooltip*="보내기"]',
    'div[role="button"][data-tooltip*="Send"]',
    'div[role="button"][data-tooltip*="⌘Enter"]',
    'div[role="button"][data-tooltip*="Ctrl+Enter"]',
  ];

  function findAllComposeBodies() {
    for (const sel of COMPOSE_BODY_SELECTORS) {
      const elements = document.querySelectorAll(sel);
      if (elements.length > 0) {
        return Array.from(elements).filter(_isGmailComposeBody);
      }
    }
    return [];
  }

  function _isGmailComposeBody(el) {
    if (!el.isContentEditable) return false;
    const label = (el.getAttribute('aria-label') || '').toLowerCase();
    if (label.includes('search') || label.includes('검색')) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 100 && rect.height > 30;
  }

  function findComposeContainer(composeBody) {
    let el = composeBody;
    for (let i = 0; i < 20; i++) {
      el = el.parentElement;
      if (!el || el === document.body) return null;

      if (el.getAttribute('role') === 'dialog') return el;

      if (_hasSendButton(el) && _hasSubjectOrRecipient(el)) {
        return el;
      }
    }

    el = composeBody;
    for (let i = 0; i < 20; i++) {
      el = el.parentElement;
      if (!el || el === document.body) return null;
      if (_hasSendButton(el)) return el;
    }

    return null;
  }

  function _hasSendButton(container) {
    for (const sel of SEND_BUTTON_SELECTORS) {
      if (container.querySelector(sel)) return true;
    }
    return false;
  }

  function _hasSubjectOrRecipient(container) {
    return !!(
      container.querySelector('input[name="subjectbox"]') ||
      container.querySelector('input[name="to"]') ||
      container.querySelector('div[name="to"]') ||
      container.querySelector('input[aria-label*="받는"]') ||
      container.querySelector('input[aria-label*="To"]') ||
      container.querySelector('span[email]')
    );
  }

  function findSendButton(composeContainer) {
    for (const sel of SEND_BUTTON_SELECTORS) {
      const btn = composeContainer.querySelector(sel);
      if (btn) return btn;
    }
    return null;
  }

  function findComposeBody(composeContainer) {
    for (const sel of COMPOSE_BODY_SELECTORS) {
      const el = composeContainer.querySelector(sel);
      if (el) return el;
    }
    return composeContainer.querySelector('div[contenteditable="true"]');
  }

  function findSendButtonToolbar(sendButton) {
    if (!sendButton) return null;
    return sendButton.closest('td') || sendButton.closest('tr') || sendButton.parentElement;
  }

  function selfTest() {
    const bodies = findAllComposeBodies();
    const results = [
      { name: 'composeBodies', found: bodies.length > 0, critical: false, description: '작성 본문 탐지' },
    ];

    for (const body of bodies) {
      const container = findComposeContainer(body);
      results.push({ name: 'composeContainer', found: !!container, critical: true, description: '작성 창 컨테이너' });
      if (container) {
        const sendBtn = findSendButton(container);
        results.push({ name: 'sendButton', found: !!sendBtn, critical: true, description: '보내기 버튼' });
      }
    }

    const allCriticalPassed = !results.some(r => r.critical && !r.found);
    return { allCriticalPassed, results, version: VERSION };
  }

  function runSelfTestWithRetry(retries = 3, delay = 2000) {
    return new Promise((resolve) => {
      let attempt = 0;
      function tryTest() {
        attempt++;
        const result = selfTest();
        if (result.allCriticalPassed || attempt >= retries) {
          resolve(result);
          return;
        }
        setTimeout(tryTest, delay);
      }
      tryTest();
    });
  }

  return {
    VERSION,
    findAllComposeBodies,
    findComposeContainer,
    findComposeBody,
    findSendButton,
    findSendButtonToolbar,
    selfTest,
    runSelfTestWithRetry,
  };
})();
