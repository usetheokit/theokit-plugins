---
'@theokit/plugin-forms': patch
---

`applyActionErrorsToForm(form.setError, …)` voltou a compilar (#54).

O uso documentado não passava no TypeScript: `SetErrorCallback` declarava `name: string` e o
`setError` do react-hook-form aceita uma união estreita dos caminhos do formulário — por
contravariância de parâmetro, a função mais estreita não é atribuível onde se espera a mais larga.
Runtime sempre funcionou; só os tipos não compunham.

`SetErrorCallback` é genérico sobre o nome agora, com default `string`, então **nenhum uso existente
quebra**. O cast inevitável entre a chave que vem do servidor em runtime e o tipo que o formulário
conhece em compilação passou a viver dentro do plugin, uma única vez, em vez de em cada chamada.
