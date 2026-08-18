---
'@theokit/plugin-forms': patch
---

O erro de um server action passou a ser verificado até o campo que o produziu.

O teste de integração anterior fazia a metade do transporte com servidor e fetch reais, mas passava
`vi.fn()` como `setError` — provava que o adapter invoca um callback, não que um formulário real
mostra alguma coisa. O novo liga tudo: 422 real → fetch → adapter → react-hook-form real →
`useTheoField(nome).isInvalid`.

Cobre a chave aninhada `address.city` (onde o adapter aposta numa afirmação sobre o RHF que ninguém
tinha checado), a convenção `''` → `root`, e a recuperação do usuário. Somente testes.

Ao escrever, ficou visível que `applyActionErrorsToForm(form.setError, …)` — o uso documentado — não
compila por contravariância de parâmetro; registrado como #54, sem mudança de tipo público aqui.
