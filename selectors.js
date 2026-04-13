/**
 * selectors.js — Gmail DOM 셀렉터 중앙 관리
 * ARIA 속성 우선, data 속성 보조, class는 최후 수단
 */

const GmailSelectors = (() => {
  const VERSION = '1.0.0';

  const SELECTORS = {
    composeContainer: {
      selector: 'div[role="dialog"][aria-label]',
      description: '작성 창 컨테이너 (인라인/팝업)',
      critical: true,
    },
    composeBody: {
      selector: 'div[role="textbox"][aria-label][contenteditable="true"]',
      description: '작성 본문 (contentEditable)',
      critical: true,
    },
    sendButton: {
      selector: 'div[role="dialog"] div[role="button"][aria-label*="보내기"], div[role="dialog"] div[role="button"][aria-label*="Send"]',
      description: '보내기 버튼',
      critical: true,
    },
    sendButtonToolbar: {
      selector: 'div[role="dialog"] table[role="group"] td',
      description: '보내기 버튼이 위치한 toolbar 영역',
      critical: false,
    },
    composeToolbarRow: {
      selector: 'div[role="dialog"] tr.btC',
      description: '작성 창 하단 toolbar row',
      critical: false,
    },
    subjectField: {
      selector: 'div[role="dialog"] input[name="subjectbox"]',
      description: '제목 입력란',
      critical: false,
    },
    recipientField: {
      selector: 'div[role="dialog"] div[role="combobox"] input, div[role="dialog"] input[aria-label*="받는사람"], div[role="dialog"] input[aria-label*="To"]',
      description: '수신자 입력란',
      critical: false,
    },
  };

  function query(name, root = document) {
    const entry = SELECTORS[name];
    if (!entry) return null;
    return root.querySelector(entry.selector);
  }

  function queryAll(name, root = document) {
    const entry = SELECTORS[name];
    if (!entry) return [];
    return Array.from(root.querySelectorAll(entry.selector));
  }

  function findComposeContainers() {
    return queryAll('composeContainer');
  }

  function findComposeBody(composeContainer) {
    return query('composeBody', composeContainer);
  }

  function findSendButton(composeContainer) {
    return query('sendButton', composeContainer);
  }

  function findSendButtonToolbar(composeContainer) {
    return query('sendButtonToolbar', composeContainer);
  }

  function selfTest() {
    const results = [];
    let allCriticalPassed = true;

    for (const [name, entry] of Object.entries(SELECTORS)) {
      const el = document.querySelector(entry.selector);
      const found = !!el;
      results.push({ name, found, critical: entry.critical, description: entry.description });
      if (entry.critical && !found) {
        allCriticalPassed = false;
      }
    }

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
    SELECTORS,
    query,
    queryAll,
    findComposeContainers,
    findComposeBody,
    findSendButton,
    findSendButtonToolbar,
    selfTest,
    runSelfTestWithRetry,
  };
})();
