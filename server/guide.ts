import type { Guide } from '../shared/types.ts'

/**
 * Load and minimally validate a guide JSON file. On any problem, logs a warning to
 * stderr and returns null so the app still works as a plain diff viewer.
 */
export async function loadGuide(path: string): Promise<Guide | null> {
  let text: string
  try {
    text = await Bun.file(path).text()
  } catch {
    console.warn(`guided-review: could not read guide at ${path} — serving without a guide.`)
    return null
  }

  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (err) {
    console.warn(`guided-review: guide at ${path} is not valid JSON (${(err as Error).message}) — serving without a guide.`)
    return null
  }

  const problem = validate(data)
  if (problem) {
    console.warn(`guided-review: guide at ${path} is invalid: ${problem} — serving without a guide.`)
    return null
  }
  return data as Guide
}

function validate(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return 'not an object'
  const g = data as Record<string, unknown>
  if (g.version !== 1) return 'version must be 1'
  if (typeof g.title !== 'string') return 'title must be a string'
  if (!Array.isArray(g.sections)) return 'sections must be an array'
  for (let i = 0; i < g.sections.length; i++) {
    const problem = validateSection(g.sections[i], i)
    if (problem) return problem
  }
  return null
}

function validateSection(section: unknown, index: number): string | null {
  if (typeof section !== 'object' || section === null) return `section ${index} is not an object`
  const s = section as Record<string, unknown>
  if (typeof s.title !== 'string') return `section ${index} missing string title`
  if (typeof s.explanation !== 'string') return `section ${index} missing string explanation`
  if (s.signal !== 'core' && s.signal !== 'supporting' && s.signal !== 'noise') {
    return `section ${index} has invalid signal (${String(s.signal)})`
  }
  if (!Array.isArray(s.refs)) return `section ${index} refs must be an array`
  for (const ref of s.refs as unknown[]) {
    if (typeof ref !== 'object' || ref === null || typeof (ref as Record<string, unknown>).file !== 'string') {
      return `section ${index} has a ref without a string file`
    }
  }
  if (s.insights !== undefined) {
    if (!Array.isArray(s.insights)) return `section ${index} insights must be an array`
    for (const insight of s.insights as unknown[]) {
      if (
        typeof insight !== 'object' ||
        insight === null ||
        typeof (insight as Record<string, unknown>).kind !== 'string' ||
        typeof (insight as Record<string, unknown>).text !== 'string'
      ) {
        return `section ${index} has an insight without string kind and text`
      }
    }
  }
  return null
}
