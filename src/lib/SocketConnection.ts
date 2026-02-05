import { io, Socket } from 'socket.io-client';
import EventEmitter from 'eventemitter3';

/**
 * Payload de evento do Baileys
 */
interface BaileysEventPayload {
    sessionUUID: string;
    event: string;
    data: unknown;
    timestamp: string;
}

/**
 * Payload de status da sessão
 */
interface SessionStatusPayload {
    sessionUUID: string;
    status: 'connecting' | 'qrcode' | 'connected' | 'disconnected' | 'timeout';
    phoneNumber?: string;
    qrCode?: string;
    timestamp: string;
}

/**
 * Configuração da conexão Socket.IO
 */
export interface SocketConnectionConfig {
    /** URL do servidor VEX */
    url: string;
    /** API Key para autenticação */
    apiKey: string;
    /** Session UUID para se inscrever */
    sessionUUID: string;
    /** ID do cliente (opcional) */
    clientId?: string;
    /** Timeout de conexão em ms (default: 60000 para suportar conexões lentas) */
    connectionTimeout?: number;
    /** Habilitar reconexão automática (default: true) */
    autoReconnect?: boolean;
    /** Máximo de tentativas de reconexão (default: Infinity) */
    maxReconnectAttempts?: number;
    /** Delay base para reconexão em ms (default: 1000) */
    reconnectDelay?: number;
    /** Delay máximo para reconexão em ms (default: 30000) */
    maxReconnectDelay?: number;
    /**
     * Timeout para envio de mensagens grandes em ms (default: 300000 = 5 min)
     * Use valores maiores para arquivos grandes (200-500MB)
     */
    messageTimeout?: number;
    /** Intervalo de ping para keep-alive em ms (default: 25000) */
    pingInterval?: number;
    /** Timeout de ping em ms (default: 60000) */
    pingTimeout?: number;
}

/**
 * Eventos emitidos pelo SocketConnection
 */
export interface SocketConnectionEvents {
    // Eventos de conexão
    'socket:connected': () => void;
    'socket:disconnected': (reason: string) => void;
    'socket:reconnecting': (attempt: number) => void;
    'socket:error': (error: Error) => void;

    // Eventos de sessão
    'session:subscribed': (sessionUUID: string) => void;
    'session:unsubscribed': (sessionUUID: string) => void;
    'session:status': (payload: SessionStatusPayload) => void;

    // Eventos do Baileys (forwarded)
    'baileys:event': (eventName: string, data: unknown) => void;
}

/**
 * SocketConnection - Gerencia conexão Socket.IO com o VEX Server
 *
 * Recebe eventos em tempo real via WebSocket, muito mais eficiente que polling.
 * Suporta reconexão automática e fallback gracioso.
 */
export class SocketConnection extends EventEmitter<SocketConnectionEvents> {
    private socket: Socket | null = null;
    private config: Required<SocketConnectionConfig>;
    private _isConnected: boolean = false;
    private _isSubscribed: boolean = false;
    private _reconnectAttempts: number = 0;
    private _isDestroyed: boolean = false;

    constructor(config: SocketConnectionConfig) {
        super();

        this.config = {
            connectionTimeout: 60000,      // 60s para conexões (suporta redes lentas)
            autoReconnect: true,
            maxReconnectAttempts: Infinity,
            reconnectDelay: 1000,
            maxReconnectDelay: 30000,
            messageTimeout: 300000,        // 5 minutos para envio de mensagens/arquivos grandes
            pingInterval: 25000,           // Ping a cada 25s para keep-alive
            pingTimeout: 60000,            // 60s para timeout de ping
            clientId: `sdk_${config.sessionUUID}`, // Usar sessionUUID como clientId para identificação
            ...config
        };
    }

    /**
     * Verifica se está conectado
     */
    get isConnected(): boolean {
        return this._isConnected && this.socket?.connected === true;
    }

    /**
     * Verifica se está inscrito na sessão
     */
    get isSubscribed(): boolean {
        return this._isSubscribed;
    }

    /**
     * Retorna o número de tentativas de reconexão
     */
    get reconnectAttempts(): number {
        return this._reconnectAttempts;
    }

    /**
     * Conecta ao servidor Socket.IO
     */
    async connect(): Promise<void> {
        if (this._isDestroyed) {
            throw new Error('SocketConnection has been destroyed');
        }

        if (this.socket?.connected) {
            return;
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Socket connection timeout'));
            }, this.config.connectionTimeout);

