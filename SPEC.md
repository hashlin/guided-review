# guided-review — Product / Engineering Spec

Reference document for implementers. V1 scope unless a section says otherwise.

---

## 1. Overview

**guided-review** is a local, agent-launched guided code-review web app. A CLI coding agent (Claude Code, Codex) finishes a change, writes a guide JSON that narrates the diff, and launches this tool. The tool starts a localhost web server and opens a browser tab; the human reviews the change as a narrated walkthrough — section by section, with the AI's explanation of *why* each part changed shown above the diffs for that part.

The AI is **not** embedded in the app. The app only renders. It reads the diff from local git and reads an optional guide file the agent already wrote; it never calls a model.

**One-line flow:** agent writes guide JSON → agent launches the `guided-review` CLI → human reviews in browser.

The guide is **optional**. With no `--guide`, the app is a plain, fast diff viewer with a file list — no narration, no sections, just the changed files.

---

## 2. Decisions log

Each decision is settled; rationale is one line.

- **Form factor: local web server + browser tab, launched by CLI.** Browsers render diffs well and are universally available; no desktop-app packaging or TUI rendering limits.
- **V1 is read-only (no comments back to the agent).** Ship the reading experience first; the write path is designed for but deferred to `--wait` mode.
- **Architecture anticipates a future `--wait` mode returning a structured review result.** Avoids a rewrite when the feedback loop lands.
- **Diff source V1: local git only (ref range or working tree). No GitHub.** The common case is reviewing an agent's just-finished local change; git is always present.
- **Stack: Bun runtime + TypeScript server, Vite + React 19 client.** Fast startup and a single-language toolchain.
- **Diff rendering via `@pierre/diffs` (CodeView).** Apache-2.0, from the Pierre team, shiki-based syntax highlighting, virtualized — meets the large-PR performance mandate without building a diff renderer.
- **Guide is optional; no guide → plain diff viewer.** The tool is useful even when an agent did not narrate the change.
- **Ground truth is always git; guide refs are only pointers.** Changed files not referenced by any guide section land in an automatic "Everything else" bucket, so a stale or partial guide can never hide code from review.
- **Signal tiers on sections: core / supporting / noise.** Lets the agent direct attention honestly and lets the reader triage; noise renders collapsed but is never removed.
- **Left rail = guide sections (primary nav), with a Files tab fallback.** Sections are the intended reading order; the file list is the escape hatch and the no-guide default.
- **Performance mandate: 300-file / 20k-line PRs open fast and scroll smoothly.** Per-file diffs are fetched lazily and rendered virtualized.

---

## 3. Guide JSON schema

The guide is a single JSON object. The wire contract between server and client lives in `shared/types.ts` and is treated as **read-only** by implement agents — it must contain **exactly** these types:

```ts
export type Signal = 'core' | 'supporting' | 'noise'
export interface GuideRef { file: string; lines?: [number, number] }
export interface GuideInsight { kind: 'risk' | 'note' | 'test'; text: string }
export interface GuideSection { id?: string; title: string; explanation: string; signal: Signal; refs: GuideRef[]; insights?: GuideInsight[] }
export interface Guide { version: 1; title: string; summary?: string; sections: GuideSection[] }
export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed'
export interface ChangedFile { path: string; oldPath?: string; status: FileStatus; additions: number; deletions: number; binary: boolean }
export interface ReviewMeta { repo: string; baseRef: string; headRef: string; files: ChangedFile[]; guide: Guide | null }
```

### Field reference

**`Signal`** — `'core' | 'supporting' | 'noise'`. The attention tier of a section (see §5 for rendering).
- `core`: essential to understanding the change; rendered expanded, filled amber marker.
- `supporting`: helps but is secondary; outlined blue marker.
- `noise`: mechanical / generated / low-value to read (lockfiles, codegen); dashed grey marker, files render collapsed with a "Show anyway" affordance.

**`GuideRef`** — a pointer from a section into the diff.
- `file` *(string, required)*: repo-relative path, matching a `ChangedFile.path` in the diff. For renames, use the new path (`ChangedFile.path`), not `oldPath`.
- `lines` *(`[number, number]`, optional)*: an inclusive start/end line range in the new file, used to hint which region of a large file the section is about. Advisory only — the diff for the whole file is still shown. Omit to reference the entire file.

