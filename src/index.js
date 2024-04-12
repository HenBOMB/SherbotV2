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
}

const client = new Client({
    intents: [
        'GuildMembers',
        'GuildMessages',
        'MessageContent',
        'Guilds',
    ]
});

process.on('SIGUSR1', async () => {
	halt();
    console.log('SIGUSR1');
});

process.on('SIGUSR2', async () => {
	halt();
    console.log('SIGUSR2');
});

process.on('SIGINT', async () => {
	halt();
    console.log('SIGINT');
});

process.on('exit', async () => {
	halt();
    console.log('exit');
});

process.on('uncaughtException', (e) => {
	console.error(e);
	console.trace();
});

client.login(process.env.token).then(success => {
    console.clear();
    console.log('>>> Sherbot logged in.');
    Features.run(client);
});