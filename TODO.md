# VEX Client SDK - Itens Pendentes / Pontos de Atenção

## 1. Tratamento de Mídia (Performance)
Atualmente, o método `sendMessage` envia o conteúdo da mensagem (incluindo buffers de arquivos) dentro do payload JSON via POST.
**(Pendente / Bloqueado)**: O `vex-server` atualmente suporta apenas JSON no endpoint de mensagens. Implementar `FormData` no SDK requer alteração prévia no Backend.

## 2. Testes Automatizados
- [x] Testes criados com Jest (`npm test` funcionando).
- [x] Testes unitários para `WebhookParser`.

## 3. Discrepância na Documentação
- [x] Ajustar Retries para 5 em `HttpClient.ts`.

## 4. Tipagem de Eventos
- [x] Normalização implementada para `groups.upsert` e `groups.update` em `WebhookParser.ts`.

## 5. Exports do Package
- [x] Exports adicionados em `package.json`.

## 6. Scripts de Build
- [x] Scripts `build:watch` e `test` adicionados.
