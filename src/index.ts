import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { initializeDatabase, sequelize } from './database.js';
import Features from './features/index.js';
import { config } from './config.js';
import { logger } from './utils/logger.js';
import { apiServer } from './api.js';

// Define custom client type property
declare module 'discord.js' {
    interface Client {
        botcolor: number;
    }
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildBans,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildWebhooks,
        GatewayIntentBits.GuildIntegrations,
        GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
});

client.botcolor = config.bot.color;

let isShuttingDown = false;

export async function halt(code: number = 0) {
    if (isShuttingDown) {
        logger.warn('Shutdown already in progress...');
        return;
    }
    isShuttingDown = true;
    logger.info('Shutting down...');

    try {
        await sequelize.close();
        logger.info('Database connection closed.');

        await client.destroy();
        logger.info('Client destroyed.');

        process.exit(code);
    } catch (error) {
        logger.error('Error during shutdown:', error);
        process.exit(1);
    }
}

// Signal handlers
process.on('SIGUSR1', halt);
process.on('SIGUSR2', halt);
process.on('SIGINT', halt);
process.on('SIGTERM', halt);
process.on('exit', () => { if (!isShuttingDown) logger.info('Exiting...') });

// Global error handling
process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
    // Don't exit immediately, let the bot try to recover or be restarted by process manager if critical
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

async function start() {
    try {
        await initializeDatabase();

        await client.login(config.bot.token);
        logger.info('>>> Sherbot logged in.');

        apiServer.setClient(client);
        apiServer.start();

        await Features.run(client);
    } catch (error) {
        logger.error('Failed to start bot:', error);
        process.exit(1);
    }
}
const isMain = process.argv[1] && (process.argv[1].endsWith('index.ts') || process.argv[1].endsWith('index.js'));

if (isMain || process.env.RUN_BOT === 'true') {
    start();
}
