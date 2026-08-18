---
'@theokit/plugin-canvas': patch
---

O `createSqliteArtifactStore` passou a ser testado contra um SQLite real.

A cobertura anterior eram 5 casos de validação de nome de tabela contra `{} as db`, então nenhum SQL
era executado e `autoMigrate` nunca rodava — o pacote publicava um store SQLite sem nunca ter rodado
um.

O novo teste é de conformidade: a mesma sequência passa pelo store SQLite e pelo em memória, e os dois
têm que concordar. Cobre round-trip por kind (cada um carrega um campo de payload diferente), ordem de
versões, delete por versão, o caminho de linha corrompida fora de banda, e que um nome de tabela
customizado é de fato usado.

Somente testes; nenhuma mudança de comportamento no pacote.
