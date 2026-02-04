# VEX Client SDK

Baileys-compatible SDK client for connecting to VEX WhatsApp Microservice. Integrate your applications with WhatsApp in a simple and scalable way, using the same Baileys interface you already know.

> **Server Access:** The VEX Server (backend with Baileys) is a private service. To get access to the server that powers this SDK, please contact: **andytargino@outlook.com**

## Features

- **Socket.IO Real-time:** Primary event delivery via WebSocket (lowest latency)
- **HTTP Polling Fallback:** Automatic fallback when Socket.IO fails
- **Optional Webhooks:** Traditional webhook delivery for serverless environments
- **Baileys Compatible:** Same interface and events as Baileys
- **Large File Support:** Send files up to 500MB via base64
- **Auto-reconnection:** Exponential backoff with configurable attempts

## Installation

```bash
# From GitHub (recommended)
npm install github:AndyTargino/vex-client-sdk

# Specific version
npm install github:AndyTargino/vex-client-sdk#v1.2.0
```

## Quick Start

### Simple Mode (Socket.IO + Polling)

No webhook server required - events are received via Socket.IO with HTTP polling fallback.

```typescript
import { makeWASocket } from '@vex/client-sdk';

// Create VEX client - no backendUrl needed
const sock = makeWASocket({
    url: 'https://your-vex-server.com',
    apiKey: 'your-api-key'
});

// Wait for initialization
await sock.waitForInit();

// Listen to events (received via Socket.IO)
sock.ev.on('connection.update', (update) => {
    if (update.qrCode) {
        console.log('Scan the QR Code:', update.qrCode);
    }
    if (update.connection === 'open') {
        console.log('Connected!');
    }
});

sock.ev.on('messages.upsert', ({ messages }) => {
    console.log('New message:', messages[0]);
});

// Send a message
await sock.sendMessage('5511999999999@s.whatsapp.net', {
    text: 'Hello from VEX SDK!'
});
```

### With Webhooks (Optional)

For serverless environments or when you need webhook delivery:

```typescript
const sock = makeWASocket({
    url: 'https://your-vex-server.com',
    apiKey: 'your-api-key',
    backendUrl: 'https://your-app.com'  // Webhooks sent to /api/v1/vex/webhooks
});
```

## Configuration

### VexClientConfig

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `url` | `string` | Yes | VEX Microservice URL |
| `apiKey` | `string` | Yes | API Key (API_SECRET_KEY) |
| `backendUrl` | `string` | No | Your backend URL for webhooks (optional) |
| `token` | `string` | No | Existing session UUID (for reconnection) |
| `metadata` | `object` | No | Custom session metadata |
| `pollingInterval` | `number` | No | Polling interval in ms (default: 5000) |

### Socket.IO Configuration

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `socketIO.enabled` | `boolean` | `true` | Enable Socket.IO for real-time events |
| `socketIO.connectionTimeout` | `number` | `60000` | Connection timeout in ms |
| `socketIO.autoReconnect` | `boolean` | `true` | Enable auto-reconnection |
| `socketIO.maxReconnectAttempts` | `number` | `Infinity` | Max reconnection attempts |
| `socketIO.reconnectDelay` | `number` | `1000` | Base delay between reconnections |
| `socketIO.maxReconnectDelay` | `number` | `30000` | Max delay between reconnections |

### Full Configuration Example

```typescript
const sock = makeWASocket({
    url: 'https://your-vex-server.com',
    apiKey: process.env.VEX_API_KEY,
    token: 'existing-session-uuid',
    metadata: {
        company: 'My Company',
        plan: 'premium'
    },
    retry: {
        maxRetries: 3,
        baseDelay: 2000
    },
    socketIO: {
        enabled: true,
        connectionTimeout: 60000,
        autoReconnect: true,
        maxReconnectAttempts: 100,
        reconnectDelay: 1000,
        maxReconnectDelay: 30000
    },
    pollingInterval: 5000
});
```

## Event Delivery Modes

The SDK supports three event delivery modes, used in this priority order:

### 1. Socket.IO (Primary - Recommended)
- **Latency:** ~50ms
- **Setup:** Automatic, no configuration needed
- **Use case:** Best for all scenarios, lowest latency

