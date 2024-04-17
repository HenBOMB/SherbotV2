(await import('dotenv')).config();

import { Client } from 'discord.js';
import { Sequelize, Server } from './models.js';
import Features from './features.js';

await Sequelize.sync({ alter: true });

await Server.findOrCreate({
    where: {
        id: '670107546480017409',
    },
    defaults: {
        id: '670107546480017409',
        tip: 42,
    }
});

var closed = false;

async function halt() {
    if(closed) return;
    closed = true;
    await Sequelize.sync({ alter: true });
    await Sequelize.close();
    await client.destroy();
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

client.login(process.env.token).then(success => {
    console.clear();
    console.log('>>> Sherbot logged in.');
    Features.run(client);
});