import type { Checklist, Conversation, Grade, Panel } from '../model/contract'
import syntheticCall from './synthetic-call.wav?url'

const opening = 'Начало и понимание запроса'
const resolution = 'Безопасность и решение'
const close = 'Ведение и завершение диалога'

export const defaultChecklist: Checklist = {
  version_id: 'default-v1',
  name: 'Чек-лист Freedom Broker',
  criteria: [
    { id: 'C01', label: 'Установление контакта', kind: 'binary', weight: 10, scale: [], allow_na: false,
      instruction: 'Yes if the operator greets in the client’s language and introduces themselves in the first response.', na_rule: null, section: opening },
    { id: 'C02', label: 'Выявление потребности', kind: 'binary', weight: 15, scale: [], allow_na: true,
      instruction: 'Yes if the operator uses known details and clarifies missing information before answering.', na_rule: 'The customer provided enough information at the start.', section: opening },
    { id: 'C03', label: 'Идентификация', kind: 'binary', weight: 20, scale: [], allow_na: true,
      instruction: 'Yes if identity verification is confirmed before protected disclosure or action. Use no if verification was required and remains unconfirmed.', na_rule: 'The request requires no verification.', section: resolution },
    { id: 'C04', label: 'Корректная и полная консультация', kind: 'scale', weight: 20, scale: [0, 5, 10, 15, 20], allow_na: true,
      instruction: '20: all material questions answered or correct next step given. 15: main issue resolved with a minor omission. 10: material issue still open. 5: generic guidance without an actionable next step. 0: no substantive answer or a key error.', na_rule: 'The chat ended before the client made a request.', section: resolution },
    { id: 'C05', label: 'Эмпатия и клиентоориентированность', kind: 'binary', weight: 15, scale: [], allow_na: false,
      instruction: 'Yes for politeness and, when the client expresses dissatisfaction or inconvenience, acknowledgment of the specific problem.', na_rule: null, section: close },
    { id: 'C06', label: 'Управление диалогом, скорость и грамотность', kind: 'scale', weight: 15, scale: [0, 4, 7, 10], allow_na: false,
      instruction: '10: clear and coherent, with a warning for evident waits. 7: one noticeable lapse with the conversation still understandable. 4: client needs clarification because of wording or sequence. 0: incoherent or contradictory exchange that is hard to follow.', na_rule: null, section: close },
    { id: 'C07', label: 'Завершение', kind: 'binary', weight: 5, scale: [], allow_na: true,
      instruction: 'Yes if the operator summarizes or offers further help and says goodbye.', na_rule: 'The dialogue ended before the operator could close it.', section: close },
    { id: 'C08', label: 'Грубые ошибки', kind: 'flag', weight: 0, scale: [], allow_na: false,
      instruction: 'Yes for an operator insult, a proposal for paid services outside the company, or disclosure of confidential information. A private paid offer alone suffices.', na_rule: null, section: 'Грубые нарушения' },
  ],
}

