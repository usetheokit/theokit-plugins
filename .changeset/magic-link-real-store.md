---
'@theokit/auth-magic-link': patch
---

O `createOrmStore` passou a ser testado contra um banco real, incluindo a exigência de atomicidade
que a interface declarava em prosa e ninguém verificava.

`MagicLinkRepository.consumeAtomically` exige "a single SQL UPDATE...RETURNING … so concurrent
callers race on the row lock". A suíte anterior cobria o store por um repositório em memória, que é
atômico por construção — JavaScript é single-threaded, então um fake não falha do jeito que SQL
falha.

O novo teste implementa o repositório **duas vezes** contra o mesmo SQLite real: um com
`UPDATE … WHERE consumedAt IS NULL RETURNING`, outro com SELECT-depois-UPDATE. O primeiro sobrevive a
duas consumações concorrentes; o segundo perde o uso único — e um token de magic-link consumível duas
vezes é bypass de autenticação. Os dois casos provam um ao outro.

Também afirma, lendo a coluna do banco, que o persistido é o hash e nunca o token que o usuário
recebeu. Somente testes; nenhuma mudança de comportamento.
