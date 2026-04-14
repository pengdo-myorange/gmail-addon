/**
 * prompts.js — 7개 오류 카테고리 + Gemini 프롬프트 + JSON 스키마
 * v1.1: corrected_body 반환, 카테고리 필터링, 커스텀 규칙 지원
 */

const EmailReviewPrompts = (() => {

  const CATEGORIES = [
    { id: 'recipient_title', name: '수신자 호칭 오류', group: 'expression', color: { bg: '#e8f0fe', text: '#1967d2' } },
    { id: 'duplicate', name: '중복 표현', group: 'style', color: { bg: '#f3e8fd', text: '#8430ce' } },
    { id: 'spacing', name: '띄어쓰기 오류', group: 'grammar', color: { bg: '#fef7e0', text: '#e37400' } },
    { id: 'typo', name: '오타/맞춤법', group: 'grammar', color: { bg: '#fef7e0', text: '#e37400' } },
    { id: 'honorific', name: '경어체 불일치', group: 'style', color: { bg: '#f3e8fd', text: '#8430ce' } },
    { id: 'particle', name: '조사 오류', group: 'grammar', color: { bg: '#fef7e0', text: '#e37400' } },
    { id: 'paragraph', name: '문단 구분 오류', group: 'structure', color: { bg: '#e6f4ea', text: '#137333' } },
  ];

  const ALL_CATEGORY_IDS = CATEGORIES.map(c => c.id);

  const CATEGORY_MAP = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));

  const CATEGORY_DESCRIPTIONS = {
    recipient_title: '수신자 호칭 오류: 받는 사람 이름/직책 잘못 표기. 수신자 정보나 원본 메일 컨텍스트가 제공되면 본문의 호칭과 대조하여 불일치를 검출',
    duplicate: '중복 표현: 동일 인사말/맺음말 반복 (예: "감사합니다" 두 번)',
    spacing: '띄어쓰기 오류: 명백한 띄어쓰기 오류만 지적 (예: "할수있다" → "할 수 있다"). 붙여쓰기와 띄어쓰기가 모두 허용되는 단어는 지적하지 않음',
    typo: '오타/맞춤법: 단순 입력 실수, 맞춤법 오류',
    honorific: '경어체 불일치: 존대와 반말이 섞인 명백한 오류만 지적 (예: "~합니다"와 "~해라" 혼재). "~합니다"와 "~해요" 혼재는 허용',
    particle: '조사 오류: 잘못된 조사 사용 (예: "측정을 변경사항" → "측정에 변경사항")',
    paragraph: '문단 구분 오류: 연속 빈 줄(2줄 이상) 과다',
  };

  function buildSystemPrompt({ enabledCategories, customRules } = {}) {
    const activeCats = enabledCategories && enabledCategories.length > 0
      ? enabledCategories.filter(id => CATEGORY_MAP[id])
      : ALL_CATEGORY_IDS;

    const categoryList = activeCats
      .map((id, i) => `${i + 1}. ${id} (${CATEGORY_DESCRIPTIONS[id]})`)
      .join('\n');

    let prompt = `당신은 한국어 비즈니스 이메일 전문 검토자입니다.
사용자가 제출한 이메일 본문을 분석하여, 아래 카테고리에 해당하는 오류를 찾아 수정하세요.

## 검토 카테고리
${categoryList}

## 문단 구분 규칙 (매우 중요)
- 연속 빈 줄이 2줄 이상이면 1줄로 축소
- 의미가 달라지는 문단 사이에만 빈 줄(\\n\\n) 1개를 삽입
- 같은 문단 안의 문장들은 빈 줄 없이 줄바꿈(\\n)으로만 연결
- 절대로 모든 줄 사이에 빈 줄을 넣지 말 것

corrected_body의 줄바꿈 형식 예시:
"OOO님께,\\n안녕하세요?\\n\\n본문 첫째 문단 문장1\\n본문 첫째 문단 문장2\\n\\n본문 둘째 문단 문장1\\n본문 둘째 문단 문장2\\n본문 둘째 문단 문장3\\n\\n감사합니다.\\nOOO 드림"

위 예시에서 \\n은 줄바꿈, \\n\\n은 빈 줄(문단 구분)입니다. 같은 문단 내 문장 사이에는 \\n만 사용하세요.

## 수정하지 말 것 (금지 규칙)
- 호칭과 인사말이 바로 이어지는 경우(예: "OOO님께,\\n안녕하세요?") 사이에 빈 줄을 삽입하지 마세요. 호칭 뒤 줄바꿈 패턴은 원본 그대로 유지하세요.
- "OOO 드림", "OOO 올림" 등은 맺음말의 일부이지 별도 서명이 아닙니다. 앞에 빈 줄을 삽입하지 마세요.
- "드림"을 "올림"으로 바꾸지 마세요. 맺음 표현("드림", "올림", "배상" 등)은 작성자의 선택이므로 수정 대상이 아닙니다.
- 맺음말(예: "감사합니다.\\nOOO 드림")의 줄바꿈 패턴은 원본 그대로 유지하세요.
- 날짜, 기한, 일정, 숫자를 수정하지 마세요. 문맥상 불일치해 보여도 작성자의 의도이므로 변경하지 않습니다. 다른 카테고리(typo, spacing 등)로도 날짜를 수정하지 마세요.
- 경어체 불일치는 존대("~합니다", "~해요")와 반말("~해라", "~해")이 섞인 명백한 오류만 지적하세요. "~합니다"와 "~해요" 혼재, 정중한 우회 표현(예: "~될지요?", "~될까요?")은 수정 대상이 아닙니다.
- 이메일 하단의 서명(이름, 직책, 연락처, 회사명 등)은 수정하지 마세요. 서명은 검토 대상이 아닙니다.`;

    if (customRules && customRules.trim()) {
      prompt += `

## 사용자 지정 규칙
${customRules.trim()}`;
    }

    prompt += `

## 출력 규칙
- 반드시 JSON 형식으로 응답하세요.
- corrected_body: 모든 수정 사항을 반영한 전체 이메일 본문을 포함하세요.
- issues 배열: 각 수정 사항을 개별 항목으로 나열하세요.
- 오류가 없으면: {"corrected_body": "원본 그대로", "issues": []}
- original 필드: 문제가 되는 원문 텍스트 (문맥 파악 가능한 최소 범위)
- corrected 필드: 수정된 텍스트
- explanation 필드: 왜 수정이 필요한지 한국어로 간결하게 설명
- 작성자의 문체와 어투를 최대한 유지하세요.
- 확실한 오류만 지적하세요. 스타일 선호도 차이는 지적하지 마세요.
- 오탐(false positive)을 최소화하세요.
- 매 검토 시 모든 오류를 빠짐없이 한 번에 찾아내세요. 누락 없이 전수 검사하세요.
- 수신자 정보나 원본 메일 컨텍스트가 함께 제공되면, 본문에서 사용된 호칭(이름, 직책)이 해당 정보와 일치하는지 반드시 대조하세요.

## 응답 형식
\`\`\`json
{
  "corrected_body": "수정된 전체 이메일 본문",
  "issues": [
    {
      "category": "카테고리_id",
      "original": "문제 원문",
      "corrected": "수정안",
      "explanation": "수정 이유"
    }
  ]
}
\`\`\``;

    return prompt;
  }

  function buildUserPrompt(emailBody, { recipients, quotedContext } = {}) {
    let prompt = '';

    if (recipients && recipients.length > 0) {
      const recipientList = recipients
        .map(r => {
          const label = r.type === 'cc' ? ' (참조)' : r.type === 'bcc' ? ' (숨은참조)' : '';
          return r.name ? `${r.name}${label}` : `${r.email}${label}`;
        })
        .join(', ');
      prompt += `[수신자 정보] ${recipientList}\n`;
    }

    if (quotedContext) {
      prompt += '[원본 메일 컨텍스트]\n';
      if (quotedContext.header) {
        prompt += `헤더: ${quotedContext.header}\n`;
      }
      if (quotedContext.opening) {
        prompt += `원본 서두: ${quotedContext.opening}\n`;
      }
      if (quotedContext.signature) {
        prompt += `원본 서명: ${quotedContext.signature}\n`;
      }
    }

    if (prompt) {
      prompt += '\n---\n\n';
    }

    prompt += `다음 이메일 본문을 검토해주세요:\n\n${emailBody}`;
    return prompt;
  }

  function getCategoryInfo(categoryId) {
    return CATEGORY_MAP[categoryId] || null;
  }

  return {
    CATEGORIES,
    ALL_CATEGORY_IDS,
    CATEGORY_MAP,
    CATEGORY_DESCRIPTIONS,
    buildSystemPrompt,
    buildUserPrompt,
    getCategoryInfo,
  };
})();
