/**
 * text-replacer.js — compose 본문 교체
 * Strategy: execCommand('insertText') 우선, innerHTML fallback
 */

const TextReplacer = (() => {

  function applyCorrection(composeBody, original, corrected) {
    if (!composeBody || !original || corrected === undefined) return false;

    const html = composeBody.innerHTML;
    const originalEscaped = _escapeForSearch(original);
    const textContent = composeBody.textContent || composeBody.innerText || '';

    if (textContent.includes(original)) {
      return _replaceViaTextNode(composeBody, original, corrected);
    }

    const htmlOriginal = _textToHtmlSearch(original);
    if (html.includes(htmlOriginal)) {
      return _replaceViaInnerHtml(composeBody, htmlOriginal, _textToHtml(corrected));
    }

    return _replaceViaFuzzy(composeBody, original, corrected);
  }

  function applyAllCorrections(composeBody, corrections) {
    if (!composeBody || !corrections || corrections.length === 0) return { applied: 0, failed: 0 };

    let applied = 0;
    let failed = 0;

    const sorted = [...corrections].sort((a, b) => {
      const aIdx = (composeBody.textContent || '').indexOf(a.original);
      const bIdx = (composeBody.textContent || '').indexOf(b.original);
      return bIdx - aIdx;
    });

    for (const correction of sorted) {
      const success = applyCorrection(composeBody, correction.original, correction.corrected);
      if (success) applied++;
      else failed++;
    }

    return { applied, failed };
  }

  function _replaceViaTextNode(composeBody, original, corrected) {
    const walker = document.createTreeWalker(composeBody, NodeFilter.SHOW_TEXT, null, false);
    let node;
    let buffer = '';
    const nodes = [];

    while ((node = walker.nextNode())) {
      nodes.push(node);
      buffer += node.textContent;
    }

    const startIdx = buffer.indexOf(original);
    if (startIdx === -1) return false;

    let charCount = 0;
    let startNode = null, startOffset = 0;
    let endNode = null, endOffset = 0;

    for (const n of nodes) {
      const len = n.textContent.length;
      if (!startNode && charCount + len > startIdx) {
        startNode = n;
        startOffset = startIdx - charCount;
      }
      if (!endNode && charCount + len >= startIdx + original.length) {
        endNode = n;
        endOffset = startIdx + original.length - charCount;
        break;
      }
      charCount += len;
    }

    if (!startNode || !endNode) return false;

    try {
      const range = document.createRange();
      range.setStart(startNode, startOffset);
      range.setEnd(endNode, endOffset);

      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);

      const success = document.execCommand('insertText', false, corrected);
      if (success) return true;
    } catch (e) {
      // execCommand failed, fall through to innerHTML
    }

    return _replaceViaInnerHtml(
      composeBody,
      _textToHtmlSearch(original),
      _textToHtml(corrected)
    );
  }

  function _replaceViaInnerHtml(composeBody, htmlOriginal, htmlCorrected) {
    const before = composeBody.innerHTML;
    const after = before.replace(htmlOriginal, htmlCorrected);
    if (before === after) return false;
    composeBody.innerHTML = after;
    _dispatchInputEvent(composeBody);
    return true;
  }

  function _replaceViaFuzzy(composeBody, original, corrected) {
    const normalizedOriginal = original.replace(/\s+/g, ' ').trim();
    const text = (composeBody.textContent || '').replace(/\s+/g, ' ');
    if (text.includes(normalizedOriginal)) {
      const html = composeBody.innerHTML;
      const regex = new RegExp(
        normalizedOriginal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s*(?:<[^>]*>)*\\s*'),
        ''
      );
      const match = html.match(regex);
      if (match) {
        composeBody.innerHTML = html.replace(match[0], _textToHtml(corrected));
        _dispatchInputEvent(composeBody);
        return true;
      }
    }
    return false;
  }

  function _textToHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
  }

  function _textToHtmlSearch(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function _escapeForSearch(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function _dispatchInputEvent(element) {
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function replaceEntireBody(composeBody, newText) {
    if (!composeBody || !newText) return false;

    composeBody.focus();

    try {
      document.execCommand('selectAll');
      const success = document.execCommand('insertText', false, newText);
      if (success) return true;
    } catch (e) {
      // execCommand failed
    }

    const htmlContent = newText
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
    composeBody.innerHTML = htmlContent;
    _dispatchInputEvent(composeBody);
    return true;
  }

  return {
    applyCorrection,
    applyAllCorrections,
    replaceEntireBody,
  };
})();
