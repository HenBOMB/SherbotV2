import express from 'express';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../../utils/logger.js';
import { getTipsStatus, setTipIndex, triggerTipNow, toggleTips, updateServerConfig, registerServer, setServerLanguage, removeServer, cleanupServers } from '../dailytips.js';
import { Client } from 'discord.js';
import { sequelize } from '../../database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Game state for dashboard
 */
export interface DashboardGameState {
    caseName: string;
    caseId: string;
    phase: string;
    timeRemaining: number;
    points: number;
    participantCount: number;
    suspects: SuspectState[];
    discoveredEvidence: EvidenceItem[];
}

export interface EvidenceItem {
    id: string;
    type: 'location' | 'dna' | 'log' | 'physical' | 'unknown';
    name: string;
    description?: string | null;
}

export interface SuspectState {
    id: string;
    name: string;
    avatar: string;
    isGuilty: boolean;
    composure: number;
    defensiveness: number;
    revealedSecrets: string[];
    totalSecrets: number;
    isBusy: boolean;
}

export interface DashboardEvent {
    timestamp: Date;
    type: 'interrogation' | 'tool_use' | 'secret_revealed' | 'game_start' | 'game_end' | 'accusation';
    message: string;
    details?: Record<string, unknown>;
}

/**
 * Dashboard server for real-time game monitoring
 */
export default class DashboardServer {
    private app: express.Application;
    private server: ReturnType<typeof createServer>;
    private io: SocketServer;
    private port: number;
    private events: DashboardEvent[] = [];
    private currentState: DashboardGameState | null = null;
    private client: Client;

    constructor(client: Client, port: number = 3001) {
        this.client = client;
        this.port = port;
        this.app = express();
        this.server = createServer(this.app);
        this.io = new SocketServer(this.server, {
            cors: {
                origin: '*',
                methods: ['GET', 'POST']
            }
        });

        this.app.use(express.json());
        this.setupRoutes();
        this.setupSocketHandlers();
    }

    /**
     * Setup Express routes
     */
    private setupRoutes(): void {
        // Serve static dashboard files
        const dashboardPath = path.join(__dirname, 'dashboard');
        this.app.use(express.static(dashboardPath));

        // API endpoint for current state
        this.app.get('/api/state', async (req, res) => {
            try {
                const tips = await getTipsStatus(this.client).catch(() => null);
                res.json({
                    state: this.currentState,
                    events: this.events.slice(-50),
                    tips
                });
            } catch (err) {
                res.status(500).json({ error: 'Internal server error' });
            }
        });

        // Toggle/Execute tips
        this.app.post('/api/tips/execute', async (req, res) => {
            const { serverId } = req.body;
            try {
                const result = await triggerTipNow(this.client, serverId);
                const updatedTips = await getTipsStatus(this.client);
                this.io.emit('tips', updatedTips);
                res.json(result);
            } catch (err: any) {
                res.status(500).json({ error: err.message });
            }
        });

        this.app.post('/api/tips/set-index', async (req, res) => {
            const { serverId, index } = req.body;
            try {
                const newIndex = await setTipIndex(serverId, parseInt(index));
                const updatedTips = await getTipsStatus(this.client);
                this.io.emit('tips', updatedTips);
                res.json({ success: true, newIndex });
            } catch (err: any) {
                res.status(500).json({ error: err.message });
            }
        });

        this.app.post('/api/tips/toggle', async (req, res) => {
            const { serverId, enabled } = req.body;
            try {
                const newState = await toggleTips(serverId, enabled);
                const updatedTips = await getTipsStatus(this.client);
                this.io.emit('tips', updatedTips);
                res.json({ success: true, enabled: newState });
            } catch (err: any) {
                res.status(500).json({ error: err.message });
            }
        });

        this.app.post('/api/tips/update-server', async (req, res) => {
            const { serverId, channelId } = req.body;
            try {
                await updateServerConfig(serverId, channelId);
                const updatedTips = await getTipsStatus(this.client);
                this.io.emit('tips', updatedTips);
                res.json({ success: true });
            } catch (err: any) {
                res.status(500).json({ error: err.message });
            }
        });

        this.app.post('/api/tips/register', async (req, res) => {
            const { serverId, channelId } = req.body;
            try {
                await registerServer(serverId, channelId);
                const updatedTips = await getTipsStatus(this.client);
                this.io.emit('tips', updatedTips);
                res.json({ success: true });
            } catch (err: any) {
                res.status(500).json({ error: err.message });
            }
        });

        this.app.post('/api/tips/set-language', async (req, res) => {
            const { serverId, language } = req.body;
            try {
                await setServerLanguage(serverId, language);
                const updatedTips = await getTipsStatus(this.client);
                this.io.emit('tips', updatedTips);
                res.json({ success: true, language: language });
            } catch (err: any) {
                res.status(500).json({ error: err.message });
            }
        });

        this.app.post('/api/tips/remove', async (req, res) => {
            const { serverId } = req.body;
            try {
                await removeServer(serverId);
                const updatedTips = await getTipsStatus(this.client);
                this.io.emit('tips', updatedTips);
                res.json({ success: true });
            } catch (err: any) {
                res.status(500).json({ error: err.message });
            }
        });

        this.app.post('/api/tips/cleanup', async (req, res) => {
            try {
                const removedCount = await cleanupServers(this.client);
                const updatedTips = await getTipsStatus(this.client);
                this.io.emit('tips', updatedTips);
                res.json({ success: true, removedCount });
            } catch (err: any) {
                res.status(500).json({ error: err.message });
            }
        });

        // Database Explorer Endpoints
        this.app.get('/api/db/tables', async (req, res) => {
            try {
                const [results] = await sequelize.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';");
                res.json({ tables: results.map((r: any) => r.name) });
            } catch (err: any) {
                res.status(500).json({ error: err.message });
            }
        });

        this.app.get('/api/db/table/:name', async (req, res) => {
            const { name } = req.params;
            const limit = parseInt(req.query.limit as string) || 100;
            const offset = parseInt(req.query.offset as string) || 0;

            try {
                // Get column info
                const [columns] = await sequelize.query(`PRAGMA table_info("${name}");`);
                // Get data
                const [rows] = await sequelize.query(`SELECT * FROM "${name}" LIMIT ${limit} OFFSET ${offset};`);
                // Get total count
                const [count]: any = await sequelize.query(`SELECT COUNT(*) as total FROM "${name}";`);

                res.json({
                    columns,
                    rows,
                    total: count[0].total,
                    limit,
                    offset
                });
            } catch (err: any) {
                res.status(500).json({ error: err.message });
            }
        });

        // Root serves the dashboard
        this.app.get('/', (req, res) => {
            res.sendFile(path.join(dashboardPath, 'index.html'));
        });
    }