### 2. HTTP Polling (Fallback)
- **Latency:** Depends on `pollingInterval` (default 5s)
- **Setup:** Automatic fallback when Socket.IO fails
- **Use case:** Firewall restrictions, network issues

### 3. Webhooks (Optional)
- **Latency:** ~100-500ms
- **Setup:** Requires `backendUrl` and exposed endpoint
- **Use case:** Serverless environments, event persistence

## Client Properties

| Property | Type | Description |
|----------|------|-------------|
| `ev` | `EventEmitter` | Baileys-compatible event emitter |
| `user` | `{ id: string; name?: string }` | Connected user data |
| `sessionId` | `string` | Session UUID |
| `connectionStatus` | `'connecting' \| 'open' \| 'close' \| 'qrcode'` | Connection status |
| `isSocketConnected` | `boolean` | Socket.IO connection status |

---

## Methods

### Session

#### `waitForInit(): Promise<void>`
Wait for complete client initialization.

```typescript
await sock.waitForInit();
console.log('Client initialized!');
```

#### `reconnect(): Promise<void>`
Reconnect an existing session.

```typescript
await sock.reconnect();
```

#### `logout(): Promise<void>`
Disconnect and invalidate the session.

```typescript
await sock.logout();
```

#### `getSessionInfo(): Promise<SessionInfo | null>`
Get current session information.

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
Get session SQLite statistics.

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
Force cleanup of old credentials.

```typescript
const result = await sock.forceCleanup();
console.log(`Removed: ${result.total} records`);
```

---

### Messages

#### `sendMessage(jid, content, options?): Promise<WebMessageInfo>`
Send a message via HTTP (compatible with Baileys).

```typescript
// Simple text
await sock.sendMessage('5511999999999@s.whatsapp.net', {
    text: 'Hello!'
});

// Image with URL
await sock.sendMessage('5511999999999@s.whatsapp.net', {
    image: { url: 'https://example.com/image.jpg' },
    caption: 'Check this image!'
});

// Document
await sock.sendMessage('5511999999999@s.whatsapp.net', {
    document: { url: 'https://example.com/file.pdf' },
    fileName: 'document.pdf',
    mimetype: 'application/pdf'
});

// Reply to message
await sock.sendMessage('5511999999999@s.whatsapp.net', {
    text: 'This is a reply!'
}, {
    quoted: originalMessage
});
```

#### `sendMessageFast(jid, message, timeout?): Promise<{ success: boolean; messageId?: string; error?: string }>`
Send message via Socket.IO for faster delivery. Supports large files up to 500MB via base64.

```typescript
// Send text fast
await sock.sendMessageFast('5511999999999@s.whatsapp.net', {
    text: 'Fast message!'
});

// Send image with base64 (faster than URL)
await sock.sendMessageFast('5511999999999@s.whatsapp.net', {
    image: {
        base64: imageBase64,
        mimetype: 'image/jpeg',
        caption: 'Photo!'
    }
});

// Send large document (up to 500MB)
await sock.sendMessageFast('5511999999999@s.whatsapp.net', {
    document: {
        base64: fileBase64,
        filename: 'Report Q1 2026.pdf',  // Filename preserved!
        mimetype: 'application/pdf'
    }
}, 600000); // 10 minute timeout for large files
```

#### `sendText(jid, text): Promise<WebMessageInfo>`
Shortcut for sending plain text.

```typescript
await sock.sendText('5511999999999@s.whatsapp.net', 'Quick message!');
```

#### `sendImage(jid, image, caption?): Promise<{ success: boolean; messageId?: string }>`
Send image via Socket.IO.

```typescript
// Via URL
await sock.sendImage('5511999999999@s.whatsapp.net', { url: 'https://example.com/image.jpg' }, 'Caption');

// Via base64
await sock.sendImage('5511999999999@s.whatsapp.net', {
    base64: imageBase64,
    mimetype: 'image/jpeg'
}, 'Photo caption');
```

#### `sendDocument(jid, document, filename, mimetype?): Promise<{ success: boolean; messageId?: string }>`
Send document via Socket.IO.

