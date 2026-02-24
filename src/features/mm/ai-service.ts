import axios from 'axios';
import { Ollama } from 'ollama';
import { GoogleGenerativeAI, Part } from '@google/generative-ai';

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string | Array<any>;
}

export interface CompletionOptions {
    model?: string;
    temperature?: number;
    max_tokens?: number;
}

export interface ChatResponse {
    content: string;
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

export class AIService {
    private apiKey: string;
    private apiHost: string;
    private endpoint: string;
    private ollama: Ollama;
    private provider: 'ollama' | 'rapidapi' | 'gemini';
    private ollamaModel: string;
    private geminiClient: GoogleGenerativeAI;
    private geminiModel: string;

    constructor() {
        this.apiKey = process.env.RAPIDAPI_KEY || '';
        this.apiHost = process.env.RAPIDAPI_HOST || '';
        this.endpoint = `https://${this.apiHost}/claude3`;

        // Initialize Ollama
        this.ollama = new Ollama({ host: 'http://127.0.0.1:11434' });

        // Initialize Gemini
        const geminiKey = process.env.GEMINI_API_KEY || '';
        this.geminiClient = new GoogleGenerativeAI(geminiKey);
        this.geminiModel = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';

        // Determine provider (Default to Gemini)
        this.provider = (process.env.AI_PROVIDER as any) || 'gemini';
        this.ollamaModel = process.env.OLLAMA_MODEL || 'goekdenizguelmez/JOSIEFIED-Qwen3:0.6b';

        if (this.provider === 'rapidapi' && (!this.apiKey || !this.apiHost)) {
            console.warn('⚠️  WARNING: RAPIDAPI_KEY or RAPIDAPI_HOST not found. Fallback to Gemini?');
        }

        console.log(`🤖 AI Service initialized using provider: ${this.provider.toUpperCase()}`);
        if (this.provider === 'ollama') {
            console.log(`   Model: ${this.ollamaModel}`);
        } else if (this.provider === 'gemini') {
            console.log(`   Model: ${this.geminiModel}`);
        }
    }

    /**
     * Generate an embedding for the given text using Ollama
     */
    async getEmbedding(text: string): Promise<number[]> {
        try {
            // Use a specific embedding model, or fall back to the main model if it supports it
            // Ideally 'nomic-embed-text' or 'mxbai-embed-large' for better quality
            const embeddingModel = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text:latest';

            const response = await this.ollama.embeddings({
                model: embeddingModel,
                prompt: text,
            });

            return response.embedding;
        } catch (error) {
            console.error('Error generating embedding via Ollama:', error);
            // Return empty array or throw? throwing is better to handle fallback
            throw new Error('Failed to generate embedding');
        }
    }

    /**
     * Send a chat completion request to the configured provider
     */
    async chatCompletion(messages: ChatMessage[], options: CompletionOptions = {}): Promise<ChatResponse> {
        // Special routing for local reasoning models
        if (options.model === 'goekdenizguelmez/JOSIEFIED-Qwen3:0.6b' || options.model?.includes('JOSIEFIED')) {
            return this.chatCompletionOllama(messages, options);
        }

        if (this.provider === 'ollama') {
            return this.chatCompletionOllama(messages, options);
        } else if (this.provider === 'gemini') {
            return this.chatCompletionGemini(messages, options);
        } else {
            return this.chatCompletionRapidAPI(messages, options);
        }
    }

