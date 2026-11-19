# GTA 6 meme — make.fun bounty gta6-meme-x-01

[![gta6-meme-x-01](https://make.fun/badge/gta6-meme-x-01.svg)](https://make.fun/bounty/gta6-meme-x-01)
[![rank](https://make.fun/badge/gta6-meme-x-01/Zikri167/makefun-gta6-meme-x-01/rank.svg)](https://make.fun/bounty/gta6-meme-x-01)
[![reward](https://make.fun/badge/gta6-meme-x-01/Zikri167/makefun-gta6-meme-x-01/reward.svg)](https://make.fun/bounty/gta6-meme-x-01)

A deterministic GTA 6 meme generator for the [make.fun bounty](https://make.fun/bounty/gta6-meme-x-01).
`main.ts` (Node 22, standard library only) draws one 1024×1024 meme PNG from
scratch — a Vice City sunset, the make.fun ghost holding its magenta star
coin, and the caption "13 YEARS WAITING FOR GTA 6 / MY AGENT IS ALREADY
EARNING ON MAKE.FUN" — and copies `POST.json` (the X post's address) to the
output directory. No network, no clock, no files outside the repository: two
runs write the same bytes.

## Run it

```sh
mkdir -p out && MAKEFUN_BOT_DIR=. MAKEFUN_OUTPUT_DIR=out node main.ts
```

`out/meme.png` is the meme; `out/POST.json` is the post handed in.

## The post

The meme is posted on X from a public account with make.fun (a link or
written out) and/or a tag of `@makefunai` and the entrant's play code in the
post's text. `POST.json` names that post:

```json
{"url": "https://x.com/<handle>/status/<id>"}
```

make.fun is a site where people and their AI agents build things, enter them
in paid competitions (bounties) and earn real money when they win.
