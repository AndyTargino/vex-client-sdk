# VEX Client SDK

SDK cliente compatível com Baileys para conexão com o VEX Microservice. Permite integrar aplicações com o WhatsApp de forma simples e escalável, utilizando a mesma interface do Baileys.

## Instalação

```bash
npm install @vex/client-sdk
```

## Início Rápido

```typescript
import { makeWASocket } from '@vex/client-sdk';

// Criar cliente VEX
const sock = makeWASocket({
    url: 'http://localhost:5342',
    apiKey: 'sua-api-key',
    webhookUrl: 'http://seu-servidor.com/webhook'
});

// Aguardar inicialização
await sock.waitForInit();

// Escutar eventos
sock.ev.on('connection.update', (update) => {
    if (update.qrCode) {
        console.log('Escaneie o QR Code:', update.qrCode);
    }
    if (update.connection === 'open') {
        console.log('Conectado!');
    }
});

// Enviar mensagem
await sock.sendMessage('5511999999999@s.whatsapp.net', {
    text: 'Olá do VEX SDK!'
});
```

## Configuração

### VexClientConfig

| Propriedade | Tipo | Obrigatório | Descrição |
|-------------|------|-------------|-----------|
| `url` | `string` | Sim | URL do VEX Microservice |
| `apiKey` | `string` | Sim | Chave de API (API_SECRET_KEY) |
| `webhookUrl` | `string` | Sim | URL para receber eventos via webhook |
| `token` | `string` | Não | UUID de sessão existente (para reconectar) |
| `webhookSecret` | `string` | Não | Secret para validação do webhook |
| `metadata` | `object` | Não | Metadados customizados da sessão |
| `retry.maxRetries` | `number` | Não | Máximo de tentativas (padrão: 5) |
| `retry.baseDelay` | `number` | Não | Delay base em ms (padrão: 1000) |

### Exemplo Completo de Configuração

```typescript
const sock = makeWASocket({
    url: 'http://localhost:5342',
    apiKey: process.env.VEX_API_KEY,
    webhookUrl: 'https://meu-app.com/webhook',
    webhookSecret: 'meu-secret-seguro',
    token: 'uuid-sessao-existente', // opcional
    metadata: {
        empresa: 'Minha Empresa',
        plano: 'premium'
    },
    retry: {
        maxRetries: 3,
        baseDelay: 2000
    }
});
```

## Propriedades do Cliente

| Propriedade | Tipo | Descrição |
|-------------|------|-----------|
| `ev` | `EventEmitter` | Emissor de eventos compatível com Baileys |
| `user` | `{ id: string; name?: string }` | Dados do usuário conectado |
| `sessionId` | `string` | UUID da sessão |
| `connectionStatus` | `'connecting' \| 'open' \| 'close' \| 'qrcode'` | Status da conexão |

---

## Métodos

### Sessão

#### `waitForInit(): Promise<void>`
Aguarda a inicialização completa do cliente.

```typescript
await sock.waitForInit();
console.log('Cliente inicializado!');
```

#### `reconnect(): Promise<void>`
Reconecta uma sessão existente.

```typescript
await sock.reconnect();
```

#### `logout(): Promise<void>`
Desconecta e invalida a sessão.

```typescript
await sock.logout();
```

#### `getSessionInfo(): Promise<SessionInfo | null>`
Obtém informações da sessão atual.

```typescript
const info = await sock.getSessionInfo();
console.log(info);
// {
//   sessionUUID: 'abc-123',
//   status: 'connected',
//   phoneNumber: '5511999999999',
//   isConnected: true,
//   lastActivity: '2024-01-15T10:30:00Z',
//   reconnectCount: 0
// }
```

#### `getStats(): Promise<SessionStats | null>`
Obtém estatísticas do SQLite da sessão.

```typescript
const stats = await sock.getStats();
console.log(stats);
// {
//   pre_keys: 100,
//   sender_keys: 50,
//   sessions: 25,
//   db_size_mb: '2.5'
// }
```

#### `forceCleanup(): Promise<CleanupResult | null>`
Força limpeza de credenciais antigas.

```typescript
const result = await sock.forceCleanup();
console.log(`Removidos: ${result.total} registros`);
```

---

### Mensagens

#### `sendMessage(jid, content, options?): Promise<WebMessageInfo>`
Envia uma mensagem para um contato ou grupo.

