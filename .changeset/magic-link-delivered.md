---
'@theokit/auth-magic-link': patch
---

O link de magic-link passou a ser verificado a partir de uma mensagem **recebida**.

Um servidor SMTP real no próprio teste, MIME real por TCP, parse do que chegou, e o link extraído do
corpo recebido — que então precisa logar o usuário. Sem credencial: roda com `env -i`.

Achou um modo de falha real: quoted-printable quebra linha na coluna 76 e a URL de magic-link é mais
longa, então a quebra cai dentro do token (`token=3D…BvU1=` + continuação). Nenhum teste de
transporte JSON pega isso, e quem usa SMTP passa por ali. O teste prova que a quebra ocorreu antes de
provar a recuperação.

Somente testes; nenhuma mudança de comportamento no pacote.