            // Criar socket com autenticação e configuração para conexão PERSISTENTE
            // Similar a como o Baileys mantém conexão com WhatsApp
            this.socket = io(this.config.url, {
                // Autenticação
                auth: {
                    apiKey: this.config.apiKey,
                    clientId: this.config.clientId
                },

                // Transporte: WebSocket primeiro, polling como fallback
                transports: ['websocket', 'polling'],
                upgrade: true,              // Permite upgrade de polling para websocket

                // RECONEXÃO AGRESSIVA - nunca desistir
                reconnection: this.config.autoReconnect,
                reconnectionAttempts: this.config.maxReconnectAttempts,
                reconnectionDelay: this.config.reconnectDelay,
                reconnectionDelayMax: this.config.maxReconnectDelay,
                randomizationFactor: 0.5,   // Jitter para evitar thundering herd

                // TIMEOUTS - configurados para conexão estável
                timeout: this.config.connectionTimeout,

                // KEEP-ALIVE - mantém conexão ativa
                // Nota: pingInterval e pingTimeout são configurados no servidor
                // O cliente usa ackTimeout para operações

                // Evitar criar múltiplas conexões
                forceNew: false,
                multiplex: true,

                // Auto-conectar
                autoConnect: true,

                // Compressão (se disponível)
                perMessageDeflate: {
                    threshold: 2048  // Comprimir mensagens > 2KB
                }
            });

            // Handler de conexão bem-sucedida
            this.socket.once('connect', () => {
                clearTimeout(timeout);
                this._isConnected = true;
                this._reconnectAttempts = 0;
                console.log('[VexSDK:Socket] Connected to server');
                this.emit('socket:connected');

                // Inscrever na sessão automaticamente
                this.subscribeToSession().then(() => {
                    resolve();
                }).catch(reject);
            });

            // Handler de erro de conexão
            this.socket.once('connect_error', (error: Error) => {
                clearTimeout(timeout);
                console.error('[VexSDK:Socket] Connection error:', error.message);
                this.emit('socket:error', error);
                reject(error);
            });

