import {
    AnyMessageContent,
    BaileysEventMap,
    GroupMetadata,
    MiscMessageGenerationOptions,
    ParticipantAction,
    proto
} from "@whiskeysockets/baileys";
import EventEmitter from "eventemitter3";
import { HttpClient, HttpClientConfig } from "./lib/HttpClient";
import { WebhookParser } from "./lib/WebhookParser";
import { SocketConnection, SocketConnectionConfig } from "./lib/SocketConnection";

export type WABotEvents = BaileysEventMap;

/**
 * Endpoint padrão para receber webhooks do VEX Server
 * IMPORTANTE: Sua aplicação DEVE expor este endpoint para receber eventos
 */
export const VEX_WEBHOOK_PATH = '/api/v1/vex/webhooks';

/**
 * Configuração do cliente VEX
 */
export interface VexClientConfig {
    /** URL do VEX Microservice (ex: http://localhost:5342) */
    url: string;
    /** Token SESSION UUID (OPCIONAL: se vazio, cria nova sessão) */
    token?: string;
    /** Chave de Segurança da API (API_SECRET_KEY) */
    apiKey: string;
    /**
     * URL base da sua aplicação para receber webhooks (OPCIONAL)
     * Se não fornecido, o SDK usa polling interno para receber eventos
     * Se fornecido, o SDK registra o webhook no servidor
     */
    backendUrl?: string;
    /** Metadados customizados para a sessão */
    metadata?: Record<string, unknown>;
    /** Configuração de retry para requisições HTTP */
    retry?: {
        /** Número máximo de tentativas (default: 5) */
        maxRetries?: number;
        /** Delay base em ms (default: 1000) */
        baseDelay?: number;
    };
    /** Configuração de reconexão automática */
    reconnection?: {
        /** Habilita reconexão automática (default: true) */
        enabled?: boolean;
        /** Intervalo inicial de reconexão em ms (default: 1000) */
        initialDelay?: number;
        /** Intervalo máximo de reconexão em ms (default: 30000) */
        maxDelay?: number;
        /** Multiplicador do backoff exponencial (default: 2) */
        multiplier?: number;
        /** Número máximo de tentativas (default: Infinity) */
        maxAttempts?: number;
    };
    /** Intervalo do health check em ms (default: 30000, 0 para desabilitar) */
    healthCheckInterval?: number;
    /**
     * Intervalo do polling em ms (default: 5000)
     * O polling busca atualizações de QR code, status e eventos do servidor
     * Usado como fallback quando Socket.IO falha
     */
    pollingInterval?: number;
    /**
     * Configuração do Socket.IO (recomendado para alta escalabilidade)
     * Por padrão, o SDK usa Socket.IO para receber eventos em tempo real
     * Se a conexão Socket.IO falhar, faz fallback para polling
     */
    socketIO?: {
        /** Habilita Socket.IO (default: true) */
        enabled?: boolean;
        /** Timeout de conexão em ms (default: 30000) */
        connectionTimeout?: number;
        /** Habilitar reconexão automática do Socket.IO (default: true) */
        autoReconnect?: boolean;
        /** Máximo de tentativas de reconexão (default: Infinity) */
        maxReconnectAttempts?: number;
        /** Delay base para reconexão em ms (default: 1000) */
        reconnectDelay?: number;
        /** Delay máximo para reconexão em ms (default: 30000) */
        maxReconnectDelay?: number;
    };
}

/**
 * Estatísticas do SQLite da sessão (retornado pelo server)
 */
export interface SessionStats {
    pre_keys: number;
    sender_keys: number;
    sessions: number;
    sync_keys: number;
    lid_mappings: number;
    device_lists: number;
    last_activity: string | null;
    last_cleanup: string | null;
    db_size_mb: string;
    db_path: string;
}

/**
 * Resultado da limpeza de sessão
 */
export interface CleanupResult {
    senderKeys: number;
    preKeys: number;
    sessions: number;
    syncKeys: number;
    total: number;
}

/**
 * Contato do WhatsApp
 */
export interface Contact {
    id: string;
    lid?: string;
    phoneNumber?: string;
    name?: string;
    notify?: string;
    verifiedName?: string;
    imgUrl?: string;
    status?: string;
    isGroup: boolean;
}

/**
 * Opções para busca de contatos
 */
export interface GetContactsOptions {
    limit?: number;
    offset?: number;
    search?: string;
}

/**
 * Conteúdo de mídia para envio via Socket.IO
 * Suporta arquivos grandes de até 500MB via base64
 */
export interface MediaMessageContent {
    text?: string;
    image?: { url?: string; base64?: string; mimetype?: string; caption?: string };
    document?: { url?: string; base64?: string; filename?: string; mimetype?: string };
    audio?: { url?: string; base64?: string; mimetype?: string; ptt?: boolean };
    video?: { url?: string; base64?: string; mimetype?: string; caption?: string };
    sticker?: { url?: string; base64?: string; mimetype?: string };
}

/**
 * Status da conexão
 */
export type ConnectionStatus = 'connecting' | 'open' | 'close' | 'qrcode';

/**
 * Resposta da inicialização de sessão
 */
interface InitSessionResponse {
    sessionUUID: string;
    status: string;
    isConnected: boolean;
    qrCode?: string;
    phoneNumber?: string;
    createdAt: string;
}

/**
 * Resposta do envio de mensagem
 */
interface SendMessageResponse {
    messageId: string;
    timestamp?: number;
    status: string;
}

/**
 * Cliente VEX - SDK compatível com Baileys para o VEX Microservice
 *
 * @example
 * ```typescript
 * const sock = makeWASocket({
 *     url: 'http://localhost:5342',
 *     apiKey: 'your-api-key',
 *     backendUrl: 'http://your-server.com'  // webhooks em /api/v1/vex/webhooks
 * });
 *
 * sock.ev.on('connection.update', (update) => {
 *     if (update.qrCode) console.log('QR:', update.qrCode);
 *     if (update.connection === 'open') console.log('Connected!');
 * });
 *
 * sock.ev.on('messages.upsert', ({ messages }) => {
 *     console.log('New message:', messages[0]);
 * });
 * ```
 */
