import { UiError } from '../../../shared/i18n/messages'
import type { RawRecord } from '../model/contract'

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export function validateRecords(records: unknown[]): RawRecord[] {
  return records.map((record, index) => {
    const position = { record: index + 1 }
    if (!isObject(record) || typeof record.conversation_id !== 'string' || !record.conversation_id.trim()) {
      throw new UiError('uploadIdRequired', position)
    }
    if (record.channel !== 'agent chat' && record.channel !== 'voice call') {
      throw new UiError('uploadInvalidChannel', position)
    }
    if (record.language !== 'RU' && record.language !== 'KZ' && record.language !== 'EN') {
      throw new UiError('uploadInvalidLanguage', position)
    }
    if (record.audio_url !== null && typeof record.audio_url !== 'string') {
      throw new UiError('uploadInvalidAudio', position)
    }
    if (!Array.isArray(record.transcript)) throw new UiError('uploadTranscriptRequired', position)

    const transcript = record.transcript.map((turn: unknown, turnIndex: number): RawRecord['transcript'][number] => {
      if (!isObject(turn) || typeof turn.timestamp !== 'string' || typeof turn.text !== 'string' ||
        (turn.speaker !== 'client' && turn.speaker !== 'operator' && turn.speaker !== 'bot' && turn.speaker !== 'system')) {
        throw new UiError('uploadInvalidTurn', { ...position, turn: turnIndex + 1 })
      }
      return { timestamp: turn.timestamp, speaker: turn.speaker, text: turn.text }
    })
    if (!transcript.some((turn) => turn.text.trim())) {
      throw new UiError('uploadTextRequired', position)
    }

    return {
      conversation_id: record.conversation_id,
      channel: record.channel,
      language: record.language,
      audio_url: record.channel === 'agent chat' && !record.audio_url?.trim() ? null : record.audio_url,
      transcript,
    }
  })
}

export function parseUpload(text: string): RawRecord[] {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new UiError('invalidJson')
  }
  if (isObject(value) && 'isSuccess' in value) {
    if (value.isSuccess !== true || !isObject(value.data) || !Array.isArray(value.data.records)) {
      throw new UiError('invalidOrganizerEnvelope')
    }
    value = value.data.records
  }
  return validateRecords(Array.isArray(value) ? value : [value])
}