```typescript
// Texto simples
await sock.sendMessage('5511999999999@s.whatsapp.net', {
    text: 'Olá!'
});

// Imagem
await sock.sendMessage('5511999999999@s.whatsapp.net', {
    image: { url: 'https://exemplo.com/imagem.jpg' },
    caption: 'Veja esta imagem!'
});

// Documento
await sock.sendMessage('5511999999999@s.whatsapp.net', {
    document: { url: 'https://exemplo.com/arquivo.pdf' },
    fileName: 'documento.pdf',
    mimetype: 'application/pdf'
});

// Áudio
await sock.sendMessage('5511999999999@s.whatsapp.net', {
    audio: { url: 'https://exemplo.com/audio.mp3' },
    mimetype: 'audio/mp3'
});

// Localização
await sock.sendMessage('5511999999999@s.whatsapp.net', {
    location: {
        degreesLatitude: -23.5505,
        degreesLongitude: -46.6333
    }
});

// Contato
await sock.sendMessage('5511999999999@s.whatsapp.net', {
    contacts: {
        displayName: 'João Silva',
        contacts: [{
            vcard: 'BEGIN:VCARD\nVERSION:3.0\nFN:João Silva\nTEL:+5511999999999\nEND:VCARD'
        }]
    }
});

// Responder mensagem
await sock.sendMessage('5511999999999@s.whatsapp.net', {
    text: 'Esta é uma resposta!'
}, {
    quoted: mensagemOriginal
});
```

#### `sendText(jid, text): Promise<WebMessageInfo>`
Atalho para enviar texto simples.

```typescript
await sock.sendText('5511999999999@s.whatsapp.net', 'Mensagem rápida!');
```

#### `readMessages(keys): Promise<void>`
Marca mensagens como lidas.

```typescript
await sock.readMessages([
    {
        remoteJid: '5511999999999@s.whatsapp.net',
        id: 'ABC123',
        fromMe: false
    }
]);
```

#### `sendReaction(jid, messageId, emoji, fromMe?): Promise<void>`
Reage a uma mensagem com emoji.

```typescript
// Adicionar reação
await sock.sendReaction(
    '5511999999999@s.whatsapp.net',
    'ABC123',
    '👍'
);

// Remover reação
await sock.sendReaction(
    '5511999999999@s.whatsapp.net',
    'ABC123',
    '' // string vazia remove
);
```

#### `deleteMessage(jid, messageId, fromMe?, forEveryone?): Promise<void>`
Deleta uma mensagem.

```typescript
// Deletar para todos
await sock.deleteMessage(
    '5511999999999@s.whatsapp.net',
    'ABC123',
    true,  // fromMe
    true   // forEveryone
);

// Deletar só para mim
await sock.deleteMessage(
    '5511999999999@s.whatsapp.net',
    'ABC123',
    false, // fromMe
    false  // forEveryone
);
```

---

### Contatos

#### `onWhatsApp(...jids): Promise<{ exists: boolean; jid: string }[]>`
Verifica se números existem no WhatsApp.

```typescript
const results = await sock.onWhatsApp(
    '5511999999999',
    '5511888888888@s.whatsapp.net'
);

results.forEach(r => {
    console.log(`${r.jid}: ${r.exists ? 'Existe' : 'Não existe'}`);
});
```

#### `getContacts(options?): Promise<{ total: number; contacts: Contact[] }>`
Lista todos os contatos sincronizados.

```typescript
// Todos os contatos
const { contacts, total } = await sock.getContacts();

// Com paginação
const page = await sock.getContacts({
    limit: 50,
    offset: 0,
    search: 'João'
});
```

#### `getContact(contactId): Promise<Contact | null>`
Obtém um contato específico.

```typescript
const contact = await sock.getContact('5511999999999@s.whatsapp.net');
console.log(contact?.name);
```

#### `profilePictureUrl(jid, type?): Promise<string | undefined>`
Obtém URL da foto de perfil.

```typescript
// Thumbnail (mais rápido)
const thumbUrl = await sock.profilePictureUrl('5511999999999@s.whatsapp.net', 'preview');

// Imagem completa
const fullUrl = await sock.profilePictureUrl('5511999999999@s.whatsapp.net', 'image');
```

#### `updateProfilePicture(jid, content): Promise<void>`
Atualiza foto de perfil (própria ou de grupo se admin).

```typescript
await sock.updateProfilePicture('5511999999999@s.whatsapp.net', {
    url: 'https://exemplo.com/nova-foto.jpg'
});
```

#### `fetchStatus(jid): Promise<{ status: string; setAt: Date } | undefined>`
Obtém o status/recado de um contato.

```typescript
const status = await sock.fetchStatus('5511999999999@s.whatsapp.net');
console.log(status?.status); // "Disponível"
```

#### `updateBlockStatus(jid, action): Promise<void>`
Bloqueia ou desbloqueia um contato.

```typescript
// Bloquear
await sock.updateBlockStatus('5511999999999@s.whatsapp.net', 'block');

// Desbloquear
await sock.updateBlockStatus('5511999999999@s.whatsapp.net', 'unblock');
```

#### `getBusinessProfile(jid): Promise<unknown>`
Obtém perfil comercial de conta business.

