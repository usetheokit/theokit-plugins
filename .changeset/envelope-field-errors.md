---
"@theokit/plugin-forms": patch
---

Um erro de campo devolvido por uma action local volta a aterrar no input.

O pacote existe para "server field errors landing on the right input", e isso funcionava por HTTP e falhava para uma action local. A diferença era o transporte: por HTTP o envelope `{ data, error }` é desembrulhado antes de o adapter o ver, e o mapa `fields` chegava achatado. Uma action local resolve com o envelope intacto, o `fields` fica um nível abaixo, o adapter não o encontrava e relançava — sem banner, sem mensagem inline, sem nada no ecrã.

`extractFieldsFromError` passa a ler as duas formas. O ramo que relança um erro desconhecido mantém-se: engolir uma falha arbitrária trocaria um defeito visível por um silencioso.