            // Configurar handlers de eventos
            this.setupEventHandlers();
        });
    }

    /**
     * Configura handlers de eventos do Socket.IO
     * Implementa estratégia de conexão PERSISTENTE similar ao Baileys
     */
    private setupEventHandlers(): void {
        if (!this.socket) return;

        // ========== EVENTOS DE DESCONEXÃO ==========
        this.socket.on('disconnect', (reason: string) => {
            this._isConnected = false;
            this._isSubscribed = false;
            console.log('[VexSDK:Socket] Disconnected:', reason);
            this.emit('socket:disconnected', reason);

            // Se a desconexão foi iniciada pelo servidor, tenta reconectar manualmente
            // "io server disconnect" = servidor fechou, "io client disconnect" = cliente fechou
            // "transport close" = conexão perdida, "transport error" = erro de rede
            if (reason === 'io server disconnect' || reason === 'transport close' || reason === 'transport error') {
                console.log('[VexSDK:Socket] Server-side disconnect, attempting manual reconnect...');
                // O socket.io já vai tentar reconectar automaticamente
                // Mas garantimos que está habilitado
                if (this.socket && !this.socket.connected && this.config.autoReconnect) {
                    this.socket.connect();
                }
            }
        });

        // ========== EVENTOS DE RECONEXÃO ==========
        this.socket.on('reconnect_attempt', (attempt: number) => {
            this._reconnectAttempts = attempt;
            console.log(`[VexSDK:Socket] Reconnecting... attempt ${attempt}`);
            this.emit('socket:reconnecting', attempt);
        });

        this.socket.on('reconnect', () => {
            this._isConnected = true;
            this._reconnectAttempts = 0;
            console.log('[VexSDK:Socket] Reconnected successfully');
            this.emit('socket:connected');

            // Re-inscrever na sessão após reconexão
            this.subscribeToSession().catch((err) => {
                console.error('[VexSDK:Socket] Failed to resubscribe:', err);
            });
        });

        this.socket.on('reconnect_error', (error: Error) => {
            console.warn('[VexSDK:Socket] Reconnect error:', error.message);
            // Não emitir erro aqui - vai continuar tentando
        });

        this.socket.on('reconnect_failed', () => {
            console.error('[VexSDK:Socket] Reconnection failed after max attempts');
            this.emit('socket:error', new Error('Reconnection failed'));
        });

        // ========== EVENTOS DE ERRO ==========
        this.socket.on('error', (error: Error | string) => {
            console.error('[VexSDK:Socket] Socket error:', error);
            this.emit('socket:error', error instanceof Error ? error : new Error(String(error)));
        });

        this.socket.on('connect_error', (error: Error) => {
            console.error('[VexSDK:Socket] Connection error:', error.message);
            // Não emitir erro aqui durante tentativas de reconexão
            // O socket.io vai continuar tentando
        });

        // ========== PING/PONG PARA KEEP-ALIVE ==========
        this.socket.on('ping', () => {
            // Socket.IO envia pings automaticamente para manter a conexão
            // Este evento é útil para debug
        });

        // Eventos de sessão
        this.socket.on('session:subscribed', (data: { sessionUUID: string }) => {
            this._isSubscribed = true;
            console.log('[VexSDK:Socket] Subscribed to session:', data.sessionUUID);
            this.emit('session:subscribed', data.sessionUUID);
        });

        this.socket.on('session:unsubscribed', (data: { sessionUUID: string }) => {
            this._isSubscribed = false;
            console.log('[VexSDK:Socket] Unsubscribed from session:', data.sessionUUID);
            this.emit('session:unsubscribed', data.sessionUUID);
        });

        this.socket.on('session:status', (data: SessionStatusPayload) => {
            this.emit('session:status', data);
        });

        // Eventos do Baileys - forwarded para o SDK
        // Lista completa de eventos suportados pelo Baileys
        const baileysEvents = [
            // Conexão
            'connection.update',
            // Mensagens
            'messages.upsert',
            'messages.update',
            'messages.delete',
            'messages.reaction',
            'message-receipt.update',
            // Presença
            'presence.update',
            // Contatos
            'contacts.upsert',
            'contacts.update',
            // Grupos
            'groups.update',
            'groups.upsert',
            'group-participants.update',
            // Chats
            'chats.upsert',
            'chats.update',
            'chats.delete',
            // Blocklist
            'blocklist.set',
            'blocklist.update',
            // Labels (Business)
            'labels.edit',
            'labels.association',
            // Histórico
            'messaging-history.set',
            // Chamadas
            'call'
        ];

        for (const eventName of baileysEvents) {
            this.socket.on(eventName as any, (payload: BaileysEventPayload) => {
                // Verificar se o evento é para nossa sessão
                if (payload.sessionUUID === this.config.sessionUUID) {
                    // FILTRO CRÍTICO: O servidor VEX gerencia TODA a reconexão do Baileys internamente.
                    // Quando usamos Socket.IO, o cliente SDK NÃO deve reagir a eventos de "close"
                    // porque isso causaria loops de reconexão (cliente e servidor reconectando ao mesmo tempo).
                    //
                    // Estratégia: Via Socket.IO, IGNORAR TODOS os eventos connection.close
                    // EXCETO quando é um logout explícito (reason === 'logged_out').
                    // O servidor já está reconectando automaticamente, então não precisamos fazer nada.
                    if (eventName === 'connection.update') {
                        const data = payload.data as { connection?: string; status?: string; reason?: string; attempts?: number };

                        // Se connection é "close", verifica se é logout explícito ou max retries
                        if (data.connection === 'close') {
                            // Logout explícito do usuário - emite close
                            if (data.reason === 'logged_out') {
                                console.log('[VexSDK:Socket] User logged out, forwarding close event');
                                this.emit('baileys:event', eventName, payload.data);
                                return;
                            }

                            // Máximo de tentativas de reconexão atingido - emite close
                            // Isso acontece quando o servidor não consegue conectar ao WhatsApp
                            if (data.reason === 'max_reconnect_attempts') {
                                console.log(`[VexSDK:Socket] Max reconnect attempts reached (${data.attempts}), forwarding close event`);
                                this.emit('baileys:event', eventName, payload.data);
                                return;
                            }

                            // TODOS os outros casos de close são ignorados
                            // O servidor está gerenciando a reconexão internamente
                            console.log('[VexSDK:Socket] Ignoring close event (server handles reconnection)');
                            return;
                        }

                        // Se connection é "open", emite normalmente
                        if (data.connection === 'open') {
                            console.log('[VexSDK:Socket] Connection opened');
                            this.emit('baileys:event', eventName, payload.data);
                            return;
                        }

                        // QR code ou outros updates, emite normalmente
                        console.log('[VexSDK:Socket] connection.update:', JSON.stringify(data));
                    }
                    this.emit('baileys:event', eventName, payload.data);
                }
            });
        }
    }

    /**
     * Inscreve na sessão para receber eventos
     */
    private async subscribeToSession(): Promise<void> {
        if (!this.socket?.connected) {
            throw new Error('Socket not connected');
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Subscribe timeout'));
            }, 10000);

            this.socket!.emit('session:subscribe', this.config.sessionUUID, (response: { success: boolean }) => {
                clearTimeout(timeout);
                if (response?.success) {
                    this._isSubscribed = true;
                    resolve();
                } else {
                    reject(new Error('Failed to subscribe to session'));
                }
            });
        });
    }

    /**
     * Desinscreve da sessão
     */
    async unsubscribe(): Promise<void> {
        if (!this.socket?.connected || !this._isSubscribed) {
            return;
        }

        return new Promise((resolve) => {
            this.socket!.emit('session:unsubscribe', this.config.sessionUUID, () => {
                this._isSubscribed = false;
                resolve();
            });
        });
    }

    /**
     * Desconecta do servidor
     */
    disconnect(): void {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
        this._isConnected = false;
        this._isSubscribed = false;
    }

    /**
     * Destrói a conexão e limpa recursos
     */
    destroy(): void {
        this._isDestroyed = true;
        this.disconnect();
        this.removeAllListeners();
    }

    /**
     * Envia mensagem via Socket.IO (mais rápido que HTTP para sessões conectadas)
     * Suporta arquivos grandes de até 500MB via base64
     *
     * @param to - JID do destinatário
     * @param message - Conteúdo da mensagem (texto, imagem, documento, áudio, vídeo, sticker)
     * @param timeout - Timeout em ms (default: config.messageTimeout = 5 min)
     *
     * @example
     * // Enviar documento preservando nome original
     * await socket.sendMessage('5511999999999', {
     *     document: {
     *         base64: fileBase64,
     *         filename: 'Relatório Financeiro Q1 2026.pdf', // Nome preservado 100%
     *         mimetype: 'application/pdf'
     *     }
     * });
     */
    async sendMessage(
        to: string,
        message: {
            text?: string;
            image?: { url: string; caption?: string } | { base64: string; mimetype: string; caption?: string };
            document?: { url: string; filename?: string; mimetype?: string } | { base64: string; filename: string; mimetype: string };
            audio?: { url: string; ptt?: boolean } | { base64: string; mimetype?: string; ptt?: boolean };
            video?: { url: string; caption?: string } | { base64: string; mimetype: string; caption?: string };
            sticker?: { url: string } | { base64: string; mimetype?: string };
        },
        timeout?: number
    ): Promise<{ success: boolean; messageId?: string; error?: string }> {
        if (!this.socket?.connected) {
            throw new Error('Socket not connected');
        }

        const effectiveTimeout = timeout ?? this.config.messageTimeout;

        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                reject(new Error(`Message send timeout after ${effectiveTimeout}ms`));
            }, effectiveTimeout);

            this.socket!.emit('session:send-message', {
                sessionUUID: this.config.sessionUUID,
                to,
                message
            }, (response: { success: boolean; messageId?: string; error?: string }) => {
                clearTimeout(timeoutId);
                resolve(response);
            });
        });
    }

    /**
     * Retorna o tamanho estimado de um payload em bytes
     * Útil para verificar se um arquivo está dentro dos limites
     */
    static estimatePayloadSize(base64Data: string): number {
        // Base64 string length * 0.75 = tamanho original aproximado
        // Mas o payload total inclui overhead do JSON
        return Math.ceil(base64Data.length * 0.75);
    }

    /**
     * Verifica se um payload base64 está dentro do limite de 500MB
     */
    static isWithinSizeLimit(base64Data: string, limitMB: number = 500): boolean {
        const sizeBytes = SocketConnection.estimatePayloadSize(base64Data);
        const limitBytes = limitMB * 1024 * 1024;
        return sizeBytes <= limitBytes;
    }
}

export default SocketConnection;
