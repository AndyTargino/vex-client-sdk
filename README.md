# VEX Client SDK

Baileys-compatible SDK client for connecting to VEX WhatsApp Microservice. Integrate your applications with WhatsApp in a simple and scalable way, using the same Baileys interface you already know.

> **Server Access:** The VEX Server (backend with Baileys) is a private service. To get access to the server that powers this SDK, please contact: **andytargino@outlook.com**

## Installation

```bash
# From GitHub (recommended)
npm install github:AndyTargino/vex-client-sdk

# Specific version
npm install github:AndyTargino/vex-client-sdk#v1.1.0
```

## Quick Start

```typescript
import { makeWASocket, VEX_WEBHOOK_PATH } from '@vex/client-sdk';

// Create VEX client
const sock = makeWASocket({
    url: 'https://your-vex-server.com',
    apiKey: 'your-api-key',
    backendUrl: 'https://your-app.com'  // Webhooks will be sent to /api/v1/vex/webhooks
});

// Wait for initialization
await sock.waitForInit();

// Listen to events
sock.ev.on('connection.update', (update) => {
    if (update.qrCode) {
        console.log('Scan the QR Code:', update.qrCode);
    }
    if (update.connection === 'open') {
        console.log('Connected!');
    }
});

// Send a message
await sock.sendMessage('5511999999999@s.whatsapp.net', {
    text: 'Hello from VEX SDK!'
});
```

## Configuration

### VexClientConfig

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `url` | `string` | Yes | VEX Microservice URL |
| `apiKey` | `string` | Yes | API Key (API_SECRET_KEY) |
| `backendUrl` | `string` | Yes | Your backend base URL (webhooks sent to `/api/v1/vex/webhooks`) |
| `token` | `string` | No | Existing session UUID (for reconnection) |
| `metadata` | `object` | No | Custom session metadata |
| `retry.maxRetries` | `number` | No | Max retry attempts (default: 5) |
| `retry.baseDelay` | `number` | No | Base delay in ms (default: 1000) |

> **IMPORTANT:** The SDK automatically appends `/api/v1/vex/webhooks` to your `backendUrl`. Your backend MUST expose this endpoint to receive VEX events.

### Full Configuration Example

```typescript
const sock = makeWASocket({
    url: 'https://your-vex-server.com',
    apiKey: process.env.VEX_API_KEY,
    backendUrl: 'https://my-app.com',  // Webhooks at: https://my-app.com/api/v1/vex/webhooks
    token: 'existing-session-uuid', // optional
    metadata: {
        company: 'My Company',
        plan: 'premium'
    },
    retry: {
        maxRetries: 3,
        baseDelay: 2000
    }
});
```

## Client Properties

| Property | Type | Description |
|----------|------|-------------|
| `ev` | `EventEmitter` | Baileys-compatible event emitter |
| `user` | `{ id: string; name?: string }` | Connected user data |
| `sessionId` | `string` | Session UUID |
| `connectionStatus` | `'connecting' \| 'open' \| 'close' \| 'qrcode'` | Connection status |

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
Send a message to a contact or group.

```typescript
// Simple text
await sock.sendMessage('5511999999999@s.whatsapp.net', {
    text: 'Hello!'
});

// Image
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

// Audio
await sock.sendMessage('5511999999999@s.whatsapp.net', {
    audio: { url: 'https://example.com/audio.mp3' },
    mimetype: 'audio/mp3'
});

// Location
await sock.sendMessage('5511999999999@s.whatsapp.net', {
    location: {
        degreesLatitude: -23.5505,
        degreesLongitude: -46.6333
    }
});

// Contact
await sock.sendMessage('5511999999999@s.whatsapp.net', {
    contacts: {
        displayName: 'John Doe',
        contacts: [{
            vcard: 'BEGIN:VCARD\nVERSION:3.0\nFN:John Doe\nTEL:+5511999999999\nEND:VCARD'
        }]
    }
});

// Reply to message
await sock.sendMessage('5511999999999@s.whatsapp.net', {
    text: 'This is a reply!'
}, {
    quoted: originalMessage
});
```

#### `sendText(jid, text): Promise<WebMessageInfo>`
Shortcut for sending plain text.

```typescript
await sock.sendText('5511999999999@s.whatsapp.net', 'Quick message!');
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
await sock.sendReaction(
    '5511999999999@s.whatsapp.net',
    'ABC123',
    '👍'
);

// Remove reaction
await sock.sendReaction(
    '5511999999999@s.whatsapp.net',
    'ABC123',
    '' // empty string removes
);
```

#### `deleteMessage(jid, messageId, fromMe?, forEveryone?): Promise<void>`
Delete a message.

```typescript
// Delete for everyone
await sock.deleteMessage(
    '5511999999999@s.whatsapp.net',
    'ABC123',
    true,  // fromMe
    true   // forEveryone
);

// Delete only for me
await sock.deleteMessage(
    '5511999999999@s.whatsapp.net',
    'ABC123',
    false, // fromMe
    false  // forEveryone
);
```

---

### Contacts

#### `onWhatsApp(...jids): Promise<{ exists: boolean; jid: string }[]>`
Check if phone numbers exist on WhatsApp.

```typescript
const results = await sock.onWhatsApp(
    '5511999999999',
    '5511888888888@s.whatsapp.net'
);

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
// Block
await sock.updateBlockStatus('5511999999999@s.whatsapp.net', 'block');

// Unblock
await sock.updateBlockStatus('5511999999999@s.whatsapp.net', 'unblock');
```

