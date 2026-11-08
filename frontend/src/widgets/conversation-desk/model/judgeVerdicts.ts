import { gradeTone } from '../../../entities/quality'
import type { Criterion, Evaluation, EvaluationJob, Grade, GradeTone, PanelVote, Score } from '../../../entities/quality'

export type JudgeState = 'pending' | 'running' | 'ok' | 'failed' | 'skipped' | 'unavailable'

export type JudgeVerdict = {
  name: string
  model: string | null
  status: JudgeState
  seconds: number | null
  errorCode: string | null
  // Full grades with reasons and cited turns, when the backend kept them.
  grades: ReadonlyMap<string, Grade> | null
  // Vote values only. Older panel runs saved these without reasons.
  ballots: ReadonlyMap<string, Grade['value']>
}

export type TurnCell = { judge: JudgeVerdict; grade?: Grade; value?: Grade['value']; cites: boolean }
export type TurnRow = {
  criterion: Criterion
  final?: Score['items'][number]
  vote?: PanelVote
  finalCites: boolean
  cells: TurnCell[]
  split: boolean
}
export type TurnMark = { judge: string; tone: GradeTone | null; count: number }

const byCriterion = (grades: Grade[] | null | undefined) =>
  grades ? new Map(grades.map((grade) => [grade.criterion_id, grade])) : null

export function jobJudges(job: EvaluationJob): JudgeVerdict[] {
  const ended = job.status === 'succeeded' || job.status === 'failed'
  return (job.progress?.judges ?? []).map((judge) => ({
    name: judge.name,
    model: null,
    status: ended && (judge.status === 'pending' || judge.status === 'running') ? 'unavailable' : judge.status,
    seconds: judge.seconds,
    errorCode: judge.error_code ?? null,
    grades: byCriterion(judge.grades),
    ballots: new Map(),
  }))
}

// A panel result names its members "provider/model + …" in judge order, skipping judges that returned nothing.
function withMemberModels(judges: JudgeVerdict[], members: string): JudgeVerdict[] {
  const models = members.split(' + ')
  const graded = judges.filter((judge) => judge.grades)
  if (models.length !== graded.length) return judges
  return judges.map((judge) => judge.grades ? { ...judge, model: models[graded.indexOf(judge)] } : judge)
}

// Prefer the saved panel. Runs saved without one still keep each judge's grades on their job record;
// only a run with neither shows the evaluator's combined grades as a single column.
export function evaluationJudges(evaluation: Evaluation, jobs: EvaluationJob[]): JudgeVerdict[] {
  const { panel, model } = evaluation
  const job = jobs.find((item) => item.evaluation_id === evaluation.id)
  const live = job?.progress?.judges ?? []
  if (!panel) {
    if (job && live.length) {
      const judges = jobJudges(job)
      return model.provider === 'panel' ? withMemberModels(judges, model.model) : judges
    }
    return [{
      name: model.provider, model: model.model, status: 'ok', seconds: null, errorCode: null,
      grades: byCriterion(evaluation.original.items), ballots: new Map(),
    }]
  }
  return panel.judges.map((judge) => ({
    name: judge.name,
    model: judge.model,
    status: judge.status,
    seconds: judge.seconds,
    errorCode: judge.error_code,
    grades: byCriterion(judge.grades ?? live.find(({ name }) => name === judge.name)?.grades),
    ballots: new Map(panel.votes.filter((vote) => Object.hasOwn(vote.ballots, judge.name))
      .map((vote) => [vote.criterion_id, vote.ballots[judge.name]])),
  }))
}

// Every criterion that any judge, or the final grade, tied to this turn.
export function turnRows(turnId: string, evaluation: Evaluation, judges: JudgeVerdict[]): TurnRow[] {
  const finals = new Map(evaluation.final.items.map((item) => [item.criterion_id, item]))
  const votes = new Map(evaluation.panel?.votes.map((vote) => [vote.criterion_id, vote]) ?? [])
  return evaluation.checklist.criteria.flatMap((criterion) => {
    const cells = judges.map((judge): TurnCell => {
      const grade = judge.grades?.get(criterion.id)
      return { judge, grade, value: grade?.value ?? judge.ballots.get(criterion.id), cites: !!grade?.evidence_turn_ids.includes(turnId) }
    })
    const final = finals.get(criterion.id)
    const finalCites = !!final?.evidence_turn_ids.includes(turnId)
    if (!finalCites && !cells.some((cell) => cell.cites)) return []
    const values = new Set(cells.flatMap((cell) => cell.value === undefined ? [] : [cell.value]))
    return [{ criterion, final, vote: votes.get(criterion.id), finalCites, cells, split: values.size > 1 }]
  })
}

const severity: Record<GradeTone, number> = { negative: 3, scale: 2, positive: 1, na: 0 }

// One marker per judge: how many criteria it tied to the turn and the worst grade among them.
export function turnMarks(rows: TurnRow[], judges: JudgeVerdict[]): TurnMark[] {
  return judges.map((judge, index) => {
    const tones = rows.flatMap((row) => {
      const cell = row.cells[index]
      const counted = judge.grades ? cell.cites : row.finalCites
      return counted && cell.value !== undefined ? [gradeTone(cell.value, row.criterion)] : []
    })
    const tone = tones.reduce<GradeTone | null>((worst, next) => worst && severity[worst] >= severity[next] ? worst : next, null)
    return { judge: judge.name, tone, count: tones.length }
  })
}
