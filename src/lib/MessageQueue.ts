import { EventEmitter } from "eventemitter3";
import * as fs from "fs";
import * as path from "path";

/**
 * Item na fila de mensagens
 */
export interface QueuedMessage {
    id: string;
    sessionId: string;
    jid: string;
    message: unknown;
    options?: unknown;
    createdAt: number;
    attempts: number;
    lastAttempt: number | null;
    lastError: string | null;
}

/**
 * Configuração do MessageQueue
 */
export interface MessageQueueConfig {
    /** Diretório para persistir a fila (default: .vex-queue) */
    persistDir?: string;
    /** Máximo de tentativas por mensagem (default: 100) */
    maxAttempts?: number;
    /** Delay base entre tentativas em ms (default: 5000) */
    baseDelay?: number;
    /** Delay máximo entre tentativas em ms (default: 60000) */
    maxDelay?: number;
    /** Intervalo para salvar fila em disco em ms (default: 5000) */
    persistInterval?: number;
    /** Tempo máximo para manter mensagem na fila em ms (default: 48 horas) */
    maxAge?: number;
    /** Tamanho máximo da fila por sessão (default: 10000) */
    maxQueueSize?: number;
}

/**
 * Eventos emitidos pelo MessageQueue
 */
export interface MessageQueueEvents {
    "message:queued": (message: QueuedMessage) => void;
    "message:sent": (message: QueuedMessage, result: unknown) => void;
    "message:failed": (message: QueuedMessage, error: Error) => void;
    "message:expired": (message: QueuedMessage) => void;
    "queue:processing": (sessionId: string, count: number) => void;
    "queue:empty": (sessionId: string) => void;
    "queue:error": (error: Error) => void;
}

type SendFunction = (
    sessionId: string,
    jid: string,
    message: unknown,
    options?: unknown
) => Promise<unknown>;

/**
 * MessageQueue - Fila persistente para mensagens quando VEX está offline
 *
 * Garante entrega de mensagens mesmo quando o servidor VEX está temporariamente
 * indisponível. As mensagens são salvas em disco e reenviadas quando o servidor volta.
 */
export class MessageQueue extends EventEmitter<MessageQueueEvents> {
    private queues: Map<string, QueuedMessage[]> = new Map();
    private config: Required<MessageQueueConfig>;
    private persistTimer: ReturnType<typeof setInterval> | null = null;
    private processingTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
    private isProcessing: Map<string, boolean> = new Map();
    private sendFn: SendFunction | null = null;
    private serverOnline: boolean = true;
    private isDirty: boolean = false;

    constructor(config: MessageQueueConfig = {}) {
        super();

        this.config = {
            persistDir: config.persistDir || ".vex-queue",
            maxAttempts: config.maxAttempts || 100,
            baseDelay: config.baseDelay || 5000,
            maxDelay: config.maxDelay || 60000,
            persistInterval: config.persistInterval || 5000,
            maxAge: config.maxAge || 48 * 60 * 60 * 1000, // 48 horas
            maxQueueSize: config.maxQueueSize || 10000
        };

        // Carrega fila persistida do disco
        this.loadFromDisk();

        // Inicia timer de persistência
        this.startPersistTimer();
    }

    /**
     * Define a função de envio de mensagens
     * Deve ser chamada pelo VexClient para conectar a fila ao HttpClient
     */
    public setSendFunction(fn: SendFunction): void {
        this.sendFn = fn;
    }

    /**
     * Notifica que o servidor está online - processa filas
     */
    public setServerOnline(): void {
        if (!this.serverOnline) {
            console.log("[VexSDK Queue] Server online, processing queued messages...");
            this.serverOnline = true;

            // Processa todas as filas
            for (const sessionId of this.queues.keys()) {
                this.scheduleProcessing(sessionId);
            }
        }
    }

    /**
     * Notifica que o servidor está offline - para processamento
     */
    public setServerOffline(): void {
        if (this.serverOnline) {
            console.log("[VexSDK Queue] Server offline, queuing messages...");
            this.serverOnline = false;

            // Cancela processamento em andamento
            for (const [sessionId, timer] of this.processingTimers) {
                clearTimeout(timer);
            }
            this.processingTimers.clear();
        }
    }

    /**
     * Adiciona mensagem à fila
     */
    public enqueue(
        sessionId: string,
        jid: string,
        message: unknown,
        options?: unknown
    ): QueuedMessage {
        let queue = this.queues.get(sessionId);
        if (!queue) {
            queue = [];
            this.queues.set(sessionId, queue);
        }

        // Verifica tamanho máximo da fila
        if (queue.length >= this.config.maxQueueSize) {
            // Remove mensagens mais antigas para fazer espaço
            const removed = queue.shift();
            if (removed) {
                console.warn(`[VexSDK Queue] Queue full for ${sessionId}, removed oldest message`);
                this.emit("message:expired", removed);
            }
        }

        const queuedMessage: QueuedMessage = {
            id: this.generateId(),
            sessionId,
            jid,
            message,
            options,
            createdAt: Date.now(),
            attempts: 0,
            lastAttempt: null,
            lastError: null
        };

        queue.push(queuedMessage);
        this.isDirty = true;

        console.log(`[VexSDK Queue] Message queued for ${sessionId}: ${queuedMessage.id}`);
        this.emit("message:queued", queuedMessage);

        // Se servidor está online, agenda processamento
        if (this.serverOnline) {
            this.scheduleProcessing(sessionId);
        }

        return queuedMessage;
    }

