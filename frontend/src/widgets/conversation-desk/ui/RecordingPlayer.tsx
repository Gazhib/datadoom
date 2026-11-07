import { useEffect, useRef, useState } from 'react'
import type { Conversation, Speaker } from '../../../entities/quality'
import { Icon } from '../../../shared/ui/Icon'
import { formatClock } from './recording'
import type { EvidenceTarget } from './Transcript'

const barCount = 176
const maxPreviewBytes = 16 * 1024 * 1024
const maxPreviewSeconds = 600

async function waveform(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal })
  if (!response.ok || !response.body || Number(response.headers.get('content-length')) > maxPreviewBytes) {
    await response.body?.cancel()
    throw new Error('Waveform unavailable')
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > maxPreviewBytes) {
        await reader.cancel()
        throw new Error('Waveform preview is too large')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  signal.throwIfAborted()
  const data = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) {
    data.set(chunk, offset)
    offset += chunk.byteLength
  }
  const buffer = await new OfflineAudioContext(1, 1, 16000).decodeAudioData(data.buffer)
  const peaks = Array<number>(barCount).fill(0)
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const samples = buffer.getChannelData(channel)
    for (let i = 0; i < samples.length; i += 4) {
      const bar = Math.floor(i * barCount / samples.length)
      peaks[bar] = Math.max(peaks[bar], Math.abs(samples[i]))
    }
  }
  const peak = Math.max(0.02, ...peaks)
  return peaks.map((sample) => sample / peak)
}

export function RecordingPlayer({ url, turns, duration, offsets, target, onDuration }: {
  url: string
  turns: Conversation['turns']
  duration: number | null
  offsets?: ReadonlyMap<string, number>
  target: EvidenceTarget | null
  onDuration: (duration: number | null) => void
}) {
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [failure, setFailure] = useState<'media' | 'play' | null>(null)
  const [preview, setPreview] = useState<{ url: string; peaks: number[] | null }>()
  const canPreview = duration !== null && duration <= maxPreviewSeconds
  const peaks = canPreview && preview?.url === url ? preview.peaks : null
  const loadingPreview = canPreview && preview?.url !== url
  const ratio = (seconds: number) => duration ? Math.max(0, Math.min(100, seconds / duration * 100)) : 0

  const segments = offsets ? turns.flatMap((turn) => {
    const start = offsets.get(turn.id)
    return start === undefined ? [] : [{ id: turn.id, start, speaker: turn.speaker }]
  }) : []
  const selected = segments.findIndex((segment) => segment.id === target?.id)
  const start = segments[selected]?.start
  const end = selected < 0 ? undefined : segments[selected + 1]?.start ?? duration

  useEffect(() => {
    if (!canPreview) return
    const controller = new AbortController()
    void waveform(url, controller.signal).then(
      (peaks) => { if (!controller.signal.aborted) setPreview({ url, peaks }) },
      () => { if (!controller.signal.aborted) setPreview({ url, peaks: null }) },
    )
    return () => controller.abort()
  }, [url, canPreview])

  useEffect(() => {
    const media = audio.current
    if (!media || duration === null || start === undefined || start >= duration) return
    media.currentTime = start
  }, [target, start, duration])

  function readDuration(media: HTMLAudioElement) {
    onDuration(Number.isFinite(media.duration) && media.duration > 0 ? media.duration : null)
  }

  function togglePlayback() {
    const media = audio.current
    if (!media) return
    if (!media.paused) {
      media.pause()
      return
    }
    setFailure(null)
    if (media.error) media.load()
    void media.play().catch((error: unknown) => {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setFailure('play')
    })
  }

  const lanes: { label: string; speaker?: Speaker }[] = segments.length
    ? [{ label: 'Client', speaker: 'client' }, { label: 'Operator', speaker: 'operator' }]
    : [{ label: 'Recording' }]
  const speakerAt = (time: number) => segments.reduce<Speaker | undefined>(
    (speaker, segment) => segment.start <= time ? segment.speaker : speaker, undefined,
  )

  return <section className="recording pane" aria-labelledby="recording-heading">
    <header className="recording-heading">
      <h2 id="recording-heading"><Icon name="waveform" size={17} /> Call recording</h2>
      <a href={url} target="_blank" rel="noopener noreferrer">Open recording <Icon name="arrowUpRight" size={15} /></a>
    </header>
    <audio ref={audio} src={url} preload="metadata" onLoadedMetadata={(event) => readDuration(event.currentTarget)}
      onDurationChange={(event) => readDuration(event.currentTarget)} onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
      onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onError={() => {
        setPlaying(false)
        setFailure('media')
      }} />
    {peaks && <div className="waveform" aria-hidden="true">
      {lanes.map(({ label, speaker }, lane) => <div className="wave-lane" key={label}>
        <span>{label}</span>
        <svg className={lane ? 'wave-operator' : 'wave-client'} viewBox={`0 0 ${barCount * 4} 42`} preserveAspectRatio="none">
          {start !== undefined && end != null && <rect className="wave-evidence" x={ratio(start) * barCount / 25} y="0" width={(ratio(end) - ratio(start)) * barCount / 25} height="42" />}
          {peaks.map((peak, i) => {
            const amplitude = speaker && duration && speakerAt((i + 0.5) * duration / barCount) !== speaker ? 0 : peak
            const height = 1.25 + Math.pow(amplitude, 0.72) * 18
            return <line className="wave-bar" key={i} x1={i * 4 + 2} x2={i * 4 + 2} y1={21 - height} y2={21 + height} />
          })}
          {current > 0 && <line className="wave-playhead" x1={ratio(current) * barCount / 25} x2={ratio(current) * barCount / 25} y1="0" y2="42" />}
        </svg>
      </div>)}
    </div>}
    {!peaks && !failure && <p className="recording-note">{loadingPreview ? 'Preparing waveform…' : duration ? 'Waveform preview unavailable. Use the playback controls to listen.' : 'Loading recording details…'}</p>}
    <div className="playback">
      <button className="play-button" type="button" data-playing={playing} aria-label={playing ? 'Pause recording' : 'Play recording'} onClick={togglePlayback}><Icon name={playing ? 'pause' : 'play'} size={22} /></button>
      <span className="playback-time">{formatClock(current)} <span>/</span> {duration === null ? '—:—' : formatClock(duration)}</span>
      <input type="range" aria-label="Recording position" aria-valuetext={formatClock(current)}
        min={0} max={duration ?? 1} step="any" value={duration ? Math.min(duration, current) : 0} disabled={!duration || failure === 'media'}
        style={{ '--played': `${ratio(current)}%` } as React.CSSProperties} onChange={(event) => {
          const time = Number(event.target.value)
          if (audio.current) audio.current.currentTime = time
          setCurrent(time)
        }} />
    </div>
    {failure && <p className="recording-note" role="status">Could not play the recording here. Try again or open the recording directly.</p>}
    {target && start === undefined && <p className="recording-note" role="status">The cited turn is highlighted below. No verified audio offset is available.</p>}
  </section>
}