export const demoConversations: Conversation[] = [
  {
    key: 'demo-001', group_id: 'SYNTH', conversation_id: 'ru-001', channel: 'agent chat', language: 'RU', audio_url: null,
    turns: [
      { id: 't1', timestamp: '00:00', speaker: 'client', text: 'Какой график демо-чата и можно ли задать вопрос на английском?' },
      { id: 't2', timestamp: '00:02', speaker: 'operator', text: 'Здравствуйте! Меня зовут Алия.' },
      { id: 't3', timestamp: '00:08', speaker: 'operator', text: 'Демо-чат работает по будням с 9:00 до 18:00.' },
      { id: 't4', timestamp: '00:12', speaker: 'system', text: 'Чат закрыт оператором.' },
    ],
  },
  {
    key: 'demo-002', group_id: 'SYNTH', conversation_id: 'kz-002', channel: 'agent chat', language: 'KZ', audio_url: null,
    turns: [
      { id: 't1', timestamp: '00:00', speaker: 'bot', text: 'Сәлеметсіз бе! Сізді оператормен байланыстырамын.' },
      { id: 't2', timestamp: '00:02', speaker: 'client', text: 'Демо-шотты қалай ашуға болады?' },
      { id: 't3', timestamp: '00:08', speaker: 'operator', text: 'Сәлеметсіз бе! Менің атым Дана. Қосымшада «Демо-шот ашу» батырмасын басыңыз.' },
      { id: 't4', timestamp: '00:15', speaker: 'operator', text: 'Қосымша сұрақтарыңыз болса, көмектесуге дайынмын. Сау болыңыз!' },
    ],
  },
  {
    key: 'demo-003', group_id: 'SYNTH', conversation_id: 'en-003', channel: 'voice call', language: 'EN', audio_url: syntheticCall,
    turns: [
      { id: 't1', timestamp: '2026-01-15T09:30:00Z', speaker: 'operator', text: 'Good morning, this is Jordan. How can I help?' },
      { id: 't2', timestamp: '2026-01-15T09:30:04Z', speaker: 'client', text: 'What time does the demo support line close?' },
      { id: 't3', timestamp: '2026-01-15T09:30:08Z', speaker: 'operator', text: 'We close at six PM on weekdays. Can I help with anything else?' },
      { id: 't4', timestamp: '2026-01-15T09:30:13Z', speaker: 'client', text: 'That was all, thank you.' },
      { id: 't5', timestamp: '2026-01-15T09:30:16Z', speaker: 'operator', text: 'Thanks for calling. Goodbye.' },
    ],
  },
]

const russianChatGrades: Grade[] = [
  { criterion_id: 'C01', value: 'yes', reason: 'Оператор поздоровался на русском и представился.', evidence_turn_ids: ['t2'] },
  { criterion_id: 'C02', value: 'na', reason: 'Для ответа на оба общих вопроса исходных данных достаточно.', evidence_turn_ids: ['t1'] },
  { criterion_id: 'C03', value: 'na', reason: 'Вопрос о демо-чате не требует идентификации.', evidence_turn_ids: ['t1'] },
  { criterion_id: 'C04', value: 15, reason: 'График указан, вопрос о языке остался без ответа.', evidence_turn_ids: ['t1', 't3'] },
  { criterion_id: 'C05', value: 'yes', reason: 'Оператор общался вежливо.', evidence_turn_ids: ['t2', 't3'] },
  { criterion_id: 'C06', value: 7, reason: 'Ответ понятен, но вопрос о языке остался вне последовательности ответа.', evidence_turn_ids: ['t1', 't3'] },
  { criterion_id: 'C07', value: 'no', reason: 'Чат закрыт без прощания.', evidence_turn_ids: ['t3', 't4'] },
  { criterion_id: 'C08', value: 'no', reason: 'В проверенных репликах грубых ошибок не выявлено.', evidence_turn_ids: ['t2', 't3'] },
]

const kazakhChatGrades: Grade[] = [
  { criterion_id: 'C01', value: 'yes', reason: 'The operator greets and introduces herself in Kazakh.', evidence_turn_ids: ['t3'] },
  { criterion_id: 'C02', value: 'na', reason: 'The customer asks a complete question about opening a demo account.', evidence_turn_ids: ['t2'] },
  { criterion_id: 'C03', value: 'na', reason: 'General demo-account instructions require no identity verification.', evidence_turn_ids: ['t2', 't3'] },
  { criterion_id: 'C04', value: 20, reason: 'The operator names the action to take in the app.', evidence_turn_ids: ['t3'] },
  { criterion_id: 'C05', value: 'yes', reason: 'The operator responds politely and offers further help.', evidence_turn_ids: ['t3', 't4'] },
  { criterion_id: 'C06', value: 10, reason: 'The instruction follows the request and is easy to act on.', evidence_turn_ids: ['t2', 't3'] },
  { criterion_id: 'C07', value: 'yes', reason: 'The operator offers further help and says goodbye.', evidence_turn_ids: ['t4'] },
  { criterion_id: 'C08', value: 'no', reason: 'The operator gives general instructions without any serious error.', evidence_turn_ids: ['t3', 't4'] },
]