    /**
     * Retorna estatísticas da fila
     */
    public getStats(): {
        totalSessions: number;
        totalMessages: number;
        bySession: Record<string, number>;
    } {
        const stats = {
            totalSessions: this.queues.size,
            totalMessages: 0,
            bySession: {} as Record<string, number>
        };

        for (const [sessionId, queue] of this.queues) {
            stats.bySession[sessionId] = queue.length;
            stats.totalMessages += queue.length;
        }

        return stats;
    }

    /**
     * Retorna mensagens pendentes de uma sessão
     */
    public getPendingMessages(sessionId: string): QueuedMessage[] {
        return this.queues.get(sessionId) || [];
    }

    /**
     * Remove uma mensagem específica da fila
     */
    public removeMessage(sessionId: string, messageId: string): boolean {
        const queue = this.queues.get(sessionId);
        if (!queue) return false;

        const index = queue.findIndex(m => m.id === messageId);
        if (index === -1) return false;

        queue.splice(index, 1);
        this.isDirty = true;
        return true;
    }

    /**
     * Limpa a fila de uma sessão
     */
    public clearSession(sessionId: string): void {
        this.queues.delete(sessionId);
        this.isDirty = true;

        // Cancela processamento
        const timer = this.processingTimers.get(sessionId);
        if (timer) {
            clearTimeout(timer);
            this.processingTimers.delete(sessionId);
        }
    }

    /**
     * Limpa todas as filas
     */
    public clearAll(): void {
        this.queues.clear();
        this.isDirty = true;

        // Cancela todos os processamentos
        for (const timer of this.processingTimers.values()) {
            clearTimeout(timer);
        }
        this.processingTimers.clear();
    }

    /**
     * Destrói a fila e salva em disco
     */
    public destroy(): void {
        // Para timer de persistência
        if (this.persistTimer) {
            clearInterval(this.persistTimer);
            this.persistTimer = null;
        }

        // Cancela todos os processamentos
        for (const timer of this.processingTimers.values()) {
            clearTimeout(timer);
        }
        this.processingTimers.clear();

        // Salva estado final
        this.saveToDisk();
    }

    /**
     * Agenda processamento da fila
     */
    private scheduleProcessing(sessionId: string, delayMs: number = 0): void {
        // Não processa se servidor offline
        if (!this.serverOnline) return;

        // Não agenda se já tem processamento pendente
        if (this.processingTimers.has(sessionId)) return;

        // Não agenda se já está processando
        if (this.isProcessing.get(sessionId)) return;

        const timer = setTimeout(() => {
            this.processingTimers.delete(sessionId);
            this.processQueue(sessionId);
        }, delayMs);

        this.processingTimers.set(sessionId, timer);
    }

    /**
     * Processa a fila de uma sessão
     */
    private async processQueue(sessionId: string): Promise<void> {
        if (!this.sendFn) {
            console.warn("[VexSDK Queue] No send function configured");
            return;
        }

        if (!this.serverOnline) {
            console.log("[VexSDK Queue] Server offline, skipping processing");
            return;
        }

        const queue = this.queues.get(sessionId);
        if (!queue || queue.length === 0) {
            this.emit("queue:empty", sessionId);
            return;
        }

        // Marca como processando
        this.isProcessing.set(sessionId, true);

        this.emit("queue:processing", sessionId, queue.length);
        console.log(`[VexSDK Queue] Processing ${queue.length} messages for ${sessionId}`);

        // Remove mensagens expiradas
        this.cleanExpiredMessages(sessionId);

        // Processa uma mensagem por vez (FIFO)
        while (queue.length > 0 && this.serverOnline) {
            const message = queue[0];

            // Verifica se ainda pode tentar
            if (message.attempts >= this.config.maxAttempts) {
                console.error(`[VexSDK Queue] Max attempts reached for ${message.id}`);
                queue.shift();
                this.isDirty = true;
                this.emit("message:failed", message, new Error("Max attempts reached"));
                continue;
            }

            try {
                message.attempts++;
                message.lastAttempt = Date.now();
                this.isDirty = true;

                console.log(`[VexSDK Queue] Sending ${message.id} (attempt ${message.attempts})`);

                const result = await this.sendFn(
                    message.sessionId,
                    message.jid,
                    message.message,
                    message.options
                );

                // Sucesso - remove da fila
                queue.shift();
                this.isDirty = true;

                console.log(`[VexSDK Queue] Message ${message.id} sent successfully`);
                this.emit("message:sent", message, result);

            } catch (error: any) {
                message.lastError = error?.message || "Unknown error";
                this.isDirty = true;

                console.error(`[VexSDK Queue] Failed to send ${message.id}:`, message.lastError);

                // Se servidor ficou offline, para processamento
                if (!this.serverOnline) {
                    console.log("[VexSDK Queue] Server went offline, pausing processing");
                    break;
                }

                // Calcula delay para próxima tentativa
                const delay = this.calculateDelay(message.attempts);
                console.log(`[VexSDK Queue] Retrying ${message.id} in ${delay}ms`);

                // Move para o final da fila para tentar outras mensagens
                queue.shift();
                queue.push(message);
                this.isDirty = true;

                // Agenda próximo processamento com delay
                this.isProcessing.set(sessionId, false);
                this.scheduleProcessing(sessionId, delay);
                return;
            }
        }

        this.isProcessing.set(sessionId, false);

        // Se ainda tem mensagens, agenda próximo processamento
        if (queue.length > 0 && this.serverOnline) {
            this.scheduleProcessing(sessionId, 1000);
        } else if (queue.length === 0) {
            this.emit("queue:empty", sessionId);
        }
    }