**`GuideInsight`** — a callout rendered above a section's diffs.
- `kind` *(required)*: `'risk' | 'note' | 'test'`.
  - `risk`: something that could break or needs scrutiny.
  - `note`: context or a heads-up (e.g. ordering, follow-up work).
  - `test`: what is (or isn't) covered by tests.
- `text` *(string, required)*: the callout body. Plain text / short prose.

**`GuideSection`** — one step of the walkthrough.
- `id` *(string, optional)*: stable identifier for the section, used for progress tracking and deep-links. If omitted, the client derives a stable id from the section index. Provide one when you want progress to survive guide edits.
- `title` *(string, required)*: short section heading.
- `explanation` *(string, required)*: the **WHY** of this section, in Markdown. Rendered as the section body above its diffs. This is the narration — explain intent, tradeoffs, and what to scrutinize, not a restatement of the diff.
- `signal` *(`Signal`, required)*: the attention tier.
- `refs` *(`GuideRef[]`, required)*: the files (and optional line ranges) this section covers, in the order they should be shown. May be empty, but a section with no refs shows only prose.
- `insights` *(`GuideInsight[]`, optional)*: risk/note/test callouts for this section.

**`Guide`** — the whole guide.
- `version` *(`1`, required)*: schema version. Must be the literal `1`.
- `title` *(string, required)*: title of the overall change / review.
- `summary` *(string, optional)*: one-paragraph overview of the change (Markdown).
- `sections` *(`GuideSection[]`, required)*: the walkthrough, in intended reading order (author core first — see appendix).

### Server-derived types (not part of the guide file)

**`FileStatus`** — `'added' | 'modified' | 'deleted' | 'renamed'`, derived from git name-status.

**`ChangedFile`** — one entry in the diff, computed by the server from git:
- `path`: repo-relative path (new path for renames).
- `oldPath` *(optional)*: previous path, present only for `renamed`.
- `status`: `FileStatus`.
- `additions` / `deletions`: line counts from `git diff --numstat` (`0`/`0` for binary).
- `binary`: `true` when git reports the file as binary.

**`ReviewMeta`** — the payload of `GET /api/review`:
- `repo`: repo name (basename of the git toplevel).
- `baseRef` / `headRef`: the effective diff endpoints.
- `files`: the full list of changed files (ground truth).
- `guide`: the parsed `Guide`, or `null` when no `--guide` was supplied or it could not be used.

### Full example guide

```json
{
  "version": 1,
  "title": "Per-key rate limiting via token bucket",
  "summary": "Adds an in-memory token-bucket rate limiter, wires it into the Express middleware chain after auth, and plumbs capacity/refill through config. Redis-backed cross-instance limiting is planned but not in this change.",
  "sections": [
    {
      "id": "limiter",
      "title": "Token bucket limiter",
      "signal": "core",
      "explanation": "The core of the change. `TokenBucket` tracks capacity per API key and refills continuously from elapsed time rather than on a timer — this avoids a background interval per key and makes the limiter trivially testable with a fake clock.\n\nScrutinize the refill math and the `Map` growth: buckets are created lazily per key and never evicted in this version.",
      "refs": [
        { "file": "src/lib/limiter.ts" }
      ],
      "insights": [
        {
          "kind": "risk",
          "text": "Buckets live in process memory. Multi-instance deployments will rate-limit per instance, not globally — the Redis strategy is planned but not in this change."
        }
      ]
    },
    {
      "id": "middleware",
      "title": "Middleware & app wiring",
      "signal": "core",
      "explanation": "The Express middleware resolves the caller's API key, looks up (or lazily creates) its bucket, and returns `429` with a `Retry-After` header when the bucket is empty. The wiring change in `app.ts` is small but order-sensitive: the limiter mounts *after* auth so limits apply per authenticated key, not per IP.",
      "refs": [
        { "file": "src/middleware/rateLimit.ts" },
        { "file": "src/app.ts", "lines": [8, 15] }
      ],
      "insights": [
        {
          "kind": "note",
          "text": "Middleware ordering changed: rateLimit() now sits between auth() and the router."
        }
      ]
    },
    {
      "id": "config",
      "title": "Configuration plumbing",
      "signal": "supporting",
      "explanation": "Capacity and refill rate come from environment variables with defaults of 60 burst / 10 per second sustained. Verify the defaults match what ops expects.",
      "refs": [
        { "file": "src/config.ts" },
        { "file": ".env.example" }
      ]
    },
    {
      "id": "tests",
      "title": "Tests",
      "signal": "supporting",
      "explanation": "Unit tests drive the bucket with a fake clock: burst exhaustion, gradual refill, and cap-at-capacity. The middleware has one integration test asserting the `429` shape.",
      "refs": [
        { "file": "test/limiter.test.ts" }
      ],
      "insights": [
        {
          "kind": "test",
          "text": "No concurrency test — tryConsume is synchronous so this is fine today, but worth adding if the Redis strategy lands."
        }
      ]
    },
    {
      "id": "noise",
      "title": "Lockfile & generated types",
      "signal": "noise",
      "explanation": "Dependency bump plus regenerated API typings. Nothing hand-written.",
      "refs": [
        { "file": "package-lock.json" },
        { "file": "src/generated/api-types.d.ts" }
      ]
    }
  ]
}
```

Given this guide, if `README.md` also changed but is referenced by no section, the client places it in an **"Everything else"** bucket (see §5).

---

## 4. CLI contract and HTTP API

### HTTP API

Server on localhost, default port **4400**. Exactly these routes — no others.

- **`GET /api/review` → `application/json` (`ReviewMeta`)**
  - `files`: computed from `git diff --numstat` and `git diff --name-status` over the effective range.
  - `guide`: the JSON at `--guide` parsed into a `Guide`, or `null` when no `--guide` was given.
  - **No server-side guide validation.** The server does not drop refs that point to files absent from the diff. The client computes the "Everything else" bucket as: changed files not referenced by any section ref.

- **`GET /api/diff?file=<path>` → `text/plain`**
  - The raw unified diff for exactly that one file: `git diff <range> -- <path>`, **including** the `diff --git` header lines.
  - The client parses this text with `@pierre/diffs`.

- **Any other path**
  - In **prod**: serve the built client from `web/dist`.
  - In **dev**: the client runs under Vite with a proxy forwarding `/api` to the server port.

### CLI contract

Entry point `bin/guided-review.ts`, runnable with `bun bin/guided-review.ts`.

**Flags:**
- `--base <ref>` — base ref for the diff range. Optional.
- `--head <ref>` — head ref. Default `HEAD`.
- `--guide <path>` — path to the guide JSON. Optional; omit for plain-viewer mode.
- `--port <n>` — server port. Default `4400`.
- `--no-open` — do not auto-open the browser.

**Diff range:**
- If `--base` is given, use `git diff --merge-base <base> <head>` semantics (i.e. `base...head`, comparing against the merge base).
- If `--base` is **not** given, diff the working tree against HEAD (`git diff HEAD`).

**Startup:**
- Verify the cwd is inside a git repo via `git rev-parse --show-toplevel`. If not, exit `1` with a clear message.
- `repo` name = basename of the git toplevel.
- Start the server on `--port`.
- Unless `--no-open`, open the browser with the platform command: `open` on macOS, `xdg-open` on Linux.

---

## 5. UI specification

The interactive mockup at `scratchpad/guided-review-mockup.html` is the visual source of truth. This section describes structure and behavior.

### Layout

Three-region shell filling the viewport, no page-level horizontal scroll:

- **Header (52px):** wordmark `~/guided-review`; a repo chip (`repo` + `baseRef → headRef`); a guide chip ("Guide by …") shown only when a guide is present; a flexible spacer; the progress indicator (`N / M reviewed` + bar); a unified/split view toggle; a **Finish review** button (placeholder in V1 — anticipates `--wait`).
- **Left rail (280px):** primary navigation. Two tabs: **Guide** (default) and **Files · N**. Below, a scrollable list. A footer legend explains the tier marks.
- **Main pane (scrollable, centered ~980px max-width):** the current section — eyebrow (`Section i of N` + tier pill), title, optional bucket note, the Markdown explanation, insight callouts, then the section's diff cards, then the "Mark section reviewed" action.
- **Footer (36px):** the CLI command that launched the session, and keyboard hints.

Below ~800px the rail and chips hide (single-column reading).

### Rail — Guide tab

One row per section, in guide order. Each row: a **tier mark**, the section title, a meta line (`file count · +adds −dels`), and a **read mark** (checkmark circle) that fills once the section is marked reviewed. The active section is highlighted; reviewed sections dim their title.

Tier marks:
- **core** — filled amber square.
- **supporting** — blue outlined square.
- **noise** — grey dashed square.
- **bucket** ("Everything else") — faint dotted circle.

### Rail — Files tab

Flat list of every changed file (ground truth), path + `+adds −dels`. This is the fallback nav and the default experience when there is no guide. Clicking a file navigates to the section that contains it.

### Signal tiers in the main pane

- **core** sections render fully expanded.
- **supporting** sections render normally.
- **noise** sections: their diff cards render **collapsed** by default, showing a one-line summary (e.g. "Lockfile — 6,813 changed lines hidden") with a **"Show anyway"** button that expands the real diff on demand.

Each diff card has a header (chevron, path, status badge, `+adds −dels`) and a collapsible body. Insight callouts (`risk` / `note` / `test`) render above the diffs, color-coded with a left border.

### "Everything else" bucket

Computed client-side: any `ChangedFile` whose `path` is not referenced by any section `ref` is collected into a synthetic **"Everything else"** section (bucket tier), appended last. It carries a note: *"Changed in the diff but not referenced by any guide section. The diff is always ground truth — a partial or stale guide can never hide code from review."* The bucket has no explanation prose and no reviewed-state (it is not counted in progress). When there is no guide, all files effectively live here / in the Files list.

### Progress model

- Denominator `M` = number of **reviewable** sections (all guide sections; the bucket is excluded).
- Numerator `N` = sections the reader has marked reviewed.
- Marking a section reviewed advances to the next section automatically. Marking the last section does not advance.
- The header shows `N / M reviewed` and a fill bar. Progress is per-session (V1 has no persistence requirement).

### Keyboard map

- `n` — next section.
- `p` — previous section.
- `space` — mark current section reviewed (and advance).
- `u` — toggle unified / split diff view.

Keys are ignored while focus is in an input/textarea.

---

## 6. Performance requirements

Target: a **300-file / 20k+-line** change is interactive in **under ~1s** on a laptop, and scrolls smoothly.

- **Metadata first.** `GET /api/review` returns only the file list + guide — no diff bodies. This is small and fast regardless of PR size.
- **Lazy per-file diff fetch.** Each file's unified diff is fetched from `GET /api/diff?file=…` only when its section/card is in (or near) view. Nothing fetches all diffs up front.
- **Virtualized rendering.** `@pierre/diffs` (CodeView) virtualizes rows, so a multi-thousand-line file renders only the visible window. Syntax highlighting is shiki-based and incremental.
- **Noise collapsed by default.** Noise-tier files (lockfiles, generated code) are not fetched or rendered until "Show anyway" — this keeps the worst offenders (6k-line lockfiles) off the critical path.
- **No horizontal page scroll.** Wide diff content scrolls inside its own container.

---

## 7. Roadmap (post-V1)

Short, in priority order.

1. **Feedback loop (`--wait`).** A `--wait` flag holds the CLI open until the human finishes. The UI gains per-section **approve / request-changes** and **anchored comments** (file + line). On finish, the tool emits a structured JSON review result to stdout for the calling agent to consume. The V1 read-only architecture is shaped so this is additive.
2. **GitHub PR source (via `gh`).** Add a diff source that pulls a PR's diff and metadata through the `gh` CLI, alongside the local-git source.
3. **MCP server integration.** Expose guided-review as an MCP server so agents can launch a review and receive the structured result through the tool protocol rather than shelling out.

---

## 8. Appendix — Guide authoring guidance for AI agents

*(This appendix will later ship as the prompt snippet agents use when writing a guide.)*

You are writing a guide that a human will read to review the change you just made. The guide narrates the diff; it never replaces it. Write for a reviewer who trusts nothing and wants to understand *why*.

- **Order core first.** Put the sections that carry the actual intent of the change at the top. A reader who stops after the core sections should still understand the change.
- **Explain WHY, not what.** The diff already shows *what* changed. Your `explanation` should cover intent, the tradeoff you made, what you considered and rejected, and what the reviewer should scrutinize. Never restate the code in prose.
- **Use signal tiers honestly.** `core` for what matters, `supporting` for secondary plumbing/tests, `noise` for mechanical or generated changes (lockfiles, codegen). Do not label something noise to hide it — the reviewer sees everything regardless, and mislabeling erodes trust.
- **Keep it to 3–7 sections.** Fewer feels ungrouped; more feels like busywork. Group related files into one section.
- **Reference real files and lines.** Every `ref.file` must be a path that actually changed. Use `lines` to point at the relevant region of a large file. You do not need to reference every file — anything you skip lands in "Everything else" and is still reviewed.
- **Use insights for the sharp edges.** `risk` for what could break or needs scrutiny, `note` for context/ordering/follow-ups, `test` for coverage gaps. Keep each to a sentence or two. Do not pad — a section with no real risks needs no insights.
- **Write `summary` as the one-paragraph "what and why" of the whole change,** including anything deliberately out of scope.
