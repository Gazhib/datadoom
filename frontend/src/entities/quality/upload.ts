import type { RawRecord } from './contract'

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export function validateRecords(records: unknown[]): RawRecord[] {
  return records.map((record, index) => {
    const prefix = `Record ${index + 1}`
    if (!isObject(record) || typeof record.conversation_id !== 'string' || !record.conversation_id.trim()) {
      throw new Error(`${prefix} needs a conversation_id.`)
    }
    if (record.channel !== 'agent chat' && record.channel !== 'voice call') {
      throw new Error(`${prefix} needs channel “agent chat” or “voice call”.`)
    }
    if (record.language !== 'RU' && record.language !== 'KZ' && record.language !== 'EN') {
      throw new Error(`${prefix} needs language RU, KZ or EN.`)
    }
    if (record.audio_url !== null && typeof record.audio_url !== 'string') {
      throw new Error(`${prefix} needs audio_url as a string or null.`)
    }
    if (!Array.isArray(record.transcript)) throw new Error(`${prefix} needs a transcript array.`)

    const transcript = record.transcript.map((turn: unknown, turnIndex: number): RawRecord['transcript'][number] => {
      if (!isObject(turn) || typeof turn.timestamp !== 'string' || typeof turn.text !== 'string' ||
        (turn.speaker !== 'client' && turn.speaker !== 'operator' && turn.speaker !== 'bot' && turn.speaker !== 'system')) {
        throw new Error(`${prefix}, turn ${turnIndex + 1} needs a timestamp, supported speaker and text.`)
      }
      return { timestamp: turn.timestamp, speaker: turn.speaker, text: turn.text }
    })
    if (!transcript.some((turn) => turn.text.trim())) {
      throw new Error(`${prefix} needs at least one turn with text.`)
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
    throw new Error('This file is not valid JSON. Check the file and try again.')
  }
  if (isObject(value) && 'isSuccess' in value) {
    if (value.isSuccess !== true || !isObject(value.data) || !Array.isArray(value.data.records)) {
      throw new Error('The organizer envelope needs isSuccess: true and a data.records array.')
    }
    value = value.data.records
  }
  return validateRecords(Array.isArray(value) ? value : [value])
}
