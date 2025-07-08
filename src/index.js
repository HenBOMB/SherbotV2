(await import('dotenv')).config();

import { Client } from 'discord.js';
import { Sequelize, Server } from './models.js';
import Features from './features.js';

var closed = false;

async function halt() {
    if(closed) {
        console.log('Already halting..')
        return;
    }
    console.log('Halted')
    closed = true;
    await Sequelize.sync({ alter: true });
    await Sequelize.close();
    await client.destroy();
    process.exit();
}

const client = new Client({
    intents: [
        'Guilds',
        'GuildBans',
        'GuildMembers',
        'GuildMessages',
        'GuildWebhooks',
        'GuildIntegrations',
        'MessageContent',
    ]
});

process.on('SIGUSR1', async () => {
	halt();
});

process.on('SIGUSR2', async () => {
	halt();
});

process.on('SIGINT', async () => {
	halt();
});

process.on('exit', async () => {
	halt();
});

process.on('uncaughtException', (e) => {
    console.log('Uncaught Error');
	console.error(e);
	// console.trace();
});

client.botcolor = 0xBE0000;

client.login(process.env.BOT_TOKEN).then(success => {
    console.clear();
    console.log('>>> Sherbot logged in.');
    Features.run(client);
});