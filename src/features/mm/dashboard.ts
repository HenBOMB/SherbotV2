import express from 'express';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../../utils/logger.js';

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
    discoveredEvidence: string[];
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
    type: 'interrogation' | 'tool_use' | 'secret_revealed' | 'game_start' | 'game_end';
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

    constructor(port: number = 3001) {
        this.port = port;
        this.app = express();
        this.server = createServer(this.app);
        this.io = new SocketServer(this.server, {
            cors: {
                origin: '*',
                methods: ['GET', 'POST']
            }
        });

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
        this.app.get('/api/state', (req, res) => {
            res.json({
                state: this.currentState,
                events: this.events.slice(-50) // Last 50 events
            });
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
}
