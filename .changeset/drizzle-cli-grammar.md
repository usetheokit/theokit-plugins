---
'@theokit/plugin-db-drizzle': minor
---

Os verbos do CLI passaram a emitir argumentos que o `drizzle-kit` real aceita (#48).

Cinco dos seis verbos de passthrough montavam uma linha de comando recusada pelo binário — só
`db push` funcionava. `generate` omitia o `--dialect` que o drizzle-kit exige, `migrate` e
`studio` recebiam flags que eles rejeitam (aceitam apenas `--config`), `check` recebia
`--schema`/`--url` e não recebia `--out`, e `reset` invocava um subcomando que não existe.

Junto, `db studio` passou a abrir (#49): o peer `drizzle-orm` subiu para `>=0.37.0`, a primeira
versão que exporta `./singlestore-core` — subpath que o drizzle-kit importa e sem o qual o studio
morre ao ler o config.

BREAKING para quem chama `buildDbCommands()` direto: a forma dos argumentos mudou por verbo,
`DbCommand.kind` ganhou `'drizzle-kit-with-config'` (o executor precisa escrever
`renderDrizzleConfig(opts)` em `opts.configPath` antes do spawn), e `reset` virou
`'user-script'` com a nova opção `resetScript`. E o piso do peer `drizzle-orm` subiu de `>=0.36.0`
para `>=0.37.0`.
