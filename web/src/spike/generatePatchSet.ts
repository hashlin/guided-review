export interface SpikeFile {
  index: number
  path: string
  diffText: string
  changedLines: number
}

export interface SpikeSection {
  id: string
  index: number
  title: string
  paragraphs: string[]
  fileIndexes: number[]
}

export interface SpikePatchSet {
  files: SpikeFile[]
  sections: SpikeSection[]
  totalChangedLines: number
}

const MODULES = ['api', 'auth', 'billing', 'core', 'hooks', 'jobs', 'models', 'routes', 'ui', 'utils']

const SECTION_SIZES = [20, 45, 30, 60, 25, 50, 40, 30]

const SECTION_TITLES = [
  'Schema and model groundwork',
  'API surface: new endpoints and validation',
  'Auth token rotation',
  'Billing engine rewrite',
  'Background job scheduling',
  'UI: review screen and shared components',
  'Hooks and client-side data flow',
  'Cleanup, utilities and dead code removal',
]

function sectionParagraphs(index: number, fileCount: number): string[] {
  return [
    `Section ${index + 1} covers ${fileCount} files. Start with the smaller files to build context, ` +
      'then work through the larger rewrites. The changes in this group are intentionally reviewed together ' +
      'because they share a single invariant that must hold across every file below.',
    'Pay attention to the renamed parameters and the switch from positional arguments to an options object. ' +
      'Any call site that still passes positional arguments is a bug the author may have missed.',
  ]
}

type SizeClass = 'large' | 'medium' | 'small'

function sizeClassFor(index: number): SizeClass {
  if (index % 10 === 0) return 'large'
  if (index % 3 === 0) return 'medium'
  return 'small'
}

const HUNK_SHAPE: Record<SizeClass, { hunks: number; changed: number }> = {
  large: { hunks: 5, changed: 30 },
  medium: { hunks: 4, changed: 12 },
  small: { hunks: 1, changed: 5 },
}

function extensionFor(index: number): string {
  if (index % 9 === 4) return 'css'
  if (index % 4 === 1) return 'tsx'
  return 'ts'
}

function contextLine(ext: string, i: number, h: number, k: number): string {
  if (ext === 'css') return `.spike-block-${i}-${h}-${k} { display: flex; gap: ${(k % 6) + 2}px; }`
  return `  registry.set('${i}:${h}:${k}', createHandler(steps[${k % 7}], ${(i + k) % 97}));`
}

function deletionLine(ext: string, i: number, h: number, k: number): string {
  if (ext === 'css') return `.spike-item-${i}-${h} { margin-top: ${k + 1}px; color: #333; }`
  return `  const value_${i}_${h}_${k} = normalize(input[${k}], ${(i + k) % 97}, true);`
}

function additionLine(ext: string, i: number, h: number, k: number): string {
  if (ext === 'css') return `.spike-item-${i}-${h} { margin-block-start: ${k + 1}px; color: var(--fg-muted); }`
  return `  const value_${i}_${h}_${k} = normalizeWith(options, input[${k}], ${(i + k) % 97});`
}

function buildDiffText(index: number): { diffText: string; changedLines: number } {
  const ext = extensionFor(index)
  const module = MODULES[index % MODULES.length]
  const path = `src/${module}/file_${String(index).padStart(3, '0')}.${ext}`
  const { hunks, changed } = HUNK_SHAPE[sizeClassFor(index)]
  const context = 3

  const lines: string[] = [
    `diff --git a/${path} b/${path}`,
    `index ${(index + 1).toString(16).padStart(7, '0')}a..${(index + 2).toString(16).padStart(7, '0')}b 100644`,
    `--- a/${path}`,
    `+++ b/${path}`,
  ]

  const hunkSpan = context * 2 + changed + 9
  for (let h = 0; h < hunks; h++) {
    const start = 4 + h * hunkSpan
    const count = context * 2 + changed
    lines.push(`@@ -${start},${count} +${start},${count} @@ block_${index}_${h}`)
    for (let k = 0; k < context; k++) lines.push(` ${contextLine(ext, index, h, k)}`)
    for (let k = 0; k < changed; k++) lines.push(`-${deletionLine(ext, index, h, k)}`)
    for (let k = 0; k < changed; k++) lines.push(`+${additionLine(ext, index, h, k)}`)
    for (let k = context; k < context * 2; k++) lines.push(` ${contextLine(ext, index, h, k)}`)
  }

  return { diffText: lines.join('\n') + '\n', changedLines: hunks * changed * 2 }
}

export function generatePatchSet(fileCount = 300): SpikePatchSet {
  const files: SpikeFile[] = []
  let totalChangedLines = 0
  for (let i = 0; i < fileCount; i++) {
    const { diffText, changedLines } = buildDiffText(i)
    const pathMatch = diffText.slice(0, diffText.indexOf('\n'))
    const path = pathMatch.replace('diff --git a/', '').split(' b/')[0]
    files.push({ index: i, path, diffText, changedLines })
    totalChangedLines += changedLines
  }

  const sections: SpikeSection[] = []
  let cursor = 0
  for (let s = 0; s < SECTION_SIZES.length; s++) {
    const size = Math.min(SECTION_SIZES[s], fileCount - cursor)
    const fileIndexes = Array.from({ length: size }, (_, k) => cursor + k)
    sections.push({
      id: `section-${s}`,
      index: s,
      title: SECTION_TITLES[s],
      paragraphs: sectionParagraphs(s, size),
      fileIndexes,
    })
    cursor += size
  }

  return { files, sections, totalChangedLines }
}