export class VexClient {
    /** EventEmitter compatível com Baileys */
    public ev: EventEmitter;
    /** Mock WebSocket para compatibilidade com Baileys */
    public ws: { on: () => void; off: () => void; close: () => void };
    /** Dados do usuário conectado */
    public user: { id: string; name?: string } | undefined;
    /** Estado de autenticação (compatibilidade) */
    public authState: unknown;
    /** Tipo de conexão (sempre 'md' para Multi-Device) */
    public readonly type: string = 'md';

    /** JID do bot (alias para user.id) */
    public id: string | undefined;
    /** ID customizado da empresa */
    public companyId: number | undefined;
    /** Flag para simular digitação */
    public useTyping: boolean = false;

    private http: HttpClient;
    private _sessionId: string | undefined;
    private _connectionStatus: ConnectionStatus = 'connecting';
    private config: VexClientConfig;
    private initPromise: Promise<void>;

    // Reconexão
    private _isServerOnline: boolean = true;
    private _reconnectAttempts: number = 0;
    private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private _healthCheckTimer: ReturnType<typeof setInterval> | null = null;
    private _isReconnecting: boolean = false;
    private _isDestroyed: boolean = false;

    // Polling interno (fallback quando Socket.IO falha)
    private _pollingTimer: ReturnType<typeof setInterval> | null = null;
    private _lastQrCode: string | null = null;
    private _lastStatus: string | null = null;
    private _lastPhoneNumber: string | null = null;
    private _isPollingEnabled: boolean = false;

    // Socket.IO (modo principal - alta performance)
    private _socketConnection: SocketConnection | null = null;
    private _isSocketIOEnabled: boolean = true;
    private _socketIOFailed: boolean = false;

    constructor(config: VexClientConfig) {
        this.config = config;
        this.ev = new EventEmitter();
        this._sessionId = config.token;

        // HttpClient com configuração de retry e callbacks de status
        const httpConfig: HttpClientConfig = {
            baseURL: config.url,
            apiKey: config.apiKey,
            maxRetries: config.retry?.maxRetries ?? 5,
            baseDelay: config.retry?.baseDelay ?? 1000,
            onServerOffline: () => this.handleServerOffline(),
            onServerOnline: () => this.handleServerOnline()
        };
        this.http = new HttpClient(httpConfig);

        // Mock WebSocket para compatibilidade
        this.ws = {
            on: () => { },
            off: () => { },
            close: () => this.destroy()
        };

        // Define user provisório se token existir
        if (this._sessionId) {
            this.id = `${this._sessionId}@s.whatsapp.net`;
            this.user = { id: this.id };
        }

        // Dispara inicialização assíncrona
        this.initPromise = this.initialize().catch(err => {
            console.error("[VexSDK] Init failed:", err);
            this._connectionStatus = 'close';
            this.ev.emit("connection.update", {
                connection: "close",
                lastDisconnect: { error: err, date: new Date() }
            });

            // Inicia reconexão automática se habilitada
            if (this.isReconnectionEnabled()) {
                this.scheduleReconnect();
            }
        });
    }

    /**
     * Verifica se o servidor VEX está online
     */
    public get isServerOnline(): boolean {
        return this._isServerOnline;
    }

    /**
     * Retorna o número de tentativas de reconexão
     */
    public get reconnectAttempts(): number {
        return this._reconnectAttempts;
    }

    /**
     * Verifica se está tentando reconectar
     */
    public get isReconnecting(): boolean {
        return this._isReconnecting;
    }

    /**
     * Aguarda a inicialização do cliente
     */
    public async waitForInit(): Promise<void> {
        return this.initPromise;
    }

    /**
     * Getter para o ID da sessão
     */
    public get sessionId(): string | undefined {
        return this._sessionId;
    }

    /**
     * Getter para o status da conexão
     */
    public get connectionStatus(): ConnectionStatus {
        return this._connectionStatus;
    }

    /**
     * Constrói a URL completa do webhook (se backendUrl estiver configurado)
     */
    private buildWebhookUrl(): string | undefined {
        if (!this.config.backendUrl) {
            return undefined;
        }
        const baseUrl = this.config.backendUrl.replace(/\/+$/, ''); // Remove trailing slashes
        return `${baseUrl}${VEX_WEBHOOK_PATH}`;
    }

    /**
     * Lógica de inicialização: Se tem token, conecta. Se não, cria nova sessão.
     */
    private async initialize(): Promise<void> {
        try {
            const webhookUrl = this.buildWebhookUrl();

            // Determina modo de operação:
            // 1. Se tem webhookUrl: usa webhook (servidor envia eventos via HTTP)
            // 2. Se não tem webhookUrl e Socket.IO habilitado: usa Socket.IO (real-time)
            // 3. Fallback: polling (quando Socket.IO falha)
            this._isSocketIOEnabled = this.config.socketIO?.enabled !== false && !webhookUrl;
            this._isPollingEnabled = false; // Só habilita se Socket.IO falhar

            const response = await this.http.post<InitSessionResponse>("/sessions/init", {
                sessionUUID: this.config.token,
                webhookUrl, // undefined se não configurado - servidor não enviará webhooks
                metadata: this.config.metadata
            });

            this._sessionId = response.sessionUUID;
            this.id = `${this._sessionId}@s.whatsapp.net`;
            this.user = {
                id: this.id,
                name: response.phoneNumber
            };

            // Salva estado inicial para comparação no polling
            this._lastQrCode = response.qrCode || null;
            this._lastStatus = response.status;
            this._lastPhoneNumber = response.phoneNumber || null;

            // Reset do contador de reconexão após sucesso
            this._reconnectAttempts = 0;
            this._isReconnecting = false;
            this._isServerOnline = true;

            if (response.isConnected) {
                this._connectionStatus = 'open';
                this.ev.emit("connection.update", { connection: "open" });
            } else if (response.qrCode) {
                this._connectionStatus = 'qrcode';
                this.ev.emit("connection.update", { qrCode: response.qrCode });
            } else {
                this._connectionStatus = 'connecting';
                this.ev.emit("connection.update", { connection: "connecting" });
            }

            // Conecta via Socket.IO se habilitado (modo preferido - real-time e escalável)
            if (this._isSocketIOEnabled && !this._socketIOFailed) {
                console.log(`[VexSDK] Connecting via Socket.IO to ${this.config.url}...`);
                await this.connectSocketIO();
                // Health check não é necessário quando Socket.IO está ativo
                // (Socket.IO já detecta desconexões automaticamente)
            } else if (!webhookUrl) {
                // Fallback para polling se Socket.IO desabilitado ou falhou
                console.log('[VexSDK] Socket.IO disabled/failed, using HTTP polling');
                this.startPolling();
                // Inicia health check apenas no modo polling
                this.startHealthCheck();
            } else {
                // Modo webhook - não precisa de polling nem Socket.IO no cliente
                console.log('[VexSDK] Using webhook mode (events via HTTP)');
            }

        } catch (error) {
            console.error("[VexSDK] Failed to initialize session:", error);
            throw error;
        }
    }

