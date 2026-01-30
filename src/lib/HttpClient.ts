import axios, { AxiosInstance, AxiosRequestConfig, AxiosError } from "axios";
import axiosRetry from "axios-retry";

/**
 * Configuração do HttpClient
 */
export interface HttpClientConfig {
    /** URL base do servidor */
    baseURL: string;
    /** Chave de API para autenticação */
    apiKey: string;
    /** Número máximo de tentativas (default: 5) */
    maxRetries?: number;
    /** Delay base em ms entre tentativas (default: 1000) */
    baseDelay?: number;
    /** Timeout das requisições em ms (default: 30000) */
    timeout?: number;
}

/**
 * Erro específico do VEX
 */
export class VexApiError extends Error {
    public readonly statusCode: number;
    public readonly response: unknown;

    constructor(message: string, statusCode: number, response?: unknown) {
        super(message);
        this.name = 'VexApiError';
        this.statusCode = statusCode;
        this.response = response;
    }
}

/**
 * Cliente HTTP com retry automático e autenticação
 */
export class HttpClient {
    private client: AxiosInstance;
    private config: HttpClientConfig;

    constructor(config: HttpClientConfig) {
        this.config = {
            maxRetries: 5,
            baseDelay: 1000,
            timeout: 30000,
            ...config
        };

        this.client = axios.create({
            baseURL: this.config.baseURL,
            timeout: this.config.timeout,
            headers: {
                Authorization: `Bearer ${this.config.apiKey}`,
                "Content-Type": "application/json",
            },
        });

        this.setupRetry();
        this.setupInterceptors();
    }

    /**
     * Configura retry automático
     */
    private setupRetry(): void {
        axiosRetry(this.client, {
            retries: this.config.maxRetries!,
            retryDelay: (retryCount) => {
                // Exponential backoff: 1s, 2s, 4s, 8s, 16s
                return Math.min(this.config.baseDelay! * Math.pow(2, retryCount - 1), 16000);
            },
            retryCondition: (error: AxiosError) => {
                // Não tentar novamente se for erro de conexão recusada (servidor down)
                if (error.code === 'ECONNREFUSED') return false;

                // Não tentar novamente em erros de autenticação/autorização
                if (error.response?.status === 401 || error.response?.status === 403) return false;

                // Não tentar novamente em erros de validação
                if (error.response?.status === 400 || error.response?.status === 422) return false;

                // Tentar novamente em erros de rede e status >= 500
                return axiosRetry.isNetworkOrIdempotentRequestError(error) ||
                    (error.response?.status ? error.response.status >= 500 : false);
            },
            onRetry: (retryCount, error) => {
                console.warn(`[VexSDK] Retry ${retryCount}/${this.config.maxRetries}: ${error.message}`);
            }
        });
    }

    /**
     * Configura interceptors para tratamento de erros
     */
    private setupInterceptors(): void {
        this.client.interceptors.response.use(
            (response) => response,
            (error: AxiosError) => {
                if (error.response) {
                    const message = (error.response.data as { message?: string })?.message
                        || error.message
                        || 'Unknown error';

                    throw new VexApiError(
                        message,
                        error.response.status,
                        error.response.data
                    );
                }

                throw error;
            }
        );
    }

    /**
     * Requisição GET
     */
    public async get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
        const response = await this.client.get<T>(url, config);
        return response.data;
    }

    /**
     * Requisição POST
     */
    public async post<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
        const response = await this.client.post<T>(url, data, config);
        return response.data;
    }

    /**
     * Requisição PUT
     */
    public async put<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
        const response = await this.client.put<T>(url, data, config);
        return response.data;
    }

    /**
     * Requisição PATCH
     */
    public async patch<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
        const response = await this.client.patch<T>(url, data, config);
        return response.data;
    }

    /**
     * Requisição DELETE
     */
    public async delete<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
        const response = await this.client.delete<T>(url, config);
        return response.data;
    }

    /**
     * Atualiza a API Key
     */
    public updateApiKey(apiKey: string): void {
        this.config.apiKey = apiKey;
        this.client.defaults.headers.Authorization = `Bearer ${apiKey}`;
    }

    /**
     * Obtém a URL base configurada
     */
    public getBaseURL(): string {
        return this.config.baseURL;
    }
}