    /**
     * Setup Socket.IO handlers
     */
    private setupSocketHandlers(): void {
        this.io.on('connection', (socket) => {
            logger.info(`Dashboard client connected: ${socket.id}`);

            // Send current state on connect
            if (this.currentState) {
                socket.emit('state', this.currentState);
            }
            socket.emit('events', this.events.slice(-50));

            getTipsStatus(this.client).then(tips => {
                socket.emit('tips', tips);
            }).catch(() => { });

            socket.on('disconnect', () => {
                logger.info(`Dashboard client disconnected: ${socket.id}`);
            });
        });
    }

    /**
     * Start the dashboard server
     */
    start(): void {
        this.server.listen(this.port, () => {
            logger.info(`📊 Dashboard running at http://localhost:${this.port}`);
        });
    }

    /**
     * Stop the server
     */
    stop(): void {
        this.server.close();
    }

    /**
     * Update and broadcast game state
     */
    updateState(state: DashboardGameState): void {
        this.currentState = state;
        this.io.emit('state', state);
    }

    /**
     * Clear state when game ends
     */
    clearState(): void {
        this.currentState = null;
        this.events = [];
        this.io.emit('state', null);
        this.io.emit('events', []);
    }

    /**
     * Add and broadcast an event
     */
    addEvent(type: DashboardEvent['type'], message: string, details?: Record<string, unknown>): void {
        const event: DashboardEvent = {
            timestamp: new Date(),
            type,
            message,
            details
        };

        this.events.push(event);
        // Keep only last 100 events
        if (this.events.length > 100) {
            this.events = this.events.slice(-100);
        }

        this.io.emit('event', event);
    }

    /**
     * Get connected client count
     */
    getClientCount(): number {
        return this.io.engine.clientsCount;
    }
    /**
     * Build dashboard state from game objects
     */
    buildGameState(activeGame: any, suspects: Map<string, any>, evidence: Set<string>): DashboardGameState {
        if (!activeGame || !activeGame.state) {
            return {
                caseName: 'No Active Game',
                caseId: '',
                phase: 'ended',
                timeRemaining: 0,
                points: 0,
                participantCount: 0,
                suspects: [],
                discoveredEvidence: []
            };
        }

        const state = activeGame.state;
        const uniqueSuspects = Array.from(new Set(suspects.values()));
        const suspectStates = uniqueSuspects.map(s => s.getDashboardState());

        // Enhanced evidence mapping
        const allEvidence: EvidenceItem[] = [
            ...Array.from(state.discoveredLocations || []).map(l => ({
                id: `location_${l}`,
                name: (l as string).replace(/_/g, ' '),
                type: 'location' as const
            })),
            ...Array.from(evidence).map(e => {
                let type: EvidenceItem['type'] = 'unknown';
                let name = e;
                let description: string | null = null;

                if (e.startsWith('dna_')) {
                    type = 'dna';
                    name = e.replace('dna_', '').replace(/_/g, ' ');
                } else if (e.startsWith('logs_')) {
                    type = 'log';
                    name = e.replace('logs_', '');
                } else if (e.startsWith('physical_')) {
                    type = 'physical';
                    const itemId = e.replace('physical_', '');
                    name = itemId.replace(/_/g, ' ');
                    description = activeGame.getPhysicalEvidence(itemId);
                }

                return { id: e, name, type, description };
            })
        ];

        return {
            caseName: activeGame.config.name,
            caseId: activeGame.config.id,
            phase: state.phase,
            timeRemaining: activeGame.getRemainingTime(),
            points: state.points,
            participantCount: state.participants.size,
            suspects: suspectStates,
            discoveredEvidence: allEvidence
        };
    }
}