const englishCallGrades: Grade[] = [
  { criterion_id: 'C01', value: 'yes', reason: 'Jordan greets the caller and gives their name.', evidence_turn_ids: ['t1'] },
  { criterion_id: 'C02', value: 'na', reason: 'The caller already specified the line and asked for its closing time.', evidence_turn_ids: ['t2'] },
  { criterion_id: 'C03', value: 'na', reason: 'The caller only requests public opening hours.', evidence_turn_ids: ['t2', 't3'] },
  { criterion_id: 'C04', value: 20, reason: 'The operator gives the closing time and specifies the days it applies.', evidence_turn_ids: ['t2', 't3'] },
  { criterion_id: 'C05', value: 'yes', reason: 'The operator checks whether the caller needs anything else.', evidence_turn_ids: ['t3'] },
  { criterion_id: 'C06', value: 10, reason: 'The operator gives a clear, direct answer to the caller’s question.', evidence_turn_ids: ['t2', 't3'] },
  { criterion_id: 'C07', value: 'yes', reason: 'The operator offers further help and says goodbye after the caller declines.', evidence_turn_ids: ['t3', 't4', 't5'] },
  { criterion_id: 'C08', value: 'no', reason: 'The operator shares only demo support hours and closes politely.', evidence_turn_ids: ['t3', 't5'] },
]

export const gradesByFixture: Record<string, Grade[]> = {
  'demo-001': russianChatGrades,
  'demo-002': kazakhChatGrades,
  'demo-003': englishCallGrades,
}

export const fixtureJudges = [
  { name: 'judge-1', provider: 'fixture', model: 'qwen3:1.7b', host: 'http://judge-1.local:11434', seconds: 2.1 },
  { name: 'judge-2', provider: 'fixture', model: 'gemma3:4b', host: 'http://judge-2.local:11434', seconds: 2.6 },
  { name: 'judge-3', provider: 'fixture', model: 'phi4-mini', host: 'http://judge-3.local:11434', seconds: 1.9 },
]

export function fixturePanel(grades: Grade[], checklist: Checklist, skipLast: boolean): Panel {
  const judges = fixtureJudges.map((judge, index) => ({
    ...judge, fallback: false, status: skipLast && index === 2 ? 'skipped' as const : 'ok' as const,
    seconds: skipLast && index === 2 ? null : judge.seconds, error_code: null,
  }))
  const judgeGrade = (grade: Grade, name: string): Grade => {
    const criterion = checklist.criteria.find(({ id }) => id === grade.criterion_id)
    // Deliberately split the synthetic defense example; production UI never depends on this ID.
    return grade.criterion_id === 'C06' && grade.value === 7 && name === 'judge-3' && criterion?.scale.includes(10)
      ? { ...grade, value: 10, reason: 'Synthetic split vote: this judge reads the closing turn as fully resolving the request.' }
      : grade
  }
  const panelJudges = judges.map((judge) => ({
    ...judge, grades: judge.status === 'ok' ? grades.map((grade) => judgeGrade(grade, judge.name)) : null,
  }))
  const votes = grades.map((grade, index) => {
    const ballots = Object.fromEntries(panelJudges.flatMap((judge) => judge.grades ? [[judge.name, judge.grades[index].value]] : []))
    return {
      criterion_id: grade.criterion_id, value: grade.value, ballots,
      agreement: Object.values(ballots).filter((value) => value === grade.value).length / Object.keys(ballots).length,
    }
  })
  return { quorum: 2, judges: panelJudges, votes, agreement: votes.length ? votes.reduce((sum, vote) => sum + vote.agreement, 0) / votes.length : 1 }
}

// Cue points measured in the bundled recording. Transcript timestamps are source data.
export function demoRecordingOffsets(conversation: Conversation): ReadonlyMap<string, number> | undefined {
  const demo = demoConversations[2]
  if (conversation.key !== demo.key || conversation.audio_url !== syntheticCall || conversation.turns.length !== demo.turns.length
    || !conversation.turns.every((turn, index) => turn.id === demo.turns[index].id
      && turn.speaker === demo.turns[index].speaker && turn.timestamp === demo.turns[index].timestamp)) return undefined
  return new Map([['t1', 0], ['t2', 4.3], ['t3', 7.5], ['t4', 12.6], ['t5', 15.1]])
}
