---
name: guided-review
description: Launch guided-review, a local browser tool that lets the user review code changes as a guided walkthrough with explanations, signal tiers, and risk callouts. Use whenever the user wants to see, inspect, or review changes themselves — "let me review this", "show me what you changed", "walk me through the diff", "open the review tool", "guided review" — and proactively offer it after completing a large or multi-file change. Works in any git repo. Do NOT use when the user asks YOU to review/critique code (that is a code-review task, not this).
---

# guided-review

`guided-review` is a locally installed CLI (`bun install -g guided-review`) that serves a code-review web app for the current git repo. You write a `guide.json` narrating the change you made, launch the CLI, and the user reviews the diff in their browser as a sectioned walkthrough — core changes first, explanations of *why* above each section's diffs, mechanical noise collapsed.

The app renders the diff straight from git as ground truth. The guide only organizes it — files you don't reference still appear in an automatic "Everything else" section, so an incomplete guide never hides code.

## Workflow

### 1. Determine the diff range

- Changes are commits on a branch → use `--base <base-branch>` (diffs base...HEAD).
- Changes are uncommitted in the working tree → no `--base` (diffs working tree vs HEAD).
- Changes live in a GitHub PR → use `--pr <number|url>` (fetches the PR via the `gh` CLI, which must be installed and authenticated; run from a clone of the repo). Mutually exclusive with `--base`/`--head`.
- **Untracked files are invisible in working-tree mode.** If you created brand-new files and haven't committed, run `git add -N <file>` (intent-to-add) on each so they show up in the diff.

### 2. Get the ground-truth file list

```bash
git diff --name-only <base>...HEAD   # or, working-tree mode: git diff --name-only HEAD
gh pr diff <number> --name-only      # PR mode
```

Every `refs[].file` in your guide must be a path from this list, exactly as printed (repo-relative; for renames use the new path; deleted files by the path shown here). A ref to any other path is silently useless.

### 3. Write guide.json

Always generate the guide fresh from the actual diff you just inspected. If a `guide.json` already exists somewhere in the repo (from an earlier run), ignore it — a stale guide silently misdescribes the change.

Write it to a temp location **outside the repo** so you don't dirty the working tree:

```bash
GUIDE_DIR=$(mktemp -d) && $EDITOR_OR_WRITE "$GUIDE_DIR/guide.json"
```

Schema (version must be the literal `1`):

```json
{
  "version": 1,
  "title": "Short title of the change",
  "summary": "One-paragraph what-and-why of the whole change (Markdown). Include anything deliberately out of scope.",
  "sections": [
    {
      "id": "stable-slug",
      "title": "Core: the actual mechanism",
      "explanation": "Markdown. The WHY: intent, tradeoffs, what you considered and rejected, what to scrutinize. Never restate the code.",
      "signal": "core",
      "refs": [
        { "file": "src/lib/limiter.ts" },
        { "file": "src/app.ts", "lines": [8, 24] }
      ],
      "insights": [
        { "kind": "risk", "text": "What could break or needs scrutiny." },
        { "kind": "note", "text": "Context, ordering, follow-ups." },
        { "kind": "test", "text": "What is (or is not) covered by tests." }
      ]
    }
  ]
}
```

Field notes:
- `signal`: exactly `"core"` (essential, expanded) | `"supporting"` (secondary plumbing/tests) | `"noise"` (lockfiles, codegen — rendered collapsed). Any other value makes the whole guide invalid.
- `insights[].kind`: use only `"risk"`, `"note"`, or `"test"` — other strings pass validation but render unstyled.
- `refs[].lines`: optional `[start, end]`, inclusive, line numbers in the **new** file version; advisory hint for large files. Omit to mean the whole file (and always omit for deleted files).
- `insights` is optional — omit it entirely when a section has no sharp edges. Do not pad.
- `id` is optional but keeps the user's read-progress stable if you regenerate the guide.
- Unknown extra fields are tolerated, but missing/wrong required fields invalidate the guide (see verification below — the failure is silent otherwise).

### 4. Launch

The server runs until killed, so launch it in the background and capture its output and PID — you need the log to detect port conflicts and the PID to tell the user how to stop it:

```bash
guided-review --base main --guide "$GUIDE_DIR/guide.json" > "$GUIDE_DIR/server.log" 2>&1 &
echo $! > "$GUIDE_DIR/server.pid"
```

(Or use your background-execution tool if you have one — same idea: retrievable output, known PID.)

Flags: `--base <ref>`, `--head <ref>` (default HEAD), `--pr <number|url>`, `--guide <path>`, `--port <n>` (default 4400), `--no-open` (suppress auto-opening the browser — omit it so the browser opens for the user). If the port is taken the CLI says so in its output — relaunch with `--port`.

### 5. Verify before telling the user it's ready

An invalid guide does NOT error — the server logs a warning and silently serves a plain diff viewer. Never let the user be the one to discover that. Check:

```bash
curl -s http://localhost:4400/api/review | grep -o '"guide":{"version"'
```

If `guide` is `null` in that response, your guide failed validation — read the server log for the reason, fix the JSON, and restart. Only then tell the user: the review is open at `http://localhost:<port>`, what the guide covers in one line, and how to stop the server when done (`kill $(cat "$GUIDE_DIR/server.pid")`).

## Writing a good guide

The guide is read by a human who trusts nothing and wants to understand *why*. Quality rules:

- **Order core first.** A reader who stops after the core sections should still understand the change.
- **Explain WHY, not what.** The diff already shows what changed. Explanations cover intent, tradeoffs, rejected alternatives, and what deserves scrutiny.
- **Use signal tiers honestly.** Never label something `noise` to bury it — the reviewer sees everything regardless, and mislabeling erodes trust in every future guide.
- **3–7 sections.** Fewer feels ungrouped; more feels like busywork. Group related files.
- **Don't reference every file.** Skipped files land in "Everything else" and still get reviewed.
- **Insights are for sharp edges only** — one or two sentences each, and only when real.

## Installing (first run on a new machine)

If `guided-review` is not on PATH, it isn't installed yet. Ask the user before installing (it installs software onto their machine), then:

```bash
bun install -g guided-review
```

Requires [bun](https://bun.sh). The global install lands in `~/.bun/bin` — if the command is still not found afterwards, that directory is missing from PATH. To use it once without installing anything, substitute `bun x guided-review` for `guided-review` in the launch command.

## Failure modes

- `guided-review: not inside a git repository` — run it from the repo being reviewed (the CLI reviews the repo it's invoked from).
- Command not found — not installed; see "Installing" above.
- Invalid guide JSON → the server logs a warning and falls back to a plain diff viewer (guide ignored). If the user reports no sections appeared, validate your JSON against the schema above.
