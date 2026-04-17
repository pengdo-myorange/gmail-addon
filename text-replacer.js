/**
 * text-replacer.js — compose 본문의 부분 교체 (서식/링크/서명 보존)
 *
 * Strategy:
 *   1) email-extractor와 동일한 walker로 "가상 버퍼 + 앵커 맵" 구축
 *      (텍스트 노드, <br>, 블록 경계를 \n으로 합성해 LLM이 본 텍스트와 일치)
 *   2) issue.original 을 가상 버퍼에서 찾아 DOM Range로 매핑
 *   3) Range 선택 후 execCommand('insertText')로 교체
 *      — 주변의 <b>, <span style>, <a href>, <ul><li>, 글꼴/색상/크기 등은
 *        텍스트 노드를 감싸고 있을 뿐이므로 그대로 보존됨
 *   4) 실패 시 Range.deleteContents + DocumentFragment(텍스트+<br>) 삽입으로 폴백
 *   5) 서명/인용 블록은 walker에서 skip → 앵커에 포함되지 않아 절대 수정되지 않음
 */

const TextReplacer = (() => {

  const SKIP_SELECTORS = [
    'div[data-smartmail="gmail_signature"]',
    'div.gmail_signature',
    'div.gmail_signature_prefix',
    '.gmail_quote',
    'blockquote[class*="gmail"]',
    'div.gmail_quote',
  ];

  function applyCorrection(composeBody, original, corrected) {
    if (!composeBody || !original) return false;
    if (corrected === undefined || corrected === null) return false;
    if (original === corrected) return true;

    const map = _buildVirtualMap(composeBody);
    const idx = map.buffer.indexOf(original);
    if (idx === -1) return false;

    const range = _mapToRange(map, idx, idx + original.length);
    if (!range) return false;

    return _replaceRange(composeBody, range, corrected);
  }

  function applyAllCorrections(composeBody, corrections) {
    if (!composeBody || !corrections || corrections.length === 0) {
      return { applied: 0, failed: 0 };
    }

    // 뒤에서부터 적용해야 앞쪽 위치가 밀리지 않음.
    // DOM이 매번 변하므로 정렬은 1회 가상 버퍼 기준으로 근사.
    const initialMap = _buildVirtualMap(composeBody);
    const annotated = corrections.map(c => ({
      correction: c,
      idx: c && c.original ? initialMap.buffer.indexOf(c.original) : -1,
    })).sort((a, b) => b.idx - a.idx);

    let applied = 0;
    let failed = 0;
    for (const { correction } of annotated) {
      if (!correction) { failed++; continue; }
      const ok = applyCorrection(composeBody, correction.original, correction.corrected);
      if (ok) applied++;
      else failed++;
    }
    return { applied, failed };
  }

  // --- 가상 버퍼 + 앵커 맵 ---

  function _buildVirtualMap(root) {
    const parts = [];
    _walk(root, true, parts);

    let vPos = 0;
    for (const p of parts) {
      p.vStart = vPos;
      if (p.type === 'text') {
        vPos += p.text.length;
      } else {
        // 'br' | 'blockBreak' — 합성 \n 1글자
        vPos += 1;
      }
      p.vEnd = vPos;
    }

    let buffer = '';
    for (const p of parts) {
      buffer += (p.type === 'text') ? p.text : '\n';
    }

    return { buffer, anchors: parts };
  }

  function _walk(node, skipSpecial, parts) {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        const t = child.textContent;
        if (t.length > 0) {
          parts.push({ type: 'text', node: child, text: t });
        }
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      if (skipSpecial && _shouldSkip(child)) continue;

      const tag = child.tagName.toLowerCase();

      if (tag === 'br') {
        parts.push({ type: 'br', element: child });
      } else if (tag === 'div' || tag === 'p' || tag === 'blockquote') {
        const before = parts.length;
        _walk(child, skipSpecial, parts);
        if (parts.length > before) {
          // 자식이 뭔가를 추가한 경우에만 블록 경계 \n 합성
          // (email-extractor가 `if (inner) text += '\n'` 하는 것과 동일)
          const prev = before > 0 ? parts[before - 1] : null;
          const needsBreak = prev && prev.type !== 'br' && prev.type !== 'blockBreak';
          if (needsBreak) {
            parts.splice(before, 0, { type: 'blockBreak', element: child });
          }
        }
      } else if (tag === 'img') {
        // skip
      } else {
        // span/b/i/strong/em/a/font/li/ul/ol/... — 재귀
        _walk(child, skipSpecial, parts);
      }
    }
  }

  function _shouldSkip(el) {
    if (!el.matches) return false;
    for (const sel of SKIP_SELECTORS) {
      try {
        if (el.matches(sel)) return true;
      } catch (e) { /* invalid selector in old browsers — ignore */ }
    }
    return false;
  }

  // --- 가상 위치 → DOM Range ---

  function _mapToRange(map, vStart, vEnd) {
    if (vStart < 0 || vEnd > map.buffer.length || vStart >= vEnd) return null;

    const startAnchor = _findStartAnchor(map.anchors, vStart);
    const endAnchor = _findEndAnchor(map.anchors, vEnd);
    if (!startAnchor || !endAnchor) return null;

    try {
      const range = document.createRange();
      _setRangeStart(range, startAnchor, vStart);
      _setRangeEnd(range, endAnchor, vEnd);
      return range;
    } catch (e) {
      return null;
    }
  }

  // 시작 위치 p가 속한 앵커: a.vStart <= p < a.vEnd
  function _findStartAnchor(anchors, p) {
    for (const a of anchors) {
      if (p >= a.vStart && p < a.vEnd) return a;
    }
    return null;
  }

  // 끝 위치 p가 속한 앵커: a.vStart < p <= a.vEnd
  function _findEndAnchor(anchors, p) {
    for (const a of anchors) {
      if (p > a.vStart && p <= a.vEnd) return a;
    }
    return null;
  }

  function _setRangeStart(range, anchor, p) {
    if (anchor.type === 'text') {
      range.setStart(anchor.node, p - anchor.vStart);
    } else if (anchor.type === 'br') {
      // p === vStart: <br> 바로 앞 / p === vEnd: 이 케이스는 end에서만
      range.setStartBefore(anchor.element);
    } else { // blockBreak
      // p === vStart: 블록 앞(이전 형제 뒤) / p === vEnd: 블록 내부 offset 0
      if (p === anchor.vStart) {
        range.setStartBefore(anchor.element);
      } else {
        range.setStart(anchor.element, 0);
      }
    }
  }

  function _setRangeEnd(range, anchor, p) {
    if (anchor.type === 'text') {
      range.setEnd(anchor.node, p - anchor.vStart);
    } else if (anchor.type === 'br') {
      // p === vEnd: <br> 바로 뒤까지 포함 / p === vStart는 start에서만
      range.setEndAfter(anchor.element);
    } else { // blockBreak
      // p === vEnd: 블록 내부 offset 0까지(= 합성 \n 포함)
      // p === vStart: 블록 앞까지(= 합성 \n 미포함, 이전 내용 끝)
      if (p === anchor.vEnd) {
        range.setEnd(anchor.element, 0);
      } else {
        range.setEndBefore(anchor.element);
      }
    }
  }

  // --- 실제 교체 ---

  function _replaceRange(composeBody, range, corrected) {
    try {
      composeBody.focus();
    } catch (e) { /* detached — proceed anyway */ }

    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    // 1순위: execCommand('insertText')
    //   - Chrome contenteditable에서 \n을 적절한 <br>/블록 분리로 변환
    //   - 실행취소 스택 기록, 삽입 지점의 상속 서식 자동 적용
    try {
      if (document.execCommand('insertText', false, corrected)) {
        return true;
      }
    } catch (e) { /* fall through */ }

    // 2순위: Range.deleteContents + DocumentFragment 삽입
    try {
      range.deleteContents();
      if (corrected.length > 0) {
        range.insertNode(_textToFragment(corrected));
      }
      _dispatchInputEvent(composeBody);
      return true;
    } catch (e) {
      return false;
    }
  }

  function _textToFragment(text) {
    const frag = document.createDocumentFragment();
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].length > 0) {
        frag.appendChild(document.createTextNode(lines[i]));
      }
      if (i < lines.length - 1) {
        frag.appendChild(document.createElement('br'));
      }
    }
    return frag;
  }

  function _dispatchInputEvent(element) {
    try {
      element.dispatchEvent(new Event('input', { bubbles: true }));
    } catch (e) { /* noop */ }
  }

  return {
    applyCorrection,
    applyAllCorrections,
  };
})();
