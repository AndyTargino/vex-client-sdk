import { WebhookParser } from '../src/lib/WebhookParser';

describe('WebhookParser', () => {
    describe('groups.upsert', () => {
        it('should normalize creation timestamp from string to number', () => {
            const payload = [{
                id: '123456789@g.us',
                subject: 'Test Group',
                creation: '1700000000',
                participants: [{ id: 'user1@s.whatsapp.net', admin: 'admin' }]
            }];

            const result = WebhookParser.parse('groups.upsert', payload);

            expect(result).toHaveLength(1);
            expect(result[0].creation).toBe(1700000000);
            expect(typeof result[0].creation).toBe('number');
            expect(result[0].participants).toHaveLength(1);
        });

        it('should handle already numeric timestamps', () => {
            const payload = [{
                id: '123@g.us',
                creation: 1700000000
            }];
            const result = WebhookParser.parse('groups.upsert', payload);
            expect(result[0].creation).toBe(1700000000);
        });
    });

    describe('chats.upsert', () => {
        it('should normalize conversationTimestamp', () => {
            const payload = [{
                id: '551199999999@s.whatsapp.net',
                conversationTimestamp: '1600000000'
            }];
            const result = WebhookParser.parse('chats.upsert', payload);
            expect(result[0].conversationTimestamp).toBe(1600000000);
        });
    });

    describe('messages.upsert', () => {
        it('should normalize messageTimestamp', () => {
            const payload = {
                messages: [{
                    key: { remoteJid: 'status@broadcast' },
                    message: { conversation: 'Hello' },
                    messageTimestamp: '1650000000'
                }]
            };
            const result = WebhookParser.parse('messages.upsert', payload);
            expect(result.messages[0].messageTimestamp).toBe(1650000000);
        });

        it('should decode Base64 buffers in recognized fields', () => {
            const payload = {
                messages: [{
                    message: {
                        imageMessage: {
                            jpegThumbnail: 'SGVsbG8gV29ybGQ=', // "Hello World" in base64
                            caption: 'Test'
                        }
                    }
                }]
            };
            const result = WebhookParser.parse('messages.upsert', payload);
            const thumb = result.messages[0].message.imageMessage.jpegThumbnail;

            expect(Buffer.isBuffer(thumb)).toBe(true);
            expect(thumb.toString()).toBe('Hello World');
        });
    });
});