    /**
     * Conecta ao servidor via Socket.IO para receber eventos em tempo real
     * Muito mais eficiente que polling para alta escalabilidade
     */
    private async connectSocketIO(): Promise<void> {
        if (!this._sessionId || this._isDestroyed) return;

        try {
            // Fecha conexão anterior se existir
            if (this._socketConnection) {
                this._socketConnection.destroy();
                this._socketConnection = null;
            }

            const socketConfig: SocketConnectionConfig = {
                url: this.config.url,
                apiKey: this.config.apiKey,
                sessionUUID: this._sessionId,
                clientId: `sdk_${this._sessionId}`,
                connectionTimeout: this.config.socketIO?.connectionTimeout ?? 30000,
                autoReconnect: this.config.socketIO?.autoReconnect ?? true,
                maxReconnectAttempts: this.config.socketIO?.maxReconnectAttempts ?? Infinity,
                reconnectDelay: this.config.socketIO?.reconnectDelay ?? 1000,
                maxReconnectDelay: this.config.socketIO?.maxReconnectDelay ?? 30000
            };

            this._socketConnection = new SocketConnection(socketConfig);

            // Configura handlers de eventos do Socket.IO
            this.setupSocketIOHandlers();

            // Conecta ao servidor
            await this._socketConnection.connect();

            console.log('[VexSDK] ✓ Socket.IO connected - polling/health-check disabled');

            // Para o polling e health check (Socket.IO já detecta desconexões)
            this.stopPolling();
            this.stopHealthCheck();
            this._isPollingEnabled = false;

        } catch (error) {
            console.error('[VexSDK] ✗ Socket.IO connection failed:', error);
            console.warn('[VexSDK] Falling back to HTTP polling mode');
            this._socketIOFailed = true;

            // Limpa a conexão falha
            if (this._socketConnection) {
                this._socketConnection.destroy();
                this._socketConnection = null;
            }

            // Fallback para polling + health check
            this._isPollingEnabled = true;
            this.startPolling();
            this.startHealthCheck();
        }
    }

    /**
     * Configura os handlers de eventos do Socket.IO
     */
    private setupSocketIOHandlers(): void {
        if (!this._socketConnection) return;

        // Eventos de conexão do Socket.IO
        this._socketConnection.on('socket:connected', () => {
            console.log('[VexSDK] Socket.IO connected');
        });

        this._socketConnection.on('socket:disconnected', (reason) => {
            console.log('[VexSDK] Socket.IO disconnected:', reason);

            // Se desconectou inesperadamente e não está destruído, tenta reconectar
            if (!this._isDestroyed && !this._socketConnection?.isConnected) {
                // O Socket.IO tenta reconectar automaticamente
                // Se falhar após várias tentativas, fallback para polling
            }
        });

        this._socketConnection.on('socket:reconnecting', (attempt) => {
            console.log(`[VexSDK] Socket.IO reconnecting... attempt ${attempt}`);
        });

        this._socketConnection.on('socket:error', (error) => {
            console.error('[VexSDK] Socket.IO error:', error);

            // Se erro persistir, pode fazer fallback para polling
            if (!this._socketConnection?.isConnected && !this._isPollingEnabled) {
                console.log('[VexSDK] Socket.IO failed, enabling polling fallback');
                this._isPollingEnabled = true;
                this.startPolling();
            }
        });

        // Eventos de status da sessão vindos via Socket.IO
        this._socketConnection.on('session:status', (payload) => {
            // Atualiza estado interno
            if (payload.status === 'connected') {
                this._connectionStatus = 'open';
                this._lastQrCode = null;
                if (payload.phoneNumber) {
                    this._lastPhoneNumber = payload.phoneNumber;
                    this.user = {
                        id: `${payload.phoneNumber}@s.whatsapp.net`,
                        name: payload.phoneNumber
                    };
                    this.id = this.user.id;
                }
                this.ev.emit("connection.update", { connection: "open" });
            } else if (payload.status === 'qrcode' && payload.qrCode) {
                this._connectionStatus = 'qrcode';
                this._lastQrCode = payload.qrCode;
                this.ev.emit("connection.update", { qrCode: payload.qrCode });
            } else if (payload.status === 'disconnected' || payload.status === 'timeout') {
                this._connectionStatus = 'close';
                this.ev.emit("connection.update", {
                    connection: "close",
                    lastDisconnect: { error: new Error(payload.status), date: new Date() }
                });
            } else if (payload.status === 'connecting') {
                this._connectionStatus = 'connecting';
                this.ev.emit("connection.update", { connection: "connecting" });
            }
        });

        // Eventos do Baileys forwarded via Socket.IO
        this._socketConnection.on('baileys:event', (eventName, data) => {
            // Injeta o evento no EventEmitter do SDK
            this.injectEvent(eventName, data);
        });
    }

