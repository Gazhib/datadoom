import type { Checklist, Grade, Score } from '../model/contract'

function round(value: number) {
  return Math.round((value + Number.EPSILON * value) * 100) / 100
}

export function scoreGrades(checklist: Checklist, grades: Grade[]): Score {
  const gradesById = new Map(grades.map((grade) => [grade.criterion_id, grade]))
  const rows = checklist.criteria.map((criterion) => ({ criterion, grade: gradesById.get(criterion.id)! }))
  const weight = rows.reduce((sum, { criterion, grade }) => sum + (grade.value === 'na' ? 0 : criterion.weight), 0)
  const sections = new Map<string, { points: number; possible: number }>()
  let total = 0

  const items = rows.map(({ criterion, grade }) => {
    const effective = criterion.weight > 0 && grade.value !== 'na' ? 100 * criterion.weight / weight : null
    const ratio = typeof grade.value === 'number' ? grade.value / criterion.scale.at(-1)! : Number(grade.value === 'yes')
    const points = effective === null ? null : effective * ratio
    total += points ?? 0

    if (criterion.section) {
      const section = sections.get(criterion.section) ?? { points: 0, possible: 0 }
      section.points += points ?? 0
      section.possible += effective ?? 0
      sections.set(criterion.section, section)
    }

    return { ...grade, weight: criterion.weight, effective_weight: effective === null ? null : round(effective), points: points === null ? null : round(points) }
  })

  return {
    items,
    total: weight ? round(total) : null,
    serious_error: rows.some(({ criterion, grade }) => criterion.kind === 'flag' && grade.value === 'yes'),
    sections: Array.from(sections, ([name, { points, possible }]) => ({
      name, points: possible ? round(points) : null, possible: possible ? round(possible) : null,
    })),
  }
}
