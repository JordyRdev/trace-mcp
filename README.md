# trace-mcp

I built this because I got tired of being a stranger to my own AI. Every time I open Cursor to write code, or Claude to plan something, I have to re-explain who I am, what I'm working on, and what I decided yesterday. 

`trace-mcp` fixes that. It's a local-first memory layer that runs as an MCP server. It holds your context in one SQLite file you actually own, so it follows you across whatever AI tools you use, instead of being trapped inside someone else's cloud.

## Three ideas

1. **One file.** Everything lives in `~/.trace/trace.db`. Copy it, back it up, delete it.
2. **Receipts.** A memory without a source quote and a date is a rumor. `trace` stores both.
3. **Review.** The model proposes. You approve. Nothing becomes active on its own.

## How it works

An MCP client (like Cursor or Claude Desktop) calls `remember` with a sentence and a supporting quote. The memory lands in a pending queue. You approve it in the CLI or in the local inspector. The model can't approve its own memories (see [Review stays with you](#review-stays-with-you)). 

Recall searches active memories using SQLite FTS5, includes your pinned memories, and fills any empty slots with the most recent ones.

When something changes, you call `replace`. The new memory is queued as pending. On approval, the old row is marked `superseded`, gets an end date, and links to its replacement. Nothing is deleted, so you can see what used to be true and when it stopped being true.

## Install

Requires Node 20 or newer.

```bash
npm install -g trace-memory-mcp
trace init
```

If npm warns that `better-sqlite3` has install scripts that weren't run (npm 11 and newer), install with:

```bash
npm install -g --allow-scripts=better-sqlite3 trace-memory-mcp
```

Getting `EACCES: permission denied`? Don't use `sudo`. Point npm at a folder you own instead:

```bash
npm config set prefix ~/.npm-global --location=user
echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.bashrc && exec bash
```

`trace init` creates `~/.trace/trace.db`. Use `--db <path>` or `TRACE_DB` to put it somewhere else.

## Connect a client

trace runs as an MCP server over stdio with `trace serve`.

**Claude Code**: available in every folder:

```bash
claude mcp add --scope user trace -- trace serve
```

**Claude Desktop**: add this to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "trace": {
      "command": "trace",
      "args": ["serve"]
    }
  }
}
```

**Cursor**: add the same block to `~/.cursor/mcp.json`, or to `.cursor/mcp.json` in a project.

If the client can't find `trace` on its `PATH`, use `"command": "npx", "args": ["-y", "trace-memory-mcp", "serve"]`.

## Review stays with you

By default the MCP server only exposes tools that **propose** or **read**:
`remember`, `replace`, `recall`, `pending` and `stats`.

Approving, rejecting, forgetting, pinning and exporting happen in the CLI or the inspector, where you're the one deciding. That's the point: a model, or text it read on a web page, can't slip a memory into your active set.

If you really want clients to review too, start the server with `trace serve --allow-review` (or set `TRACE_MCP_ALLOW_REVIEW=1`).

**Agents with a shell.** Tools like Claude Code can also run terminal commands, so a model could call `trace approve` directly. Block that in the agent's own permissions. For Claude Code, in `~/.claude/settings.json`:

```json
{
  "permissions": {
    "deny": ["Bash(trace approve:*)", "Bash(trace pin:*)", "Bash(trace forget:*)", "Bash(trace export:*)"]
  }
}
```

Commands you type yourself (`! trace approve <id>` in Claude Code) still work.

## Receipts

Over MCP, `remember` and `replace` require `evidence`: the person's own words, quoted. A model can't store a memory it can't back up.

From the CLI, `--evidence` is optional, but a memory without one is marked **no receipt** in recall, the inspector and exports, so you can tell facts from rumors.

## Review queue

```bash
trace pending                 # what's waiting
trace approve m_abc123        # make it active
trace reject m_abc123         # drop it
trace inspect                 # local web UI at http://127.0.0.1:4747
```

The inspector only listens on `127.0.0.1` and only accepts requests addressed to `127.0.0.1` or `localhost` from its own pages, so other websites open in your browser can't read or change your memories.

## CLI

```bash
trace remember "I prefer tabs over spaces" --kind preference --evidence "tabs, always" --source chat
trace recall "editor setup"
trace replace m_abc123 "I moved to Amsterdam" --evidence "we moved last week"
trace pin m_abc123
trace forget m_abc123
trace list --status superseded
trace export --format md > memories.md
trace doctor
```

Kinds: `identity`, `fact`, `preference`, `event`. Run `trace help` for every option.

## Recall

`recall` returns up to `--limit` memories (default 8):

1. pinned memories, capped at half the slots when there are search matches
2. full-text matches (SQLite FTS5, porter stemming, Unicode-aware)
3. the rest of the pinned memories
4. the most recent memories, only to fill empty slots

## Development

```bash
npm install
npm test
npm run build
```

## License

MIT