    /**
     * Verifica se a reconexão automática está habilitada
     */
    private isReconnectionEnabled(): boolean {
        return this.config.reconnection?.enabled !== false;
    }

    /**
     * Calcula o delay para a próxima tentativa de reconexão (exponential backoff)
     */
    private getReconnectDelay(): number {
        const initialDelay = this.config.reconnection?.initialDelay ?? 1000;
        const maxDelay = this.config.reconnection?.maxDelay ?? 30000;
        const multiplier = this.config.reconnection?.multiplier ?? 2;

        const delay = Math.min(
            initialDelay * Math.pow(multiplier, this._reconnectAttempts),
            maxDelay
        );

        // Adiciona jitter de até 10% para evitar thundering herd
        const jitter = delay * 0.1 * Math.random();
        return Math.floor(delay + jitter);
    }

    /**
     * Verifica se pode continuar tentando reconectar
     */
    private canReconnect(): boolean {
        if (this._isDestroyed) return false;

        const maxAttempts = this.config.reconnection?.maxAttempts ?? Infinity;
        return this._reconnectAttempts < maxAttempts;
    }

    /**
     * Agenda uma tentativa de reconexão
     */
    private scheduleReconnect(): void {
        if (!this.isReconnectionEnabled() || !this.canReconnect() || this._isDestroyed) {
            return;
        }

        // Limpa timer existente
        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
        }

        const delay = this.getReconnectDelay();
        this._isReconnecting = true;

        console.log(`[VexSDK] Scheduling reconnect attempt ${this._reconnectAttempts + 1} in ${delay}ms`);

