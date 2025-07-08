import fs from 'fs';
import { EmbedBuilder } from 'discord.js';
import { Server } from '../models.js';

const TIPS = fs.readFileSync('src/assets/tips.no', 'utf8').split('\n');

async function sendAllTips(client) {
    const servers = await Server.findAll()
    for(const model of servers) {
        let { id: serverId, tip: tipId, tip_channel: channelId } = model.dataValues;
    
        if(tipId === null || !channelId) continue;
        
        sendTip(client, tipId, channelId, serverId);
        
        tipId++;
        
        model.set('tip', tipId >= TIPS.length? 0 : tipId);
        await model.save();
    }
}

export async function sendTip(client, tipId, channelId, serverId) {
    const guild = client.guilds?.cache?.get(serverId) || await client.guilds.fetch(serverId);
    const channel = guild.channels?.cache?.get(channelId) || await guild.channels.fetch(channelId);
    await channel.send({ embeds: [ 
        new EmbedBuilder()
            .setColor(0xabefb3)
            .setImage(TIPS[tipId]) 
        ] 
    }).then(async message => {
        await message.react('👍');
        await message.react('👎');
    });
}

/**
 * @param {import('discord.js').Client} client
 */
export default function(client) {
    const currentUTC = new Date();
    const timeUntil10UTC = 
        (24 - currentUTC.getUTCHours() + 12) % 24 * 3600000 // 1000 GMT+3 = 1300 UTC
        - currentUTC.getUTCMinutes() * 60000
        - currentUTC.getUTCSeconds() * 1000
        - currentUTC.getUTCMilliseconds();

    setTimeout(() => {
        sendAllTips(client).catch(console.log);
        setInterval(() => sendAllTips(client).catch(console.log), 86400000);
    }, timeUntil10UTC);
}