    private async chatCompletionGemini(messages: ChatMessage[], options: CompletionOptions): Promise<ChatResponse> {
        try {
            const modelName = (options.model && options.model.includes('gemini')) ? options.model : this.geminiModel;

            // Extract system instruction if present
            const systemMessage = messages.find(m => m.role === 'system');
            const systemInstruction = systemMessage ? (systemMessage.content as string) : undefined;

            const model = this.geminiClient.getGenerativeModel({
                model: modelName,
                systemInstruction: systemInstruction
            });

            // Convert messages to Gemini format
            // Filter out system message as it's passed separately
            const history = messages
                .filter(m => m.role !== 'system')
                .map(m => {
                    let role = 'user';
                    if (m.role === 'assistant') role = 'model';

                    const parts: Part[] = [];

                    if (typeof m.content === 'string') {
                        parts.push({ text: m.content });
                    } else if (Array.isArray(m.content)) {
                        // Handle multi-modal content (like images)
                        // Assuming valid structure from suspect.ts which mimics OpenAI format
                        /*
                         { type: "image_url", image_url: { url: imageUrl } }
                        */
                        m.content.forEach((item: any) => {
                            if (item.type === 'text') {
                                parts.push({ text: item.text });
                            } else if (item.type === 'image_url') {
                                // For Gemini, we ideally need base64 or file URI. 
                                // But if it's a URL, Gemini 1.5 Pro / Flash can sometimes handle it if using Google AI Studio tools, 
                                // but via API usually requires base64. 
                                // However, for now, let's assume we might need to fetch it or just pass text if it's not supported easily.
                                // NOTE: This implementation might need adjustment for image URLs.
                                // For now, we'll try to rely on text description if possible or log a warning.
                                // TODO: Implement image fetching and base64 conversion if strictly needed.
                                parts.push({ text: `[Image: ${item.image_url.url}]` });
                            }
                        });
                    }

                    return {
                        role: role,
                        parts: parts
                    };
                });

            // The last message is the prompt for generateContent, but startChat validates history.
            // Let's use startChat with history (minus last) and sendMessage(last).

            if (history.length === 0) {
                return { content: "" };
            }

            const lastMessage = history[history.length - 1];
            const chatHistory = history.slice(0, history.length - 1);

            const chat = model.startChat({
                history: chatHistory,
                generationConfig: {
                    temperature: options.temperature,
                    maxOutputTokens: options.max_tokens,
                }
            });

            const result = await chat.sendMessage(lastMessage.parts);
            const response = result.response;
            const text = response.text();

            return {
                content: text,
                usage: {
                    // Gemini usage metadata is in response.usageMetadata
                    prompt_tokens: response.usageMetadata?.promptTokenCount || 0,
                    completion_tokens: response.usageMetadata?.candidatesTokenCount || 0,
                    total_tokens: response.usageMetadata?.totalTokenCount || 0
                }
            };

        } catch (error) {
            console.error('Error calling Gemini:', error);
            throw new Error('Failed to generate text via Gemini');
        }
    }

    private async chatCompletionOllama(messages: ChatMessage[], options: CompletionOptions): Promise<ChatResponse> {
        // Map messages to Ollama format (ensure content is string)
        const ollamaMessages = messages.map(m => {
            let content = '';
            if (typeof m.content === 'string') {
                content = m.content;
            } else if (Array.isArray(m.content)) {
                // Determine if we can extract text or if we need to warn
                content = m.content
                    .filter(c => c.type === 'text')
                    .map(c => c.text)
                    .join('\n');
                if (!content) content = '[Complex content not supported in Ollama yet]';
            }
            return {
                role: m.role,
                content: content
            };
        });

        try {
            const response = await this.ollama.chat({
                model: options.model || this.ollamaModel,
                messages: ollamaMessages,
                options: {
                    temperature: options.temperature,
                    // num_predict: options.max_tokens // Ollama uses num_predict instead of max_tokens
                }
            });

            return {
                content: response.message.content,
                usage: {
                    prompt_tokens: response.prompt_eval_count,
                    completion_tokens: response.eval_count,
                    total_tokens: response.prompt_eval_count + response.eval_count
                }
            };
        } catch (error) {
            console.error('Error calling Ollama:', error);
            throw new Error('Failed to generate text via Ollama');
        }
    }

    private async chatCompletionRapidAPI(messages: ChatMessage[], options: CompletionOptions): Promise<ChatResponse> {
        // Ensure content is string for RapidAPI/OpenAI-ish endpoint
        const apiMessages = messages.map(m => {
            if (Array.isArray(m.content)) {
                // Pass as is if the endpoint supports it, otherwise might need conversion.
                // Assuming the endpoint mimics OpenAI which supports array content.
                return m;
            }
            return m;
        });

        const payload = {
            messages: apiMessages,
            web_access: false
        };

        const config = {
            method: 'POST',
            url: this.endpoint,
            headers: {
                'content-type': 'application/json',
                'X-RapidAPI-Key': this.apiKey,
                'X-RapidAPI-Host': this.apiHost
            },
            data: payload
        };

        try {
            const response = await axios.request(config);

            if (response.data.status && response.data.result && response.data.result.length > 0) {
                return {
                    content: response.data.result,
                };
            }

            throw new Error('Unexpected response format from RapidAPI');
        } catch (error) {
            console.error('Error calling RapidAPI:', error);
            if (axios.isAxiosError(error) && error.response) {
                console.error('API Response Status:', error.response.status);
                // console.error('API Response Data:', JSON.stringify(error.response.data));
            }
            throw new Error('Failed to generate text via RapidAPI');
        }
    }

    /**
     * Helper for simple text generation
     */
    async generateText(systemPrompt: string, userPrompt: string, options?: CompletionOptions): Promise<string> {
        const result = await this.chatCompletion([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ], options);
        return result.content;
    }
}

// Singleton instance for easy import
export const aiService = new AIService();
export type RapidAPIService = AIService; // Alias for backward compatibility if needed