        this._reconnectTimer = setTimeout(() => {
            this.attemptReconnect();
        }, delay);
    }

    /**
     * Tenta reconectar ao servidor
     */
    private async attemptReconnect(): Promise<void> {
        if (this._isDestroyed) return;

        this._reconnectAttempts++;
        console.log(`[VexSDK] Reconnect attempt ${this._reconnectAttempts}`);

        // Emite evento de reconexão
        this.ev.emit("connection.update", {
            connection: "connecting",
            isReconnecting: true,
            reconnectAttempt: this._reconnectAttempts
        });

        try {
            // Primeiro faz health check
            const isHealthy = await this.http.healthCheck();

            if (!isHealthy) {
                throw new Error('Server health check failed');
            }

            // Tenta inicializar novamente
            await this.initialize();

            console.log('[VexSDK] Reconnected successfully');

        } catch (error) {
            console.error(`[VexSDK] Reconnect attempt ${this._reconnectAttempts} failed:`, error);

            // Agenda próxima tentativa
            if (this.canReconnect()) {
                this.scheduleReconnect();
            } else {
                console.error('[VexSDK] Max reconnect attempts reached, giving up');
                this._isReconnecting = false;
                this.ev.emit("connection.update", {
                    connection: "close",
                    lastDisconnect: {
                        error: new Error('Max reconnect attempts reached'),
                        date: new Date()
                    }
                });
            }
        }
    }

    /**
     * Handler quando o servidor fica offline
     */
    private handleServerOffline(): void {
        if (this._isDestroyed) return;

        this._isServerOnline = false;
        console.warn('[VexSDK] Server went offline');

        // Emite evento de desconexão
        this.ev.emit("connection.update", {
            connection: "close",
            lastDisconnect: {
                error: new Error('Server offline'),
                date: new Date()
            }
        });

        // Inicia reconexão automática
        if (this.isReconnectionEnabled() && !this._isReconnecting) {
            this.scheduleReconnect();
        }
    }

    /**
     * Handler quando o servidor volta online
     */
    private handleServerOnline(): void {
        if (this._isDestroyed) return;

        const wasOffline = !this._isServerOnline;
        this._isServerOnline = true;

        if (wasOffline) {
            console.log('[VexSDK] Server is back online');
        }
    }

    /**
     * Inicia o health check periódico
     */
    private startHealthCheck(): void {
        const interval = this.config.healthCheckInterval ?? 30000;

        if (interval <= 0 || this._isDestroyed) return;

        // Limpa timer existente
        this.stopHealthCheck();

        this._healthCheckTimer = setInterval(async () => {
            if (this._isDestroyed) {
                this.stopHealthCheck();
                return;
            }

            try {
                const isHealthy = await this.http.healthCheck();

                if (!isHealthy && this._isServerOnline) {
                    this.handleServerOffline();
                }
            } catch {
                // Erro já é tratado pelo HttpClient
            }
        }, interval);
    }

    /**
     * Para o health check periódico
     */
    private stopHealthCheck(): void {
        if (this._healthCheckTimer) {
            clearInterval(this._healthCheckTimer);
            this._healthCheckTimer = null;
        }
    }

    /**
     * Inicia o polling interno para buscar atualizações de status, QR code e eventos
     * Usado quando backendUrl não é configurado (sem webhooks)
     */
    private startPolling(): void {
        const interval = this.config.pollingInterval ?? 5000;

        if (interval <= 0 || this._isDestroyed) return;

        // Limpa timer existente
        this.stopPolling();

        console.log(`[VexSDK] Starting internal polling (interval: ${interval}ms)`);

        this._pollingTimer = setInterval(async () => {
            if (this._isDestroyed) {
                this.stopPolling();
                return;
            }

            await this.pollSessionStatus();
        }, interval);
    }

    /**
     * Para o polling interno
     */
    private stopPolling(): void {
        if (this._pollingTimer) {
            clearInterval(this._pollingTimer);
            this._pollingTimer = null;
        }
    }

    /**
     * Faz polling do status da sessão e emite eventos se houver mudanças
     */
    private async pollSessionStatus(): Promise<void> {
        if (!this._sessionId || this._isDestroyed) return;

        try {
            // Busca status atual da sessão
            const response = await this.http.get<{
                sessionUUID: string;
                status: string;
                qrCode?: string;
                phoneNumber: string | null;
                isConnected: boolean;
                lastActivity: string | null;
                reconnectCount: number;
            }>(`/sessions/${this._sessionId}`);

            // Verifica mudança de QR code
            if (response.qrCode && response.qrCode !== this._lastQrCode) {
                this._lastQrCode = response.qrCode;
                this._connectionStatus = 'qrcode';
                this.ev.emit("connection.update", { qrCode: response.qrCode });
            }

            // Verifica mudança de status
            if (response.status !== this._lastStatus) {
                const oldStatus = this._lastStatus;
                this._lastStatus = response.status;

                // Detecta conexão estabelecida
                if (response.isConnected && oldStatus !== 'connected') {
                    this._connectionStatus = 'open';
                    this._lastQrCode = null; // Limpa QR code após conexão

                    // Atualiza user com dados completos
                    if (response.phoneNumber) {
                        this._lastPhoneNumber = response.phoneNumber;
                        this.user = {
                            id: `${response.phoneNumber}@s.whatsapp.net`,
                            name: response.phoneNumber
                        };
                        this.id = this.user.id;
                    }

                    this.ev.emit("connection.update", { connection: "open" });
                }

                // Detecta desconexão
                if (!response.isConnected && oldStatus === 'connected') {
                    this._connectionStatus = 'close';
                    this.ev.emit("connection.update", {
                        connection: "close",
                        lastDisconnect: { error: new Error("Disconnected"), date: new Date() }
                    });
                }
            }

            // Busca novos eventos/mensagens pendentes
            await this.pollEvents();

        } catch (error) {
            // Ignora erros silenciosamente - o health check trata problemas de conexão
            console.debug("[VexSDK] Polling error:", error);
        }
    }

    /**
     * Busca eventos pendentes do servidor (mensagens, atualizações, etc)
     */
    private async pollEvents(): Promise<void> {
        if (!this._sessionId || this._isDestroyed || this._connectionStatus !== 'open') return;

        try {
            const response = await this.http.get<{
                events: Array<{ event: string; data: unknown; timestamp: number }>;
            }>(`/sessions/${this._sessionId}/events`);

            if (response.events && response.events.length > 0) {
                for (const { event, data } of response.events) {
                    this.injectEvent(event, data);
                }
            }
        } catch {
            // Endpoint pode não existir em versões antigas do servidor - ignora silenciosamente
        }
    }

    /**
     * Força uma tentativa de reconexão imediata
     */
    public async forceReconnect(): Promise<void> {
        if (this._isDestroyed) {
            throw new Error("VexClient has been destroyed");
        }

        // Cancela timers existentes
        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }

        this._reconnectAttempts = 0;
        await this.attemptReconnect();
    }

    /**
     * Destrói o cliente e limpa todos os recursos
     */
    public destroy(): void {
        this._isDestroyed = true;

        // Limpa timers
        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }

        this.stopHealthCheck();
        this.stopPolling();

        // Desconecta Socket.IO
        if (this._socketConnection) {
            this._socketConnection.destroy();
            this._socketConnection = null;
        }

        // Emite evento de fechamento
        this._connectionStatus = 'close';
        this.ev.emit("connection.update", {
            connection: "close",
            lastDisconnect: {
                error: new Error('Client destroyed'),
                date: new Date()
            }
        });

        // Remove todos os listeners
        this.ev.removeAllListeners();

        console.log('[VexSDK] Client destroyed');
    }

    /**
     * Reconecta a sessão existente
     */
    public async reconnect(): Promise<void> {
        if (this._isDestroyed) {
            throw new Error("VexClient has been destroyed. Create a new instance.");
        }

        if (!this._sessionId) {
            throw new Error("No session to reconnect. Use a new VexClient instead.");
        }

        this._connectionStatus = 'connecting';
        this.ev.emit("connection.update", { connection: "connecting" });

        // Reset contadores e estado do Socket.IO
        this._reconnectAttempts = 0;
        this._socketIOFailed = false; // Dá nova chance ao Socket.IO

        // Desconecta Socket.IO atual se existir
        if (this._socketConnection) {
            this._socketConnection.destroy();
            this._socketConnection = null;
        }

        await this.initialize();
    }

    /**
     * Desconecta a sessão (logout do WhatsApp)
     */
    public async logout(): Promise<void> {
        this.ensureInitialized();

        // Para reconexão automática, polling e Socket.IO
        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }
        this.stopHealthCheck();
        this.stopPolling();

        // Desconecta Socket.IO
        if (this._socketConnection) {
            this._socketConnection.destroy();
            this._socketConnection = null;
        }

        this._isReconnecting = false;

        await this.http.delete(`/sessions/${this._sessionId}`);

        this._connectionStatus = 'close';
        this.ev.emit("connection.update", {
            connection: "close",
            lastDisconnect: { error: new Error("Logged out"), date: new Date() }
        });
    }

    /**
     * Obtém estatísticas do SQLite da sessão
     */
    public async getStats(): Promise<SessionStats | null> {
        this.ensureInitialized();

        try {
            const response = await this.http.get<{ sessionUUID: string; sqlite: SessionStats }>(
                `/sessions/${this._sessionId}/stats`
            );
            return response.sqlite;
        } catch {
            return null;
        }
    }

    /**
     * Força limpeza de credenciais antigas da sessão
     */
    public async forceCleanup(): Promise<CleanupResult | null> {
        this.ensureInitialized();

        try {
            const response = await this.http.post<{
                success: boolean;
                sessionUUID: string;
                deleted: CleanupResult;
            }>(`/sessions/${this._sessionId}/cleanup`);

            return response.deleted;
        } catch {
            return null;
        }
    }

    /**
     * Obtém informações da sessão
     */
    public async getSessionInfo(): Promise<{
        sessionUUID: string;
        status: string;
        phoneNumber: string | null;
        isConnected: boolean;
        lastActivity: string | null;
        reconnectCount: number;
    } | null> {
        this.ensureInitialized();

        try {
            return await this.http.get(`/sessions/${this._sessionId}`);
        } catch {
            return null;
        }
    }

    /**
     * Envia mensagens
     */
    public async sendMessage(
        jid: string,
        content: AnyMessageContent,
        options?: MiscMessageGenerationOptions
    ): Promise<proto.WebMessageInfo | undefined> {
        this.ensureInitialized();

        const payload = {
            to: jid,
            message: content,
            options: options
        };

        const response = await this.http.post<SendMessageResponse>(
            `/sessions/${this._sessionId}/messages`,
            payload
        );

        return {
            key: {
                remoteJid: jid,
                fromMe: true,
                id: response.messageId
            },
            message: content as proto.IMessage,
            messageTimestamp: response.timestamp ?? Math.floor(Date.now() / 1000),
            status: proto.WebMessageInfo.Status.PENDING
        } as proto.WebMessageInfo;
    }

    /**
     * Envia mensagem de texto simples (atalho)
     */
    public async sendText(jid: string, text: string): Promise<proto.WebMessageInfo | undefined> {
        return this.sendMessage(jid, { text });
    }

    /**
     * Tipo de mensagem para envio rápido via Socket.IO
     */
    private buildSocketMessage(message: MediaMessageContent): Parameters<SocketConnection['sendMessage']>[1] {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return message as any;
    }

    /**
     * Envia mensagem via Socket.IO (mais rápido que HTTP)
     * Usa automaticamente Socket.IO se conectado, caso contrário usa HTTP
     * Suporta arquivos grandes de até 500MB via base64
     *
     * @param jid - JID do destinatário (ex: 5511999999999@s.whatsapp.net)
     * @param message - Conteúdo da mensagem
     * @param timeout - Timeout em ms (default: 5 minutos)
     *
     * @example
     * // Enviar imagem via base64 (mais rápido)
     * await sock.sendMessageFast('5511999999999@s.whatsapp.net', {
     *     image: { base64: imageBase64, mimetype: 'image/jpeg', caption: 'Foto!' }
     * });
     *
     * // Enviar documento preservando nome original
     * await sock.sendMessageFast('5511999999999@s.whatsapp.net', {
     *     document: { base64: fileBase64, filename: 'Relatório.pdf', mimetype: 'application/pdf' }
     * });
     */
    public async sendMessageFast(
        jid: string,
        message: MediaMessageContent,
        timeout?: number
    ): Promise<{ success: boolean; messageId?: string; error?: string }> {
        this.ensureInitialized();

        // Se Socket.IO está conectado, usa ele (mais rápido)
        if (this._socketConnection?.isConnected) {
            return this._socketConnection.sendMessage(jid, this.buildSocketMessage(message), timeout);
        }

        // Fallback para HTTP
        const response = await this.http.post<{ messageId: string; status: string }>(
            `/sessions/${this._sessionId}/messages`,
            { to: jid, message }
        );

        return {
            success: true,
            messageId: response.messageId
        };
    }

    /**
     * Envia imagem via Socket.IO (atalho)
     * @param jid - JID do destinatário
     * @param image - Imagem como URL ou base64
     * @param caption - Legenda opcional
     */
    public async sendImage(
        jid: string,
        image: { url: string } | { base64: string; mimetype: string },
        caption?: string
    ): Promise<{ success: boolean; messageId?: string; error?: string }> {
        return this.sendMessageFast(jid, {
            image: { ...image, caption } as any
        });
    }

    /**
     * Envia documento via Socket.IO (atalho)
     * @param jid - JID do destinatário
     * @param document - Documento como URL ou base64
     * @param filename - Nome do arquivo (preservado no WhatsApp)
     * @param mimetype - MIME type do arquivo
     */
    public async sendDocument(
        jid: string,
        document: { url: string } | { base64: string },
        filename: string,
        mimetype?: string
    ): Promise<{ success: boolean; messageId?: string; error?: string }> {
        return this.sendMessageFast(jid, {
            document: { ...document, filename, mimetype: mimetype || 'application/octet-stream' } as any
        });
    }

    /**
     * Envia áudio via Socket.IO (atalho)
     * @param jid - JID do destinatário
     * @param audio - Áudio como URL ou base64
     * @param ptt - Push-to-talk (mensagem de voz) - default: false
     */
    public async sendAudio(
        jid: string,
        audio: { url: string } | { base64: string; mimetype?: string },
        ptt: boolean = false
    ): Promise<{ success: boolean; messageId?: string; error?: string }> {
        return this.sendMessageFast(jid, {
            audio: { ...audio, ptt } as any
        });
    }

    /**
     * Envia vídeo via Socket.IO (atalho)
     * @param jid - JID do destinatário
     * @param video - Vídeo como URL ou base64
     * @param caption - Legenda opcional
     */
    public async sendVideo(
        jid: string,
        video: { url: string } | { base64: string; mimetype: string },
        caption?: string
    ): Promise<{ success: boolean; messageId?: string; error?: string }> {
        return this.sendMessageFast(jid, {
            video: { ...video, caption } as any
        });
    }

    /**
     * Envia sticker via Socket.IO (atalho)
     * @param jid - JID do destinatário
     * @param sticker - Sticker como URL ou base64
     */
    public async sendSticker(
        jid: string,
        sticker: { url: string } | { base64: string; mimetype?: string }
    ): Promise<{ success: boolean; messageId?: string; error?: string }> {
        return this.sendMessageFast(jid, { sticker: sticker as any });
    }

    /**
     * Verifica se o Socket.IO está conectado
     * Útil para decidir qual método de envio usar
     */
    public get isSocketConnected(): boolean {
        return this._socketConnection?.isConnected ?? false;
    }

    /**
     * Verifica se números existem no WhatsApp
     */
    public async onWhatsApp(...jids: string[]): Promise<{ exists: boolean; jid: string }[]> {
        this.ensureInitialized();

        try {
            const response = await this.http.post<{ results: { exists: boolean; jid: string }[] }>(
                `/sessions/${this._sessionId}/contacts/check`,
                { jids }
            );
            return response.results;
        } catch (error) {
            console.error("[VexSDK] onWhatsApp check failed:", error);
            return jids.map(jid => ({ exists: true, jid }));
        }
    }

    /**
     * Lista todos os grupos que participa
     */
    public async groupFetchAllParticipating(): Promise<{ [key: string]: GroupMetadata }> {
        this.ensureInitialized();
        const response = await this.http.get<{ sessionUUID: string; groups: { [key: string]: GroupMetadata } }>(
            `/sessions/${this._sessionId}/groups`
        );
        return response.groups;
    }

    /**
     * Obtém metadados de um grupo
     */
    public async groupMetadata(jid: string): Promise<GroupMetadata> {
        this.ensureInitialized();
        const response = await this.http.get<{ sessionUUID: string; group: GroupMetadata }>(
            `/sessions/${this._sessionId}/groups/${encodeURIComponent(jid)}`
        );
        return response.group;
    }

    /**
     * Cria um novo grupo
     */
    public async groupCreate(subject: string, participants: string[]): Promise<GroupMetadata> {
        this.ensureInitialized();
        const response = await this.http.post<{ sessionUUID: string; group: GroupMetadata }>(
            `/sessions/${this._sessionId}/groups`,
            { subject, participants }
        );
        return response.group;
    }

    /**
     * Atualiza o título do grupo
     */
    public async groupUpdateSubject(jid: string, subject: string): Promise<void> {
        this.ensureInitialized();
        await this.http.put(`/sessions/${this._sessionId}/groups/${encodeURIComponent(jid)}/subject`, { subject });
    }

    /**
     * Atualiza descrição do grupo
     */
    public async groupUpdateDescription(jid: string, description: string): Promise<void> {
        this.ensureInitialized();
        await this.http.put(`/sessions/${this._sessionId}/groups/${encodeURIComponent(jid)}/description`, { description });
    }

    /**
     * Atualiza configurações do grupo
     */
    public async groupSettingUpdate(
        jid: string,
        setting: 'announcement' | 'locked' | 'not_announcement' | 'unlocked'
    ): Promise<void> {
        this.ensureInitialized();
        await this.http.put(`/sessions/${this._sessionId}/groups/${encodeURIComponent(jid)}/settings`, { setting });
    }

    /**
     * Gerencia participantes do grupo
     */
    public async groupParticipantsUpdate(
        jid: string,
        participants: string[],
        action: ParticipantAction
    ): Promise<{ status: string; jid: string }[]> {
        this.ensureInitialized();
        const response = await this.http.post<{ sessionUUID: string; results: { status: string; jid: string }[] }>(
            `/sessions/${this._sessionId}/groups/${encodeURIComponent(jid)}/participants`,
            { participants, action }
        );
        return response.results;
    }

    /**
     * Sai de um grupo
     */
    public async groupLeave(jid: string): Promise<void> {
        this.ensureInitialized();
        await this.http.delete(`/sessions/${this._sessionId}/groups/${encodeURIComponent(jid)}`);
    }

    /**
     * Obtém código de convite do grupo
     */
    public async groupInviteCode(jid: string): Promise<string> {
        this.ensureInitialized();
        const response = await this.http.get<{ inviteCode: string }>(
            `/sessions/${this._sessionId}/groups/${encodeURIComponent(jid)}/invite-code`
        );
        return response.inviteCode;
    }

    /**
     * Revoga código de convite do grupo e gera um novo
     */
    public async groupRevokeInvite(jid: string): Promise<string> {
        this.ensureInitialized();
        const response = await this.http.post<{ inviteCode: string }>(
            `/sessions/${this._sessionId}/groups/${encodeURIComponent(jid)}/revoke-invite`
        );
        return response.inviteCode;
    }

    /**
     * Aceita convite para entrar em um grupo
     */
    public async groupAcceptInvite(code: string): Promise<string> {
        this.ensureInitialized();
        const response = await this.http.post<{ groupJid: string }>(
            `/sessions/${this._sessionId}/groups/accept-invite`,
            { inviteCode: code }
        );
        return response.groupJid;
    }

    /**
     * Obtém URL da foto de perfil
     */
    public async profilePictureUrl(jid: string, type: 'image' | 'preview' = 'preview'): Promise<string | undefined> {
        this.ensureInitialized();

        try {
            const res = await this.http.get<{ url: string }>(
                `/sessions/${this._sessionId}/contacts/${encodeURIComponent(jid)}/profile-picture`,
                { params: { type } }
            );
            return res.url;
        } catch {
            return undefined;
        }
    }

    /**
     * Atualiza foto de perfil
     */
    public async updateProfilePicture(jid: string, content: { url: string }): Promise<void> {
        this.ensureInitialized();
        await this.http.post(`/sessions/${this._sessionId}/contacts/${encodeURIComponent(jid)}/profile-picture`, content);
    }

    /**
     * Obtém status/about de um contato
     */
    public async fetchStatus(jid: string): Promise<{ status: string; setAt: Date } | undefined> {
        this.ensureInitialized();

        try {
            const response = await this.http.get<{ status: string | null; setAt: number | null }>(
                `/sessions/${this._sessionId}/contacts/${encodeURIComponent(jid)}/status`
            );
            if (!response.status) return undefined;
            return {
                status: response.status,
                setAt: new Date(response.setAt || Date.now())
            };
        } catch {
            return undefined;
        }
    }

    /**
     * Bloqueia um contato
     */
    public async updateBlockStatus(jid: string, action: 'block' | 'unblock'): Promise<void> {
        this.ensureInitialized();
        await this.http.put(
            `/sessions/${this._sessionId}/contacts/${encodeURIComponent(jid)}/${action}`
        );
    }

    /**
     * Obtém perfil comercial de um contato
     */
    public async getBusinessProfile(jid: string): Promise<unknown> {
        this.ensureInitialized();
        const response = await this.http.get<{ profile: unknown }>(
            `/sessions/${this._sessionId}/contacts/${encodeURIComponent(jid)}/business-profile`
        );
        return response.profile;
    }

    /**
     * Atualiza presença (online, offline, typing, recording)
     */
    public async sendPresenceUpdate(type: 'available' | 'unavailable' | 'composing' | 'recording' | 'paused', jid?: string): Promise<void> {
        this.ensureInitialized();
        await this.http.post(`/sessions/${this._sessionId}/presence`, { type, jid });
    }

    /**
     * Marca mensagens como lidas
     */
    public async readMessages(keys: proto.IMessageKey[]): Promise<void> {
        this.ensureInitialized();
        await this.http.post(`/sessions/${this._sessionId}/messages/read`, { keys });
    }

    /**
     * Inscreve para receber atualizações de presença de um contato
     */
    public async presenceSubscribe(jid: string): Promise<void> {
        this.ensureInitialized();
        await this.http.post(`/sessions/${this._sessionId}/presence/subscribe`, { jid });
    }

    /**
     * Reage a uma mensagem
     * @param jid JID do chat
     * @param messageId ID da mensagem
     * @param emoji Emoji da reação (string vazia para remover)
     * @param fromMe Se a mensagem foi enviada por você
     */
    public async sendReaction(
        jid: string,
        messageId: string,
        emoji: string,
        fromMe: boolean = false
    ): Promise<void> {
        this.ensureInitialized();
        await this.http.post(`/sessions/${this._sessionId}/messages/${encodeURIComponent(messageId)}/react`, {
            jid,
            emoji,
            fromMe
        });
    }

    /**
     * Deleta uma mensagem
     * @param jid JID do chat
     * @param messageId ID da mensagem
     * @param fromMe Se a mensagem foi enviada por você
     * @param forEveryone Se deve deletar para todos (true) ou só para mim (false)
     */
    public async deleteMessage(
        jid: string,
        messageId: string,
        fromMe: boolean = true,
        forEveryone: boolean = true
    ): Promise<void> {
        this.ensureInitialized();
        await this.http.delete(`/sessions/${this._sessionId}/messages/${encodeURIComponent(messageId)}`, {
            data: { jid, fromMe, forEveryone }
        });
    }

    /**
     * Modifica configurações do chat
     */
    public async chatModify(
        modification: {
            archive?: boolean;
            mute?: number | null;
            pin?: boolean;
        },
        jid: string
    ): Promise<void> {
        this.ensureInitialized();

        if (modification.archive !== undefined) {
            await this.http.post(`/sessions/${this._sessionId}/chats/${encodeURIComponent(jid)}/archive`, {
                archive: modification.archive
            });
        }

        if (modification.mute !== undefined) {
            await this.http.post(`/sessions/${this._sessionId}/chats/${encodeURIComponent(jid)}/mute`, {
                mute: modification.mute
            });
        }

        if (modification.pin !== undefined) {
            await this.http.post(`/sessions/${this._sessionId}/chats/${encodeURIComponent(jid)}/pin`, {
                pin: modification.pin
            });
        }
    }

    /**
     * Obtém todos os contatos sincronizados do WhatsApp
     * @param options Opções de paginação e busca
     */
    public async getContacts(options?: GetContactsOptions): Promise<{ total: number; contacts: Contact[] }> {
        this.ensureInitialized();

        const params: Record<string, string> = {};
        if (options?.limit) params.limit = options.limit.toString();
        if (options?.offset) params.offset = options.offset.toString();
        if (options?.search) params.search = options.search;

        const response = await this.http.get<{ sessionUUID: string; total: number; contacts: Contact[] }>(
            `/sessions/${this._sessionId}/contacts`,
            { params }
        );

        return {
            total: response.total,
            contacts: response.contacts
        };
    }

    /**
     * Obtém um contato específico pelo JID
     * @param contactId JID do contato (ex: 5511999999999@s.whatsapp.net)
     */
    public async getContact(contactId: string): Promise<Contact | null> {
        this.ensureInitialized();

        try {
            const response = await this.http.get<{ sessionUUID: string; contact: Contact }>(
                `/sessions/${this._sessionId}/contacts/${encodeURIComponent(contactId)}`
            );
            return response.contact;
        } catch {
            return null;
        }
    }

    /**
     * Injeta eventos vindos do Webhook
     * @param event Nome do evento (ex: 'messages.upsert')
     * @param data Dados do evento
     */
    public injectEvent(event: keyof WABotEvents | string, data: unknown): void {
        try {
            const normalizedData = WebhookParser.parse(event as string, data);

            // Atualiza status de conexão baseado no evento
            if (event === 'connection.update') {
                const update = normalizedData as { connection?: string; qrCode?: string };
                if (update.connection === 'open') {
                    this._connectionStatus = 'open';
                } else if (update.connection === 'close') {
                    this._connectionStatus = 'close';
                } else if (update.qrCode) {
                    this._connectionStatus = 'qrcode';
                }
            }

            this.ev.emit(event as string, normalizedData);
        } catch (error) {
            console.error(`[VexSDK] Error processing webhook event ${event}:`, error);
            this.ev.emit(event as string, data);
        }
    }

    /**
     * Verifica se o cliente está inicializado e ativo
     */
    private ensureInitialized(): void {
        if (this._isDestroyed) {
            throw new Error("VexClient has been destroyed. Create a new instance.");
        }
        if (!this._sessionId) {
            throw new Error("VexClient not yet initialized. Wait for connection or use waitForInit().");
        }
    }
}

/**
 * Factory function compatível com Baileys
 *
 * @example
 * ```typescript
 * import { makeWASocket } from '@vex/client-sdk';
 *
 * const sock = makeWASocket({
 *     url: 'http://localhost:5342',
 *     apiKey: 'your-api-key',
 *     backendUrl: 'http://your-server.com'  // webhooks em /api/v1/vex/webhooks
 * });
 * ```
 */
export const makeWASocket = (config: VexClientConfig): VexClient => {
    return new VexClient(config);
};

// Re-exports para compatibilidade
export { WebhookParser } from "./lib/WebhookParser";
export { HttpClient, HttpClientConfig, VexApiError } from "./lib/HttpClient";
export { SocketConnection, SocketConnectionConfig, SocketConnectionEvents } from "./lib/SocketConnection";
