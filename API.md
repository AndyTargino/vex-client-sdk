# Documentação da API e Funcionalidades

Este documento detalha a paridade de funcionalidades entre o **VEX Client SDK** e a biblioteca original **Baileys**. O SDK foi projetado para suportar os métodos mais utilizados em automações profissionais.

## 📱 Métodos da Instância (`sock`)

### 1. Mensagens (`sendMessage`)

Envia mensagens de texto, mídia, botões, templates, etc. O payload é convertido e enviado para a rota `POST /sessions/:id/messages`.

```typescript
// Assinatura
sock.sendMessage(jid: string, content: AnyMessageContent, options?: MiscMessageGenerationOptions)

// Exemplo
await sock.sendMessage('5511999999999@s.whatsapp.net', { 
    text: "Olá mundo!",
    mentions: ['5511888888888@s.whatsapp.net']
});
```
**Suporte:** Texto, Imagem, Vídeo, Áudio, Documentos, Stickes, Locations, Contacts.

---

### 2. Gestão de Grupos

Métodos para administração de grupos, mapeados para rotas REST específicas.

| Método SDK | Rota VEX | Descrição |
|------------|----------|-----------|
| `groupFetchAllParticipating()` | `GET /groups` | Retorna todos os grupos que o bot participa. |
| `groupMetadata(jid)` | `GET /groups/:jid` | Obtém metadados (título, part., desc.) de um grupo. |
| `groupCreate(subject, participants)` | `POST /groups` | Cria um novo grupo. |
| `groupUpdateSubject(jid, subject)` | `PUT /groups/:jid/subject` | Atualiza o título do grupo. |
| `groupSettingUpdate(jid, settings)` | `PUT /groups/:jid/settings` | Altera configs (apenas admins, etc). |
| `groupParticipantsUpdate(jid, part, action)` | `POST /groups/:jid/participants` | Adiciona, remove, promove ou rebaixa participantes. |

**Exemplo:**
```typescript
// Criar grupo
const group = await sock.groupCreate("Meu Grupo VEX", ["5511999999999@s.whatsapp.net"]);
console.log("Grupo criado com ID:", group.id);

// Promover admin
await sock.groupParticipantsUpdate(group.id, ["5511999999999@s.whatsapp.net"], "promote");
```

---

### 3. Perfil e Contatos

Métodos para gerenciar fotos de perfil e verificar existência de números.

| Método SDK | Rota VEX | Descrição |
|------------|----------|-----------|
| `profilePictureUrl(jid, type)` | `GET /contacts/:jid/profile-picture` | Obtém URL da foto de perfil. |
| `updateProfilePicture(jid, url)` | `POST /contacts/:jid/profile-picture` | Atualiza a foto de perfil/grupo. |
| `onWhatsApp(jid)` | `POST /contacts/check` | Verifica se o número tem WhatsApp. |

**Exemplo:**
```typescript
const [result] = await sock.onWhatsApp("5511999999999@s.whatsapp.net");
if (result.exists) {
    const picUrl = await sock.profilePictureUrl(result.jid, "image");
}
```

---

### 4. Propriedades da Instância

Propriedades estáticas ou de estado mantidas para compatibilidade com código legado.

- **`sock.user`**: `{ id: "...", name: "..." }` - Dados do usuário conectado.
- **`sock.id`**: Alias para o JID do bot.
- **`sock.type`**: "md" (Multi-Device).
- **`sock.ws`**: Mock do WebSocket (contém métodos vazios `on`, `off`, `close` para evitar quebras).

---

## 📡 Eventos (`ev`)

O SDK possui um `EventEmitter` interno (`sock.ev`) que deve ser alimentado externamente. Diferente do Baileys original que recebe eventos via WebSocket direto, o VEX SDK depende que sua aplicação receba o Webhook e injete o evento.

### Injetando Eventos

Seu servidor HTTP (Express/Fastify) recebe o POST do VEX Microservice e repassa para o SDK:

```typescript
// No seu controller de Webhook
app.post('/webhook', (req, res) => {
    const { event, data, sessionUUID } = req.body;
    
    // Recupera a instância do SDK correspondente à sessão
    const sock = getSessionClient(sessionUUID); 
    
    if (sock) {
        // Mágica acontece aqui: Injeta o evento no ev.on
        sock.injectEvent(event, data);
    }
    
    res.sendStatus(200);
});
```

### Eventos Suportados

Todos os eventos do `BaileysEventMap` são suportados, pois o sistema é agnóstico. Os principais são:

- `messages.upsert`: Novas mensagens recebidas.
- `messages.update`: Atualizações de status (entregue, lido).
- `groups.upsert`: Novos grupos adicionados.
- `groups.update`: Alterações em grupos.
- `connection.update`: Mudanças no estado da conexão (QR Code, Conectado, Desconectado).

---

## ⚠️ Tratamento de Erros e Retries

O SDK foi construído para alta resiliência. Todas as chamadas de API (Messages, Groups, Profile) passam por um `HttpClient` robusto:

1.  **5 Tentativas:** Cada requisição falha tenta mais 4 vezes.
2.  **Backoff Exponencial:** O tempo entre tentativas aumenta progressivamente.
3.  **Condições:** Retries ocorrem em falhas de rede (timeout, desconexão) e erros de servidor (5xx).
4.  **Falha Final:** Apenas após a 5ª tentativa falha o erro é disparado para o código principal (permitindo que `try/catch` do usuário trate).
