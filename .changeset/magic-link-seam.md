---
'@theokit/plugin-email': patch
---

A compatibilidade entre `sendMagicLink()` e a porta `sendEmail` do `@theokit/auth-magic-link`
passou a ser verificada com os dois pacotes reais, em vez de afirmada contra o tipo local.

Quatro asserções percorrem o caminho que o usuário percorre: token cunhado e persistido, template
renderizado, URL extraída do HTML como um cliente de e-mail faria, `handleCallback` aceitando. Uma
mutação de 4 caracteres na URL do href derruba 3 delas — o que a suíte anterior não detectava.

Somente testes; nenhuma mudança de comportamento no pacote publicado.
