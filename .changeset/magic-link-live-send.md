---
'@theokit/plugin-email': patch
---

O e-mail de magic-link passou a ser enviado de verdade na suíte e2e.

A suíte live de e-mail enviava um `<p>marker</p>` montado à mão, então o template que o usuário
recebe nunca tinha passado pela API real. Agora percorre `magicLink()` → `sendMagicLink()` →
`ResendProvider` → HTTP real, e afirma o UUID de message-id devolvido pelo Resend antes de alegar
nada sobre o conteúdo.

Não prova entrega: o destinatário é o endereço de sandbox `resend.dev` (aceita e descarta) e a chave
é restrita a envio, então a mensagem não pode ser lida de volta. Somente testes.
