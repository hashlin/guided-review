export type Signal = 'core' | 'supporting' | 'noise'
export interface GuideRef { file: string; lines?: [number, number] }
export interface GuideInsight { kind: 'risk' | 'note' | 'test'; text: string }
export interface GuideSection { id?: string; title: string; explanation: string; signal: Signal; refs: GuideRef[]; insights?: GuideInsight[] }
export interface Guide { version: 1; title: string; summary?: string; sections: GuideSection[] }
export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed'
export interface ChangedFile { path: string; oldPath?: string; status: FileStatus; additions: number; deletions: number; binary: boolean }
export interface ReviewMeta { repo: string; baseRef: string; headRef: string; files: ChangedFile[]; guide: Guide | null }