```typescript
const profile = await sock.getBusinessProfile('5511999999999@s.whatsapp.net');
console.log(profile);
```

---

### Presença

#### `sendPresenceUpdate(type, jid?): Promise<void>`
Atualiza status de presença.

```typescript
// Online globalmente
await sock.sendPresenceUpdate('available');

// Offline
await sock.sendPresenceUpdate('unavailable');

// Digitando em chat específico
await sock.sendPresenceUpdate('composing', '5511999999999@s.whatsapp.net');

// Gravando áudio
await sock.sendPresenceUpdate('recording', '5511999999999@s.whatsapp.net');

// Parou de digitar
await sock.sendPresenceUpdate('paused', '5511999999999@s.whatsapp.net');
```

#### `presenceSubscribe(jid): Promise<void>`
Inscreve para receber atualizações de presença de um contato.

```typescript
await sock.presenceSubscribe('5511999999999@s.whatsapp.net');

// Agora você receberá eventos presence.update para este contato
sock.ev.on('presence.update', (update) => {
    console.log(`${update.id} está ${update.presences[update.id].lastKnownPresence}`);
});
```

---

### Chats

#### `chatModify(modification, jid): Promise<void>`
Modifica configurações de um chat.

```typescript
// Arquivar
await sock.chatModify({ archive: true }, '5511999999999@s.whatsapp.net');

// Desarquivar
await sock.chatModify({ archive: false }, '5511999999999@s.whatsapp.net');

// Silenciar por 8 horas
await sock.chatModify({ mute: 8 * 60 * 60 * 1000 }, '5511999999999@s.whatsapp.net');

// Remover silenciamento
await sock.chatModify({ mute: null }, '5511999999999@s.whatsapp.net');

// Fixar chat
await sock.chatModify({ pin: true }, '5511999999999@s.whatsapp.net');

// Desafixar
await sock.chatModify({ pin: false }, '5511999999999@s.whatsapp.net');
```

---

### Grupos

#### `groupFetchAllParticipating(): Promise<{ [jid: string]: GroupMetadata }>`
Lista todos os grupos que você participa.

```typescript
const groups = await sock.groupFetchAllParticipating();

Object.entries(groups).forEach(([jid, metadata]) => {
    console.log(`${metadata.subject}: ${metadata.participants.length} membros`);
});
```

#### `groupMetadata(jid): Promise<GroupMetadata>`
Obtém metadados detalhados de um grupo.

```typescript
const group = await sock.groupMetadata('123456789@g.us');
console.log({
    nome: group.subject,
    descricao: group.desc,
    criador: group.owner,
    membros: group.participants.length
});
```

#### `groupCreate(subject, participants): Promise<GroupMetadata>`
Cria um novo grupo.

```typescript
const novoGrupo = await sock.groupCreate('Meu Novo Grupo', [
    '5511999999999@s.whatsapp.net',
    '5511888888888@s.whatsapp.net'
]);

console.log(`Grupo criado: ${novoGrupo.id}`);
```

#### `groupUpdateSubject(jid, subject): Promise<void>`
Atualiza o nome do grupo.

```typescript
await sock.groupUpdateSubject('123456789@g.us', 'Novo Nome do Grupo');
```

#### `groupUpdateDescription(jid, description): Promise<void>`
Atualiza a descrição do grupo.

```typescript
await sock.groupUpdateDescription('123456789@g.us', 'Nova descrição do grupo');
```

#### `groupSettingUpdate(jid, setting): Promise<void>`
Atualiza configurações do grupo.

```typescript
// Apenas admins podem enviar mensagens
await sock.groupSettingUpdate('123456789@g.us', 'announcement');

// Todos podem enviar mensagens
await sock.groupSettingUpdate('123456789@g.us', 'not_announcement');

// Apenas admins podem editar dados do grupo
await sock.groupSettingUpdate('123456789@g.us', 'locked');

// Todos podem editar dados do grupo
await sock.groupSettingUpdate('123456789@g.us', 'unlocked');
```

#### `groupParticipantsUpdate(jid, participants, action): Promise<{ status: string; jid: string }[]>`
Gerencia participantes do grupo.

```typescript
// Adicionar membros
await sock.groupParticipantsUpdate(
    '123456789@g.us',
    ['5511999999999@s.whatsapp.net'],
    'add'
);

// Remover membros
await sock.groupParticipantsUpdate(
    '123456789@g.us',
    ['5511999999999@s.whatsapp.net'],
    'remove'
);

// Promover a admin
await sock.groupParticipantsUpdate(
    '123456789@g.us',
    ['5511999999999@s.whatsapp.net'],
    'promote'
);

// Remover admin
await sock.groupParticipantsUpdate(
    '123456789@g.us',
    ['5511999999999@s.whatsapp.net'],
    'demote'
);
```

