import { Request, Response, NextFunction, Router } from "express";
import { WebhookParser } from "./WebhookParser";

/**
 * Interface para o payload do webhook do VEX Server
 */
export interface VexWebhookPayload {
    event: string;
    sessionUUID: string;
    data: any;
    timestamp: string;
}

/**
 * Tipo para callback de eventos
 */
export type WebhookEventCallback = (
    sessionUUID: string,
    event: string,
    data: any
) => void | Promise<void>;

/**
 * Tipo para callback de sessão não encontrada
 */
export type SessionNotFoundCallback = (
    sessionUUID: string,
    event: string
) => void | Promise<void>;

/**
 * Configuração do WebhookManager
 */
export interface WebhookManagerConfig {
    /**
     * Função para encontrar a instância VexClient pelo sessionUUID
     * Se não fornecida, usa o registry interno do SDK
     */
    findInstance?: (sessionUUID: string) => any | undefined;

    /**
     * Callback chamado quando a sessão não é encontrada no registry
     * Útil para logging ou criação dinâmica de instâncias
     */
    onSessionNotFound?: SessionNotFoundCallback;

    /**
     * Callback chamado antes de injetar o evento na instância
     * Útil para logging, métricas, ou transformações customizadas
     */
    onBeforeEvent?: WebhookEventCallback;

    /**
     * Callback chamado após injetar o evento na instância
     * Útil para logging, métricas, ou ações pós-processamento
     */
    onAfterEvent?: WebhookEventCallback;

    /**
     * Se true, loga todos os eventos recebidos (default: false)
     */
    verbose?: boolean;

    /**
     * Prefixo para os logs (default: "[VexSDK Webhook]")
     */
    logPrefix?: string;
}

/**
 * WebhookManager - Gerenciador de webhooks para o VEX SDK
 *
 * Este manager cria um middleware Express que recebe webhooks do VEX Server
 * e roteia os eventos para as instâncias VexClient corretas automaticamente.
 *
 * @example
 * ```typescript
 * import express from 'express';
 * import { createWebhookMiddleware } from '@vex/client-sdk';
 *
 * const app = express();
 *
 * // Uma única linha para configurar webhooks!
 * app.use('/api/v1/vex/webhooks', createWebhookMiddleware());
 *
 * // Com configuração customizada
 * app.use('/api/v1/vex/webhooks', createWebhookMiddleware({
 *     verbose: true,
 *     onSessionNotFound: (sessionUUID) => {
 *         console.log(`Session ${sessionUUID} not found, creating...`);
 *         // Criar instância dinamicamente se necessário
 *     }
 * }));
 * ```
 */
export class WebhookManager {
    private config: WebhookManagerConfig;
    private logPrefix: string;

    constructor(config: WebhookManagerConfig = {}) {
        this.config = config;
        this.logPrefix = config.logPrefix || "[VexSDK Webhook]";
    }

    /**
     * Cria o middleware Express para receber webhooks
     */
    public createMiddleware(): Router {
        const router = Router();

        // Middleware para parsear JSON (caso não esteja configurado globalmente)
        router.use((req: Request, res: Response, next: NextFunction) => {
            // Se o body já está parseado, continua
            if (req.body && typeof req.body === 'object') {
                return next();
            }

            // Se não, tenta parsear
            let data = '';
            req.on('data', chunk => { data += chunk; });
            req.on('end', () => {
                try {
                    req.body = JSON.parse(data);
                    next();
                } catch (e) {
                    res.status(400).json({ error: 'Invalid JSON' });
                }
            });
        });

        // Rota principal para receber webhooks
        router.post('/', this.handleWebhook.bind(this));

        // Rota de health check
        router.get('/health', (_req: Request, res: Response) => {
            res.json({ status: 'ok', service: 'vex-webhook-manager' });
        });

        return router;
    }

    /**
     * Handler principal do webhook
     */
    private async handleWebhook(req: Request, res: Response): Promise<void> {
        try {
            const payload = req.body as VexWebhookPayload;
            const { event, sessionUUID, data, timestamp } = payload;

            // Validação básica
            if (!event || !sessionUUID) {
                if (this.config.verbose) {
                    console.warn(this.logPrefix, "Invalid payload - missing event or sessionUUID", payload);
                }
                res.status(400).json({ error: "Invalid payload - missing event or sessionUUID" });
                return;
            }

            if (this.config.verbose) {
                console.log(this.logPrefix, `Received ${event} for session ${sessionUUID}`);
            }

            // Busca a instância VexClient
            const instance = this.findInstance(sessionUUID);

            if (!instance) {
                if (this.config.verbose) {
                    console.warn(this.logPrefix, `Session ${sessionUUID} not found in registry`);
                }

                // Chama callback de sessão não encontrada se configurado
                if (this.config.onSessionNotFound) {
                    try {
                        await this.config.onSessionNotFound(sessionUUID, event);
                    } catch (e) {
                        console.error(this.logPrefix, "Error in onSessionNotFound callback:", e);
                    }
                }

                // Retorna 200 mesmo assim para não causar retries no VEX Server
                // A sessão pode ter sido destruída intencionalmente
                res.status(200).json({ success: true, warning: "Session not found" });
                return;
            }

            // Callback antes do evento
            if (this.config.onBeforeEvent) {
                try {
                    await this.config.onBeforeEvent(sessionUUID, event, data);
                } catch (e) {
                    console.error(this.logPrefix, "Error in onBeforeEvent callback:", e);
                }
            }

            // Normaliza e injeta o evento na instância
            const normalizedData = WebhookParser.parse(event, data);
            instance.injectEvent(event, normalizedData);

            // Callback após o evento
            if (this.config.onAfterEvent) {
                try {
                    await this.config.onAfterEvent(sessionUUID, event, normalizedData);
                } catch (e) {
                    console.error(this.logPrefix, "Error in onAfterEvent callback:", e);
                }
            }

            res.status(200).json({ success: true });

        } catch (error: any) {
            console.error(this.logPrefix, "Error processing webhook:", error);
            res.status(500).json({ error: "Internal server error" });
        }
    }

