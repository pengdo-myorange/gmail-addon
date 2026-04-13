/**
 * prompts.js — 9개 오류 카테고리 + Gemini 프롬프트 + JSON 스키마
 */

const EmailReviewPrompts = (() => {

  const CATEGORIES = [
    { id: 'recipient_title', name: '수신자 호칭 오류', group: 'expression', color: { bg: '#e8f0fe', text: '#1967d2' } },
    { id: 'duplicate', name: '중복 표현', group: 'style', color: { bg: '#f3e8fd', text: '#8430ce' } },
    { id: 'spacing', name: '띄어쓰기 오류', group: 'grammar', color: { bg: '#fef7e0', text: '#e37400' } },
    { id: 'typo', name: '오타/맞춤법', group: 'grammar', color: { bg: '#fef7e0', text: '#e37400' } },
    { id: 'honorific', name: '경어체 불일치', group: 'style', color: { bg: '#f3e8fd', text: '#8430ce' } },
    { id: 'missing', name: '누락 요소', group: 'structure', color: { bg: '#e6f4ea', text: '#137333' } },
    { id: 'awkward', name: '어색한 표현', group: 'expression', color: { bg: '#e8f0fe', text: '#1967d2' } },
    { id: 'particle', name: '조사 오류', group: 'grammar', color: { bg: '#fef7e0', text: '#e37400' } },
    { id: 'paragraph', name: '문단 구분 오류', group: 'structure', color: { bg: '#e6f4ea', text: '#137333' } },
  ];

  const CATEGORY_MAP = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));

  const RESPONSE_SCHEMA = {
    type: 'object',
    properties: {
      issues: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            category: { type: 'string', enum: CATEGORIES.map(c => c.id) },
            original: { type: 'string' },
            corrected: { type: 'string' },
            explanation: { type: 'string' },
          },
          required: ['category', 'original', 'corrected', 'explanation'],
        },
      },
    },
    required: ['issues'],
  };

  function buildSystemPrompt() {
    return `당신은 한국어 비즈니스 이메일 전문 검토자입니다.
사용자가 제출한 이메일 본문을 분석하여, 아래 9개 카테고리에 해당하는 오류를 찾아 수정안을 제시하세요.

## 오류 카테고리
1. recipient_title (수신자 호칭 오류): 받는 사람 이름/직책 잘못 표기
2. duplicate (중복 표현): 동일 인사말/맺음말 반복 (예: "감사합니다" 두 번)
3. spacing (띄어쓰기 오류): 한국어 조사/어미 띄어쓰기 (예: "변경사항은" → "변경 사항은")
4. typo (오타/맞춤법): 단순 입력 실수, 맞춤법 오류
5. honorific (경어체 불일치): 문장 내/간 존칭 수준 혼용 (예: "~합니다"와 "~해요" 혼재)
6. missing (누락 요소): 인사말, 서명, 맺음말 빠짐
7. awkward (어색한 표현): 문법적으로 맞지만 자연스럽지 않은 문장
8. particle (조사 오류): 잘못된 조사 사용 (예: "측정을 변경사항" → "측정에 변경사항")
9. paragraph (문단 구분 오류): 호칭 뒤 줄바꿈 누락, 문단 없는 장문, 서명 전 줄바꿈 누락

## 문단 구분 규칙
- 호칭(예: "OOO 님께,") 뒤에는 빈 줄
- 본문 문단 사이에는 빈 줄
- 맺음말/서명 앞에는 빈 줄

## 출력 규칙
- 반드시 JSON 형식으로 응답하세요.
- 오류가 없으면 빈 배열을 반환하세요: {"issues": []}
- original 필드: 문제가 되는 원문 텍스트 (문맥 파악 가능한 최소 범위)
- corrected 필드: 수정된 텍스트
- explanation 필드: 왜 수정이 필요한지 한국어로 간결하게 설명
- 작성자의 문체와 어투를 최대한 유지하세요.
- 확실한 오류만 지적하세요. 스타일 선호도 차이는 지적하지 마세요.
- 오탐(false positive)을 최소화하세요.

## 응답 형식
\`\`\`json
{
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
  }

  function buildUserPrompt(emailBody) {
    return `다음 이메일 본문을 검토해주세요:\n\n${emailBody}`;
  }

  function getCategoryInfo(categoryId) {
    return CATEGORY_MAP[categoryId] || null;
  }

  return {
    CATEGORIES,
    CATEGORY_MAP,
    RESPONSE_SCHEMA,
    buildSystemPrompt,
    buildUserPrompt,
    getCategoryInfo,
  };
})();
