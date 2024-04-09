import { Client } from 'discord.js';
import { Sequelize, Server } from './models.js';
import Features from './features.js';

await Sequelize.sync({ alter: true });

await Server.findOrCreate({
    where: {
        id: '670107546480017409'
    },
    defaults: {
        id: '670107546480017409'
    }
});

const client = new Client({
    intents: [
        'GuildMembers',
        'GuildMessages',
        'MessageContent',
        'Guilds',
    ]
});

process.on('SIGUSR1', () => {
	Sequelize.sync({ alter: true });
    Sequelize.close();
});

process.on('SIGUSR2', () => {
	Sequelize.sync({ alter: true });
    Sequelize.close();
});

process.on('SIGINT', () => {
	Sequelize.sync({ alter: true });
    Sequelize.close();
});

process.on('exit', () => {
	Sequelize.sync({ alter: true });
    Sequelize.close();
});

process.on('uncaughtException', (e) => {
	Sequelize.sync({ alter: true });
    Sequelize.close();
	console.error(e);
	console.trace();
});

client.login(process.env.token).then(success => {
    console.clear();
    console.log('>>> Sherbot logged in.');
    Features.run(client);
});