#### `getBusinessProfile(jid): Promise<unknown>`
Get business profile of a business account.

```typescript
const profile = await sock.getBusinessProfile('5511999999999@s.whatsapp.net');
console.log(profile);
```

---

### Presence

#### `sendPresenceUpdate(type, jid?): Promise<void>`
Update presence status.

```typescript
// Online globally
await sock.sendPresenceUpdate('available');

// Offline
await sock.sendPresenceUpdate('unavailable');

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

// Now you'll receive presence.update events for this contact
sock.ev.on('presence.update', (update) => {
    console.log(`${update.id} is ${update.presences[update.id].lastKnownPresence}`);
});
```

---

### Chats

#### `chatModify(modification, jid): Promise<void>`
Modify chat settings.

```typescript
// Archive
await sock.chatModify({ archive: true }, '5511999999999@s.whatsapp.net');

// Unarchive
await sock.chatModify({ archive: false }, '5511999999999@s.whatsapp.net');

// Mute for 8 hours
await sock.chatModify({ mute: 8 * 60 * 60 * 1000 }, '5511999999999@s.whatsapp.net');

// Unmute
await sock.chatModify({ mute: null }, '5511999999999@s.whatsapp.net');

// Pin chat
await sock.chatModify({ pin: true }, '5511999999999@s.whatsapp.net');

// Unpin
await sock.chatModify({ pin: false }, '5511999999999@s.whatsapp.net');
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
    creator: group.owner,
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
await sock.groupUpdateDescription('123456789@g.us', 'New group description');
```

#### `groupSettingUpdate(jid, setting): Promise<void>`
Update group settings.

```typescript
// Only admins can send messages
await sock.groupSettingUpdate('123456789@g.us', 'announcement');

// Everyone can send messages
await sock.groupSettingUpdate('123456789@g.us', 'not_announcement');

// Only admins can edit group info
await sock.groupSettingUpdate('123456789@g.us', 'locked');

// Everyone can edit group info
await sock.groupSettingUpdate('123456789@g.us', 'unlocked');
```

#### `groupParticipantsUpdate(jid, participants, action): Promise<{ status: string; jid: string }[]>`
Manage group participants.

```typescript
// Add members
await sock.groupParticipantsUpdate(
    '123456789@g.us',
    ['5511999999999@s.whatsapp.net'],
    'add'
);

// Remove members
await sock.groupParticipantsUpdate(
    '123456789@g.us',
    ['5511999999999@s.whatsapp.net'],
    'remove'
);

// Promote to admin
await sock.groupParticipantsUpdate(
    '123456789@g.us',
    ['5511999999999@s.whatsapp.net'],
    'promote'
);

// Demote from admin
await sock.groupParticipantsUpdate(
    '123456789@g.us',
    ['5511999999999@s.whatsapp.net'],
    'demote'
);
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
console.log(`New link: https://chat.whatsapp.com/${newCode}`);
```

#### `groupAcceptInvite(code): Promise<string>`
Join a group using invite code.

```typescript
// You can pass the code or full URL
const groupJid = await sock.groupAcceptInvite('AbCdEfGhIjK');
// or
const groupJid = await sock.groupAcceptInvite('https://chat.whatsapp.com/AbCdEfGhIjK');
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
        // Display QR Code to scan
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
        if (msg.key.fromMe) continue; // Ignore own messages

        console.log('New message:', msg.message?.conversation);

        // Reply
        await sock.sendMessage(msg.key.remoteJid, {
            text: 'Message received!'
        });
    }
});
```

### messages.update
Message status updates.

```typescript
sock.ev.on('messages.update', (updates) => {
    for (const update of updates) {
        console.log(`Message ${update.key.id}: status ${update.update.status}`);
    }
});
```

### presence.update
Presence updates.

```typescript
sock.ev.on('presence.update', (update) => {
    const presence = update.presences[update.id];
    console.log(`${update.id} is ${presence.lastKnownPresence}`);
});
```

### groups.update
Group updates.

```typescript
sock.ev.on('groups.update', (updates) => {
    for (const update of updates) {
        console.log(`Group ${update.id} updated:`, update);
    }
});
```

### group-participants.update
Group participant changes.

```typescript
sock.ev.on('group-participants.update', (update) => {
    console.log(`${update.action} in ${update.id}:`, update.participants);
});
```

---

## Receiving Webhooks

VEX Server sends events via webhook to your backend. Your server **MUST** expose the endpoint `/api/v1/vex/webhooks` to receive these events.

### Express Example

```typescript
import express from 'express';
import { makeWASocket, VEX_WEBHOOK_PATH } from '@vex/client-sdk';

const app = express();
app.use(express.json());

const sock = makeWASocket({
    url: 'https://your-vex-server.com',
    apiKey: 'my-api-key',
    backendUrl: 'https://my-server.com'  // Webhooks at /api/v1/vex/webhooks
});

// IMPORTANT: This endpoint path MUST match VEX_WEBHOOK_PATH (/api/v1/vex/webhooks)
app.post(VEX_WEBHOOK_PATH, (req, res) => {
    const { event, data, sessionUUID } = req.body;

    // Inject event into SDK
    sock.injectEvent(event, data);

    res.json({ received: true });
});

app.listen(3000);
```

> **WARNING:** If you use a different webhook path, VEX Server will not be able to deliver events to your application. Always use `/api/v1/vex/webhooks`.

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
        console.error('Response:', error.response);
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
    WABotEvents
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
