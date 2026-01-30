import { proto } from "@whiskeysockets/baileys";

/**
 * Utilitário para converter payloads JSON puros recebidos do Webhook
 * de volta para objetos ricos compatíveis com a tipagem do Baileys.
 */
export class WebhookParser {

    /**
     * Normaliza os eventos para garantir tipos corretos (Buffer, Long, etc)
     */
    public static parse(event: string, payload: any): any {
        switch (event) {
            case 'messages.upsert':
                return this.parseMessageUpsert(payload);
            case 'messages.update':
                return this.parseMessageUpdate(payload);
            case 'contacts.upsert':
                return this.parseContactsUpsert(payload);
            case 'contacts.update':
                return this.parseContactsUpdate(payload);
            case 'chats.upsert':
                return this.parseChatsUpsert(payload);
            case 'chats.update':
                return this.parseChatsUpdate(payload);
            case 'groups.upsert':
                return this.parseGroupsUpsert(payload);
            case 'groups.update':
                return this.parseGroupsUpdate(payload);
            case 'connection.update':
                return payload;
            default:
                return payload;
        }
    }

    private static parseContactsUpsert(payload: any): any[] {
        if (!Array.isArray(payload)) return payload;
        return payload; // Retorna raw, sem assumir presença de imgUrl
    }

    private static parseContactsUpdate(payload: any): any[] {
        if (!Array.isArray(payload)) return payload;
        return payload; // Retorna raw
    }

    private static parseChatsUpsert(payload: any): any[] {
        if (!Array.isArray(payload)) return payload;
        return payload.map(chat => this.reconstructChat(chat));
    }

    private static parseChatsUpdate(payload: any): any[] {
        if (!Array.isArray(payload)) return payload;
        return payload.map(chat => this.reconstructChat(chat));
    }

    private static parseGroupsUpsert(payload: any): any[] {
        if (!Array.isArray(payload)) return payload;
        return payload.map(group => this.reconstructGroup(group));
    }

    private static parseGroupsUpdate(payload: any): any[] {
        // Groups update usually is an array of partial updates
        if (!Array.isArray(payload)) return payload;
        return payload.map(group => this.reconstructGroup(group));
    }

    private static reconstructGroup(group: any): any {
        const normalized = { ...group };
        if (normalized.creation && typeof normalized.creation === 'string') {
            normalized.creation = parseInt(normalized.creation) || 0;
        }
        if (normalized.participants && Array.isArray(normalized.participants)) {
            // Keep participants as is, usually { id, admin }
        }
        return normalized;
    }

    private static reconstructChat(chat: any): any {
        const normalized = { ...chat };
        // Normaliza Timestamps de chat que podem vir como string do JSON
        if (normalized.conversationTimestamp && typeof normalized.conversationTimestamp === 'string') {
            normalized.conversationTimestamp = parseInt(normalized.conversationTimestamp) || 0;
        }
        if (normalized.lastMessageRecvTimestamp && typeof normalized.lastMessageRecvTimestamp === 'string') {
            normalized.lastMessageRecvTimestamp = parseInt(normalized.lastMessageRecvTimestamp) || 0;
        }
        return normalized;
    }

    private static parseMessageUpsert(payload: any): any {
        if (!payload || !payload.messages) return payload;

        const normalized = { ...payload };

        normalized.messages = normalized.messages.map((msg: any) => {
            return this.reconstructMessage(msg);
        });

        return normalized;
    }

    private static parseMessageUpdate(payload: any): any {
        // Implementar normalização necessária para updates
        return payload;
    }

    /**
     * Reconstitui uma WebMessageInfo a partir do JSON.
     * Cuida de Buffers, Timestamps e Keys.
     */
    private static reconstructMessage(msg: any): proto.IWebMessageInfo {
        // Garante que timestamp seja número (no JSON pode vir string)
        if (msg.messageTimestamp && typeof msg.messageTimestamp === 'string') {
            msg.messageTimestamp = parseInt(msg.messageTimestamp);
            if (isNaN(msg.messageTimestamp)) msg.messageTimestamp = 0;
        }

        // Se houver campos de mídia que deveriam ser Buffer, aqui seria o lugar de converter
        this.recursiveBufferDecode(msg.message);

        return msg;
    }

    private static recursiveBufferDecode(obj: any) {
        if (!obj) return;

        // Lista de campos conhecidos que são Buffer no Baileys
        const bufferFields = ['jpegThumbnail', 'mediaKey', 'fileEncSha256', 'fileSha256', 'fileLength'];

        for (const key in obj) {
            if (bufferFields.includes(key) && typeof obj[key] === 'string') {
                try {
                    obj[key] = Buffer.from(obj[key], 'base64');
                } catch (e) {
                    // Ignora falha
                }
            } else if (typeof obj[key] === 'object') {
                this.recursiveBufferDecode(obj[key]);
            }
        }
    }
}
