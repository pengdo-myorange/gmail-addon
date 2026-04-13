/**
 * email-extractor.js — compose 본문 추출
 */

const EmailExtractor = (() => {

  function extractText(composeBody) {
    if (!composeBody) return '';
    return _walkNodes(composeBody).trim();
  }

  function _walkNodes(node) {
    let text = '';
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        text += child.textContent;
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const tag = child.tagName.toLowerCase();
        if (tag === 'br') {
          text += '\n';
        } else if (tag === 'div' || tag === 'p' || tag === 'blockquote') {
          const inner = _walkNodes(child);
          if (inner) {
            if (text && !text.endsWith('\n')) text += '\n';
            text += inner;
          }
        } else if (tag === 'a') {
          text += child.textContent;
        } else if (tag === 'img') {
          // skip images
        } else {
          text += _walkNodes(child);
        }
      }
    }
    return text;
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
    extractHtml,
    isKorean,
    getCharCount,
  };
})();
