# guided-review

Local, agent-launched guided code review. See SPEC.md.

## Install as a Claude Code plugin (recommended)

The plugin bundles the `guided-review` skill plus a hook that offers a guided
walkthrough after `/code-review` finishes. In Claude Code:

```
/plugin marketplace add hashlin/guided-review
/plugin install guided-review@guided-review
```

The CLI itself still needs [bun](https://bun.sh) on first use — the skill walks
through that install when `guided-review` is not on PATH.

## Install the CLI

```
bun install -g guided-review
```

Requires [bun](https://bun.sh) (the CLI runs on it). Or run without installing:

```
bun x guided-review --base main --guide path/to/guide.json
```

## Install the skill only

Copy `skills/guided-review/` into `~/.claude/skills/` (no hook, no plugin).

## Develop from source

```
git clone https://github.com/hashlin/guided-review
cd guided-review
bun install && bun run build && bun link
```