    /**
     * Calcula delay com exponential backoff
     */
    private calculateDelay(attempts: number): number {
        const delay = Math.min(
            this.config.baseDelay * Math.pow(2, attempts - 1),
            this.config.maxDelay
        );
        // Adiciona jitter de até 20%
        const jitter = delay * 0.2 * Math.random();
        return Math.floor(delay + jitter);
    }

    /**
     * Remove mensagens expiradas
     */
    private cleanExpiredMessages(sessionId: string): void {
        const queue = this.queues.get(sessionId);
        if (!queue) return;

        const now = Date.now();
        const initialLength = queue.length;

        // Filtra mensagens não expiradas
        const validMessages = queue.filter(m => {
            const isExpired = (now - m.createdAt) > this.config.maxAge;
            if (isExpired) {
                this.emit("message:expired", m);
            }
            return !isExpired;
        });

        if (validMessages.length !== initialLength) {
            this.queues.set(sessionId, validMessages);
            this.isDirty = true;
            console.log(`[VexSDK Queue] Cleaned ${initialLength - validMessages.length} expired messages`);
        }
    }

    /**
     * Gera ID único para mensagem
     */
    private generateId(): string {
        return `q_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    }

    /**
     * Inicia timer de persistência
     */
    private startPersistTimer(): void {
        this.persistTimer = setInterval(() => {
            if (this.isDirty) {
                this.saveToDisk();
            }
        }, this.config.persistInterval);
    }

    /**
     * Salva filas em disco
     */
    private saveToDisk(): void {
        try {
            // Cria diretório se não existe
            if (!fs.existsSync(this.config.persistDir)) {
                fs.mkdirSync(this.config.persistDir, { recursive: true });
            }

            // Converte Map para objeto serializável
            const data: Record<string, QueuedMessage[]> = {};
            for (const [sessionId, queue] of this.queues) {
                if (queue.length > 0) {
                    data[sessionId] = queue;
                }
            }

            const filePath = path.join(this.config.persistDir, "queue.json");
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

            this.isDirty = false;
            console.log(`[VexSDK Queue] Saved ${Object.keys(data).length} queues to disk`);

        } catch (error: any) {
            console.error("[VexSDK Queue] Error saving to disk:", error?.message);
            this.emit("queue:error", error);
        }
    }

    /**
     * Carrega filas do disco
     */
    private loadFromDisk(): void {
        try {
            const filePath = path.join(this.config.persistDir, "queue.json");

            if (!fs.existsSync(filePath)) {
                console.log("[VexSDK Queue] No persisted queue found");
                return;
            }

            const content = fs.readFileSync(filePath, "utf-8");
            const data = JSON.parse(content) as Record<string, QueuedMessage[]>;

            // Carrega filas e filtra mensagens expiradas
            const now = Date.now();
            let totalLoaded = 0;
            let totalExpired = 0;

            for (const [sessionId, messages] of Object.entries(data)) {
                const validMessages = messages.filter(m => {
                    const isExpired = (now - m.createdAt) > this.config.maxAge;
                    if (isExpired) totalExpired++;
                    return !isExpired;
                });

                if (validMessages.length > 0) {
                    this.queues.set(sessionId, validMessages);
                    totalLoaded += validMessages.length;
                }
            }

            console.log(`[VexSDK Queue] Loaded ${totalLoaded} messages from disk (${totalExpired} expired)`);

        } catch (error: any) {
            console.error("[VexSDK Queue] Error loading from disk:", error?.message);
        }
    }
}

// Singleton global para uso compartilhado
let globalQueue: MessageQueue | null = null;

/**
 * Obtém instância singleton do MessageQueue
 */
export const getMessageQueue = (config?: MessageQueueConfig): MessageQueue => {
    if (!globalQueue) {
        globalQueue = new MessageQueue(config);
    }
    return globalQueue;
};

/**
 * Destrói instância singleton
 */
export const destroyMessageQueue = (): void => {
    if (globalQueue) {
        globalQueue.destroy();
        globalQueue = null;
    }
};