    /**
     * Encontra a instância VexClient pelo sessionUUID
     */
    private findInstance(sessionUUID: string): any | undefined {
        // Se foi fornecida uma função customizada, usa ela
        if (this.config.findInstance) {
            return this.config.findInstance(sessionUUID);
        }

        // Usa o registry interno do SDK
        // Importação dinâmica para evitar circular dependency
        try {
            const { getInstance } = require('../index');
            return getInstance(sessionUUID);
        } catch (e) {
            console.error(this.logPrefix, "Error accessing instance registry:", e);
            return undefined;
        }
    }
}

/**
 * Cria um middleware Express para receber webhooks do VEX Server
 *
 * Esta é a forma mais simples de configurar webhooks no seu backend.
 * O middleware automaticamente:
 * - Recebe eventos do VEX Server
 * - Roteia para a instância VexClient correta
 * - Normaliza os dados (Buffer, timestamps, etc)
 * - Injeta o evento no EventEmitter da instância
 *
 * @param config Configuração opcional do webhook manager
 * @returns Router Express pronto para uso
 *
 * @example
 * ```typescript
 * import express from 'express';
 * import { createWebhookMiddleware } from '@vex/client-sdk';
 *
 * const app = express();
 * app.use(express.json()); // Importante!
 *
 * // Configuração mínima - uma linha!
 * app.use('/api/v1/vex/webhooks', createWebhookMiddleware());
 *
 * // Com logging
 * app.use('/api/v1/vex/webhooks', createWebhookMiddleware({ verbose: true }));
 *
 * // Com callbacks customizados
 * app.use('/api/v1/vex/webhooks', createWebhookMiddleware({
 *     onBeforeEvent: (sessionUUID, event, data) => {
 *         console.log(`[${sessionUUID}] ${event}`);
 *     },
 *     onSessionNotFound: async (sessionUUID, event) => {
 *         // Tentar recriar a sessão automaticamente
 *         const whatsapp = await Whatsapp.findOne({ where: { token: sessionUUID } });
 *         if (whatsapp) {
 *             await initVexSocket(whatsapp);
 *         }
 *     }
 * }));
 * ```
 */
export const createWebhookMiddleware = (config?: WebhookManagerConfig): Router => {
    const manager = new WebhookManager(config);
    return manager.createMiddleware();
};

/**
 * Processa um payload de webhook manualmente
 *
 * Útil quando você precisa receber webhooks de uma forma diferente
 * (ex: via WebSocket, fila de mensagens, etc)
 *
 * @param payload Payload do webhook
 * @param config Configuração opcional
 * @returns Promise que resolve quando o evento foi processado
 *
 * @example
 * ```typescript
 * import { processWebhookPayload } from '@vex/client-sdk';
 *
 * // Recebendo via WebSocket customizado
 * ws.on('message', async (data) => {
 *     const payload = JSON.parse(data);
 *     await processWebhookPayload(payload);
 * });
 *
 * // Recebendo via fila (RabbitMQ, SQS, etc)
 * queue.on('message', async (msg) => {
 *     const payload = JSON.parse(msg.content);
 *     await processWebhookPayload(payload, {
 *         verbose: true,
 *         onAfterEvent: () => msg.ack()
 *     });
 * });
 * ```
 */
export const processWebhookPayload = async (
    payload: VexWebhookPayload,
    config?: WebhookManagerConfig
): Promise<{ success: boolean; error?: string }> => {
    const manager = new WebhookManager(config);
    const { event, sessionUUID, data } = payload;

    if (!event || !sessionUUID) {
        return { success: false, error: "Invalid payload - missing event or sessionUUID" };
    }

    // Busca a instância
    let instance: any;
    if (config?.findInstance) {
        instance = config.findInstance(sessionUUID);
    } else {
        try {
            const { getInstance } = require('../index');
            instance = getInstance(sessionUUID);
        } catch (e) {
            return { success: false, error: "Error accessing instance registry" };
        }
    }

    if (!instance) {
        if (config?.onSessionNotFound) {
            await config.onSessionNotFound(sessionUUID, event);
        }
        return { success: false, error: "Session not found" };
    }

    // Callbacks e injeção
    if (config?.onBeforeEvent) {
        await config.onBeforeEvent(sessionUUID, event, data);
    }

    const normalizedData = WebhookParser.parse(event, data);
    instance.injectEvent(event, normalizedData);

    if (config?.onAfterEvent) {
        await config.onAfterEvent(sessionUUID, event, normalizedData);
    }

    return { success: true };
};
