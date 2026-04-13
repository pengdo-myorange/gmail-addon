/**
 * email-extractor.js — compose 본문 추출
 * extractText: 사용자가 새로 작성한 본문만 추출 (인용 원본 제외)
 * extractQuotedContext: 답장/전달 시 원본 메일에서 호칭 관련 컨텍스트 추출
 */

const EmailExtractor = (() => {

  const QUOTE_SELECTORS = [
    '.gmail_quote',
    'blockquote[class*="gmail"]',
    'div.gmail_quote',
  ];

  function extractText(composeBody) {
    if (!composeBody) return '';
    return _walkNodes(composeBody, true).trim();
  }

  function _walkNodes(node, skipQuote) {
    let text = '';
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        text += child.textContent;
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const tag = child.tagName.toLowerCase();

        if (skipQuote && _isQuotedBlock(child)) continue;

        if (tag === 'br') {
          text += '\n';
        } else if (tag === 'div' || tag === 'p' || tag === 'blockquote') {
          const inner = _walkNodes(child, skipQuote);
          if (inner) {
            if (text && !text.endsWith('\n')) text += '\n';
            text += inner;
          }
        } else if (tag === 'a') {
          text += child.textContent;
        } else if (tag === 'img') {
          // skip images
        } else {
          text += _walkNodes(child, skipQuote);
        }
      }
    }
    return text;
  }

  function _isQuotedBlock(el) {
    if (el.classList && el.classList.contains('gmail_quote')) return true;
    if (el.tagName === 'BLOCKQUOTE') return true;
    for (const sel of QUOTE_SELECTORS) {
      if (el.matches && el.matches(sel)) return true;
    }
    return false;
  }

  function extractQuotedContext(composeBody) {
    if (!composeBody) return null;

    let quoteEl = null;
    for (const sel of QUOTE_SELECTORS) {
      quoteEl = composeBody.querySelector(sel);
      if (quoteEl) break;
    }
    if (!quoteEl) {
      quoteEl = composeBody.querySelector('blockquote');
    }
    if (!quoteEl) return null;

    const fullText = _walkNodes(quoteEl, false).trim();
    if (!fullText) return null;

    const lines = fullText.split('\n').filter(l => l.trim());
    if (lines.length === 0) return null;

    const header = _extractQuoteHeader(lines);
    const opening = lines.slice(header.length, header.length + 3).join('\n');
    const signature = _extractSignature(lines);

    return {
      header: header.join('\n') || null,
      opening: opening || null,
      signature: signature || null,
    };
  }

  const HEADER_PATTERNS = [
    /^20\d{2}[년.\-\/]/,
    /^On .+ wrote:$/,
    /보낸사람|발신자|From:|받는사람|수신자|To:|날짜|Date:|참조|Cc:/i,
    /^\d{4}\/\d{1,2}\/\d{1,2}/,
    /작성:/,
    /wrote:$/,
  ];

  function _extractQuoteHeader(lines) {
    const header = [];
    for (let i = 0; i < Math.min(lines.length, 5); i++) {
      const line = lines[i].trim();
      if (HEADER_PATTERNS.some(p => p.test(line))) {
        header.push(line);
      } else if (header.length > 0) {
        break;
      } else if (i >= 2) {
        break;
      }
    }
    return header;
  }

  const SIGNATURE_PATTERNS = [
    /드림\s*$/,
    /올림\s*$/,
    /배상\s*$/,
    /拜上\s*$/,
    /감사합니다\s*\.?\s*$/,
    /^[-─—]{2,}/,
    /^(Sent from|보냄)/i,
    /^(Best|Kind)\s+(regards|wishes)/i,
    /^(Sincerely|Regards|Thanks)/i,
    /^(Tel|Phone|Mobile|HP|연락처|전화|팩스|Fax)[\s.:]/i,
  ];

  function _extractSignature(lines) {
    let sigStart = -1;

    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 8); i--) {
      const line = lines[i].trim();
      if (SIGNATURE_PATTERNS.some(p => p.test(line))) {
        sigStart = i;
      }
    }

    if (sigStart === -1) {
      const lastLines = lines.slice(-3);
      return lastLines.join('\n');
    }

    const sigLines = lines.slice(Math.max(0, sigStart - 1), Math.min(lines.length, sigStart + 5));
    return sigLines.join('\n');
  }

  function extractHtml(composeBody) {
    if (!composeBody) return '';
    return composeBody.innerHTML;
  }

  function isKorean(text) {
    if (!text) return false;
    const koreanChars = (text.match(/[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/g) || []).length;
    const totalChars = text.replace(/\s/g, '').length;
    if (totalChars === 0) return false;
    return (koreanChars / totalChars) >= 0.3;
  }

  function getCharCount(text) {
    return text ? text.length : 0;
  }

  return {
    extractText,
    extractQuotedContext,
    extractHtml,
    isKorean,
    getCharCount,
  };
})();
