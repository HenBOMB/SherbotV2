import fs from 'fs';
import { EmbedBuilder } from 'discord.js';
import { Server } from '../models.js';

const TIPS = fs.readFileSync('src/assets/tips.no', 'utf8').split('\n');

/**
 * @param {import('discord.js').Client} client
 */
export default function(client) {
    const sendTip = async () => {
        const guild = await client.guilds.fetch('670107546480017409');
        /**
         * @type {import('discord.js').GuildTextBasedChannel}
         */
        const channel = await guild.channels.fetch('740552730250313809');

        const server = await Server.findOne({
            where: {
                id: '670107546480017409'
            }
        });

        server.set('tip', server.dataValues.tip + 1);
        server.save();

        await channel.send('<@&740693917514727431>').then(message => {
            setTimeout(() => message.delete(), 3000);
        });
        
        await channel.send({ embeds: [ new EmbedBuilder().setColor(0xabefb3).setImage(TIPS[server.dataValues.tip]) ] })
        .then(async message => {
            await message.react('👍');
            await message.react('👎');
        });
    };
    
    const currentUTC = new Date();
    const timeUntil10UTC = 
        (24 - currentUTC.getUTCHours() + 7) % 24 * 3600000 // 1000 GMT+3 = 1300 UTC
        - currentUTC.getUTCMinutes() * 60000
        - currentUTC.getUTCSeconds() * 1000
        - currentUTC.getUTCMilliseconds();

    setTimeout(() => {
        sendTip();
        setInterval(() => sendTip(), 86400000);
    }, timeUntil10UTC);
}