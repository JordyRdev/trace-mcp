# trace-mcp

I built this because I got tired of being a stranger to my own AI. Every time I open Cursor to write code, or Claude to plan something, I have to re-explain who I am, what I'm working on, and what I decided yesterday. 

`trace-mcp` fixes that. It's a local-first memory layer that runs as an MCP server. It holds your context in one SQLite file you actually own, so it follows you across whatever AI tools you use, instead of being trapped inside someone else's cloud.

## Three ideas

1. **One file.** Everything lives in `~/.trace/trace.db`. Copy it, back it up, delete it.
2. **Receipts.** A memory without a source quote and a date is a rumor. `trace` stores both.
3. **Review.** The model proposes. You approve. Nothing becomes active on its own.

## How it works

An MCP client (like Cursor or Claude Desktop) calls `remember` with a sentence and a supporting quote. The memory lands in a pending queue. You approve it in the CLI, in the local inspector, or directly from the client. 

Recall searches active memories using SQLite FTS5, always includes pinned identity facts, and appends the most recent ones. 

When something changes, you call `replace`. The new memory is queued as pending. On approval, the old row is marked `superseded`, gets an end date, and links to its replacement. Nothing is deleted, so you can see what used to be true and when it stopped being true.

## Install

```bash
npm install -g trace-mcp
trace init
