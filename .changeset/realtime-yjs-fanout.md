---
'@theokit/plugin-realtime': patch
---

Uma edição Yjs passou a chegar aos outros clientes (#53).

`applyYjsUpdate` aplicava os bytes no `Y.Doc` do servidor e **não notificava ninguém** — nenhum
observer no doc, nenhum `fanout` do tipo `yjs-update`. O autor via o próprio estado local e nenhum
outro cliente recebia nada. O mesmo valia para `applyYjsAwareness`, então cursores remotos nunca
apareciam.

Efeito colateral do defeito: o ramo binário do `frameToOutput`, que codifica bytes em base64 para o
fio JSON, era código morto — nada produzia o frame que ele convertia.

Os bytes recebidos são rebroadcast (O(update), não O(documento)) e o autor **não** é excluído do
fanout: Yjs é idempotente, e o frame carrega `connectionId` para o consumidor filtrar o próprio.