```typescript
// Via URL
await sock.sendDocument('5511999999999@s.whatsapp.net', { url: 'https://example.com/file.pdf' }, 'report.pdf');

// Via base64 (supports up to 500MB)
await sock.sendDocument('5511999999999@s.whatsapp.net', { base64: fileBase64 }, 'Report.pdf', 'application/pdf');
```

#### `sendAudio(jid, audio, ptt?): Promise<{ success: boolean; messageId?: string }>`
Send audio via Socket.IO.

```typescript
// Normal audio
await sock.sendAudio('5511999999999@s.whatsapp.net', { url: 'https://example.com/audio.mp3' });

// Voice message (PTT)
await sock.sendAudio('5511999999999@s.whatsapp.net', { base64: audioBase64, mimetype: 'audio/ogg' }, true);
```

#### `sendVideo(jid, video, caption?): Promise<{ success: boolean; messageId?: string }>`
Send video via Socket.IO.

```typescript
await sock.sendVideo('5511999999999@s.whatsapp.net', {
    base64: videoBase64,
    mimetype: 'video/mp4'
}, 'Check this video!');
```

#### `sendSticker(jid, sticker): Promise<{ success: boolean; messageId?: string }>`
Send sticker via Socket.IO.

```typescript
await sock.sendSticker('5511999999999@s.whatsapp.net', { base64: stickerBase64, mimetype: 'image/webp' });
```

#### `readMessages(keys): Promise<void>`
Mark messages as read.

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
React to a message with an emoji.

```typescript
// Add reaction
await sock.sendReaction('5511999999999@s.whatsapp.net', 'ABC123', '👍');

// Remove reaction
await sock.sendReaction('5511999999999@s.whatsapp.net', 'ABC123', '');
```

#### `deleteMessage(jid, messageId, fromMe?, forEveryone?): Promise<void>`
Delete a message.

```typescript
// Delete for everyone
await sock.deleteMessage('5511999999999@s.whatsapp.net', 'ABC123', true, true);

// Delete only for me
await sock.deleteMessage('5511999999999@s.whatsapp.net', 'ABC123', false, false);
```

---

### Contacts

#### `onWhatsApp(...jids): Promise<{ exists: boolean; jid: string }[]>`
Check if phone numbers exist on WhatsApp.

```typescript
const results = await sock.onWhatsApp('5511999999999', '5511888888888');
results.forEach(r => {
    console.log(`${r.jid}: ${r.exists ? 'Exists' : 'Does not exist'}`);
});
```

#### `getContacts(options?): Promise<{ total: number; contacts: Contact[] }>`
List all synced contacts.

```typescript
// All contacts
const { contacts, total } = await sock.getContacts();

// With pagination
const page = await sock.getContacts({
    limit: 50,
    offset: 0,
    search: 'John'
});
```

#### `getContact(contactId): Promise<Contact | null>`
Get a specific contact.

```typescript
const contact = await sock.getContact('5511999999999@s.whatsapp.net');
console.log(contact?.name);
```

#### `profilePictureUrl(jid, type?): Promise<string | undefined>`
Get profile picture URL.

```typescript
// Thumbnail (faster)
const thumbUrl = await sock.profilePictureUrl('5511999999999@s.whatsapp.net', 'preview');

// Full image
const fullUrl = await sock.profilePictureUrl('5511999999999@s.whatsapp.net', 'image');
```

#### `updateProfilePicture(jid, content): Promise<void>`
Update profile picture (own or group if admin).

```typescript
await sock.updateProfilePicture('5511999999999@s.whatsapp.net', {
    url: 'https://example.com/new-photo.jpg'
});
```

#### `fetchStatus(jid): Promise<{ status: string; setAt: Date } | undefined>`
Get a contact's status/about.

```typescript
const status = await sock.fetchStatus('5511999999999@s.whatsapp.net');
console.log(status?.status); // "Available"
```

#### `updateBlockStatus(jid, action): Promise<void>`
Block or unblock a contact.

