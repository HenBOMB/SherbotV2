import 'dotenv/config';
import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { config } from './dist/config.js';
import { runScanner } from './dist/features/profiler.js';
import { initializeDatabase } from './dist/database.js';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Message, Partials.Channel, Partials.GuildMember]
});

async function run() {
    await initializeDatabase();
    
    client.on('ready', async () => {
        console.log(`Logged in as ${client.user.tag}!`);
        console.log('Starting forced profiler scan...');
        try {
            await runScanner(client);
            console.log('Force scan complete.');
        } catch (err) {
            console.error('Scan failed:', err);
        }
        process.exit(0);
    });

    client.login(config.bot.token);
}

run();
