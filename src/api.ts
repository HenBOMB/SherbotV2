import express from 'express';
import { createServer, Server as HttpServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import { logger } from './utils/logger.js';
import { Client, TextChannel } from 'discord.js';

/**
 * Global API and WebSocket Server
 */
export class APIServer {
    private static instance: APIServer;
    public app: express.Application;
    public server: HttpServer;
    public io: SocketServer;
    private client?: Client;
    private port: number = 3001;

    private constructor() {
        this.app = express();
        this.server = createServer(this.app);
        this.io = new SocketServer(this.server, {
            cors: {
                origin: '*',
                methods: ['GET', 'POST']
            }
        });

        this.app.use(express.json());
        this.setupDefaultRoutes();
    }

    public static getInstance(): APIServer {
        if (!APIServer.instance) {
            APIServer.instance = new APIServer();
        }
        return APIServer.instance;
    }

    public setClient(client: Client) {
        this.client = client;
    }

    private setupDefaultRoutes() {
        // Health check
        this.app.get('/health', (req, res) => {
            res.json({ status: 'ok', bot: this.client?.user?.tag });
        });

        // Chat History API for n8n/AI
        this.app.get('/api/history/:channelId', async (req, res) => {
            if (!this.client) return res.status(503).json({ error: 'Client not ready' });

            const { channelId } = req.params;
            const limit = parseInt(req.query.limit as string) || 50;

            try {
                const channel = await this.client.channels.fetch(channelId);
                if (!channel || !(channel instanceof TextChannel)) {
                    return res.status(404).json({ error: 'Channel not found or not a text channel' });
                }

                const messages = await channel.messages.fetch({ limit });
                const history = messages.map(m => ({
                    id: m.id,
                    author: m.author.displayName,
                    authorId: m.author.id,
                    content: m.cleanContent,
                    timestamp: m.createdAt,
                    isBot: m.author.bot,
                    attachments: m.attachments.map(a => a.url)
                }));

                res.json({
                    channelId,
                    channelName: channel.name,
                    limit,
                    history: history.reverse()
                });
            } catch (error: any) {
                logger.error(`API History error: ${error.message}`);
                res.status(500).json({ error: error.message });
            }
        });
    }

    public start(port?: number) {
        const finalPort = port || this.port;
        this.server.listen(finalPort, () => {
            logger.info(`🌐 Global API running at http://localhost:${finalPort}`);
        });
    }
}

export const apiServer = APIServer.getInstance();