```typescript
await sock.updateBlockStatus('5511999999999@s.whatsapp.net', 'block');
await sock.updateBlockStatus('5511999999999@s.whatsapp.net', 'unblock');
```

#### `getBusinessProfile(jid): Promise<unknown>`
Get business profile of a business account.

```typescript
const profile = await sock.getBusinessProfile('5511999999999@s.whatsapp.net');
```

---

### Presence

#### `sendPresenceUpdate(type, jid?): Promise<void>`
Update presence status.

```typescript
// Online globally
await sock.sendPresenceUpdate('available');

// Typing in specific chat
await sock.sendPresenceUpdate('composing', '5511999999999@s.whatsapp.net');

// Recording audio
await sock.sendPresenceUpdate('recording', '5511999999999@s.whatsapp.net');

// Stopped typing
await sock.sendPresenceUpdate('paused', '5511999999999@s.whatsapp.net');
```

#### `presenceSubscribe(jid): Promise<void>`
Subscribe to receive presence updates from a contact.

```typescript
await sock.presenceSubscribe('5511999999999@s.whatsapp.net');

sock.ev.on('presence.update', (update) => {
    console.log(`${update.id} is ${update.presences[update.id].lastKnownPresence}`);
});
```

---

### Chats

#### `chatModify(modification, jid): Promise<void>`
Modify chat settings.

```typescript
// Archive/Unarchive
await sock.chatModify({ archive: true }, '5511999999999@s.whatsapp.net');

// Mute for 8 hours
await sock.chatModify({ mute: 8 * 60 * 60 * 1000 }, '5511999999999@s.whatsapp.net');

// Pin/Unpin
await sock.chatModify({ pin: true }, '5511999999999@s.whatsapp.net');
```

---

### Groups

#### `groupFetchAllParticipating(): Promise<{ [jid: string]: GroupMetadata }>`
List all groups you participate in.

```typescript
const groups = await sock.groupFetchAllParticipating();
Object.entries(groups).forEach(([jid, metadata]) => {
    console.log(`${metadata.subject}: ${metadata.participants.length} members`);
});
```

#### `groupMetadata(jid): Promise<GroupMetadata>`
Get detailed group metadata.

```typescript
const group = await sock.groupMetadata('123456789@g.us');
console.log({
    name: group.subject,
    description: group.desc,
    members: group.participants.length
});
```

#### `groupCreate(subject, participants): Promise<GroupMetadata>`
Create a new group.

```typescript
const newGroup = await sock.groupCreate('My New Group', [
    '5511999999999@s.whatsapp.net',
    '5511888888888@s.whatsapp.net'
]);
console.log(`Group created: ${newGroup.id}`);
```

#### `groupUpdateSubject(jid, subject): Promise<void>`
Update group name.

```typescript
await sock.groupUpdateSubject('123456789@g.us', 'New Group Name');
```

#### `groupUpdateDescription(jid, description): Promise<void>`
Update group description.

```typescript
await sock.groupUpdateDescription('123456789@g.us', 'New description');
```

#### `groupSettingUpdate(jid, setting): Promise<void>`
Update group settings.

```typescript
// Only admins can send messages
await sock.groupSettingUpdate('123456789@g.us', 'announcement');

// Everyone can send messages
await sock.groupSettingUpdate('123456789@g.us', 'not_announcement');
```

#### `groupParticipantsUpdate(jid, participants, action): Promise<{ status: string; jid: string }[]>`
Manage group participants.

```typescript
await sock.groupParticipantsUpdate('123456789@g.us', ['5511999999999@s.whatsapp.net'], 'add');
await sock.groupParticipantsUpdate('123456789@g.us', ['5511999999999@s.whatsapp.net'], 'remove');
await sock.groupParticipantsUpdate('123456789@g.us', ['5511999999999@s.whatsapp.net'], 'promote');
await sock.groupParticipantsUpdate('123456789@g.us', ['5511999999999@s.whatsapp.net'], 'demote');
```

#### `groupLeave(jid): Promise<void>`
Leave a group.

```typescript
await sock.groupLeave('123456789@g.us');
```

#### `groupInviteCode(jid): Promise<string>`
Get group invite code.