#### `groupLeave(jid): Promise<void>`
Sai de um grupo.

```typescript
await sock.groupLeave('123456789@g.us');
```

#### `groupInviteCode(jid): Promise<string>`
Obtém código de convite do grupo.

```typescript
const code = await sock.groupInviteCode('123456789@g.us');
console.log(`Link: https://chat.whatsapp.com/${code}`);
```

#### `groupRevokeInvite(jid): Promise<string>`
Revoga o código de convite e gera um novo.

```typescript
const newCode = await sock.groupRevokeInvite('123456789@g.us');
console.log(`Novo link: https://chat.whatsapp.com/${newCode}`);
```

#### `groupAcceptInvite(code): Promise<string>`
Entra em um grupo usando código de convite.

```typescript
// Pode passar o código ou URL completa
const groupJid = await sock.groupAcceptInvite('AbCdEfGhIjK');
// ou
const groupJid = await sock.groupAcceptInvite('https://chat.whatsapp.com/AbCdEfGhIjK');
```

---

## Eventos

O SDK emite eventos compatíveis com Baileys através do `sock.ev`.

### connection.update
Atualização de status da conexão.

```typescript
sock.ev.on('connection.update', (update) => {
    const { connection, qrCode, lastDisconnect } = update;

    if (qrCode) {
        // Exibir QR Code para escanear
        console.log('QR:', qrCode);
    }

    if (connection === 'open') {
        console.log('Conectado!');
    }

    if (connection === 'close') {
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== 401;
        if (shouldReconnect) {
            sock.reconnect();
        }
    }
});
```

### messages.upsert
Novas mensagens recebidas.

```typescript
sock.ev.on('messages.upsert', ({ messages, type }) => {
    for (const msg of messages) {
        if (msg.key.fromMe) continue; // Ignorar mensagens próprias

        console.log('Nova mensagem:', msg.message?.conversation);

        // Responder
        await sock.sendMessage(msg.key.remoteJid, {
            text: 'Mensagem recebida!'
        });
    }
});
```

### messages.update
Atualizações de status de mensagens.

```typescript
sock.ev.on('messages.update', (updates) => {
    for (const update of updates) {
        console.log(`Mensagem ${update.key.id}: status ${update.update.status}`);
    }
});
```

### presence.update
Atualizações de presença.

```typescript
sock.ev.on('presence.update', (update) => {
    const presence = update.presences[update.id];
    console.log(`${update.id} está ${presence.lastKnownPresence}`);
});
```

### groups.update
Atualizações de grupos.

```typescript
sock.ev.on('groups.update', (updates) => {
    for (const update of updates) {
        console.log(`Grupo ${update.id} atualizado:`, update);
    }
});
```

### group-participants.update
Alterações em participantes de grupos.

```typescript
sock.ev.on('group-participants.update', (update) => {
    console.log(`${update.action} em ${update.id}:`, update.participants);
});
```

---

## Recebendo Webhooks

O VEX Server envia eventos via webhook para a URL configurada. Seu servidor deve receber esses eventos e injetá-los no SDK.

### Exemplo com Express

```typescript
import express from 'express';
import { makeWASocket, WebhookParser } from '@vex/client-sdk';

const app = express();
app.use(express.json());

const sock = makeWASocket({
    url: 'http://vex-server:5342',
    apiKey: 'minha-api-key',
    webhookUrl: 'http://meu-servidor:3000/webhook'
});

// Endpoint para receber webhooks do VEX
app.post('/webhook', (req, res) => {
    const { event, data, sessionUUID, secret } = req.body;

    // Validar secret (opcional mas recomendado)
    if (secret !== 'minha-api-key') {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    // Injetar evento no SDK
    sock.injectEvent(event, data);

    res.json({ received: true });
});

app.listen(3000);
```

---

## Tratamento de Erros

O SDK lança `VexApiError` para erros de API.

```typescript
import { VexApiError } from '@vex/client-sdk';

try {
    await sock.sendMessage('numero-invalido', { text: 'Teste' });
} catch (error) {
    if (error instanceof VexApiError) {
        console.error(`Erro ${error.statusCode}: ${error.message}`);
        console.error('Resposta:', error.response);
    } else {
        throw error;
    }
}
```

---

## Tipos Exportados

```typescript
import {
    VexClient,
    VexClientConfig,
    makeWASocket,
    WebhookParser,
    HttpClient,
    HttpClientConfig,
    VexApiError,
    Contact,
    GetContactsOptions,
    SessionStats,
    CleanupResult,
    ConnectionStatus,
    WABotEvents
} from '@vex/client-sdk';
```

---

## Playground

Execute o playground visual para testar a conexão:

```bash
npm run playground
```

Acesse `http://localhost:8080/playground.html` no navegador.

---

## Licença

MIT