```typescript
const code = await sock.groupInviteCode('123456789@g.us');
console.log(`Link: https://chat.whatsapp.com/${code}`);
```

#### `groupRevokeInvite(jid): Promise<string>`
Revoke invite code and generate a new one.

```typescript
const newCode = await sock.groupRevokeInvite('123456789@g.us');
```

#### `groupAcceptInvite(code): Promise<string>`
Join a group using invite code.

```typescript
const groupJid = await sock.groupAcceptInvite('AbCdEfGhIjK');
```

---

## Events

The SDK emits Baileys-compatible events through `sock.ev`.

### connection.update
Connection status update.

```typescript
sock.ev.on('connection.update', (update) => {
    const { connection, qrCode, lastDisconnect } = update;

    if (qrCode) {
        console.log('QR:', qrCode);
    }

    if (connection === 'open') {
        console.log('Connected!');
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
New messages received.

```typescript
sock.ev.on('messages.upsert', ({ messages, type }) => {
    for (const msg of messages) {
        if (msg.key.fromMe) continue;
        console.log('New message:', msg.message?.conversation);
    }
});
```

### messages.update
Message status updates (sent, delivered, read).

```typescript
sock.ev.on('messages.update', (updates) => {
    for (const update of updates) {
        console.log(`Message ${update.key.id}: status ${update.update.status}`);
    }
});
```

### presence.update
Presence updates (online, typing, etc).

```typescript
sock.ev.on('presence.update', (update) => {
    const presence = update.presences[update.id];
    console.log(`${update.id} is ${presence.lastKnownPresence}`);
});
```

### All Supported Events

| Event | Description |
|-------|-------------|
| `connection.update` | Connection status changes |
| `messages.upsert` | New messages |
| `messages.update` | Message status updates |
| `messages.delete` | Deleted messages |
| `messages.reaction` | Message reactions |
| `message-receipt.update` | Read receipts |
| `presence.update` | Presence updates |
| `contacts.upsert` | New contacts |
| `contacts.update` | Contact updates |
| `groups.update` | Group updates |
| `groups.upsert` | New groups |
| `group-participants.update` | Participant changes |
| `chats.upsert` | New chats |
| `chats.update` | Chat updates |
| `chats.delete` | Deleted chats |
| `blocklist.set` | Block list set |
| `blocklist.update` | Block list update |
| `labels.edit` | Label edits (Business) |
| `labels.association` | Label associations |
| `messaging-history.set` | History sync |
| `call` | Incoming calls |

---

## Receiving Webhooks (Optional)

If you prefer webhook delivery, your server must expose `/api/v1/vex/webhooks`.

### Express Example

```typescript
import express from 'express';
import { makeWASocket, VEX_WEBHOOK_PATH } from '@vex/client-sdk';

const app = express();
app.use(express.json());

const sock = makeWASocket({
    url: 'https://your-vex-server.com',
    apiKey: 'my-api-key',
    backendUrl: 'https://my-server.com'  // Enables webhook mode
});

// Webhook endpoint
app.post(VEX_WEBHOOK_PATH, (req, res) => {
    const { event, data, sessionUUID } = req.body;
    sock.injectEvent(event, data);
    res.json({ received: true });
});

app.listen(3000);
```

---

## Error Handling

The SDK throws `VexApiError` for API errors.

```typescript
import { VexApiError } from '@vex/client-sdk';

try {
    await sock.sendMessage('invalid-number', { text: 'Test' });
} catch (error) {
    if (error instanceof VexApiError) {
        console.error(`Error ${error.statusCode}: ${error.message}`);
    } else {
        throw error;
    }
}
```

---

## Exported Types

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
    MediaMessageContent,
    WABotEvents,
    SocketConnection,
    SocketConnectionConfig,
    SocketConnectionEvents
} from '@vex/client-sdk';
```

---

## Playground

Run the visual playground to test the connection:

```bash
npm run playground
```

Access `http://localhost:8080/playground.html` in your browser.

---

## Server Access

This SDK connects to a VEX Server instance running Baileys. The server is a private service.

**To get access to the VEX Server, please contact:**

📧 **andytargino@outlook.com**

---

## License

MIT
