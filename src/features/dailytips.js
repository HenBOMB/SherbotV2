import fs from 'fs';
import { EmbedBuilder } from 'discord.js';
import { Server } from '../models.js';

const TIPS = fs.readFileSync('src/assets/tips.no', 'utf8').split('\n');

/**
 * @param {import('discord.js').Client} client
 */
export default function(client) {

    const sendTip = async (sub_tips) => {
        for(const model of await Server.findAll()) {
            const { id, tip, tip_channel } = model.dataValues;

            if(!tip || !tip_channel) continue;

            const guild = client.guilds.cache.get(id) || await client.guilds.fetch(id);
            const channel = guild.channels.cache.get(tip_channel) || await guild.channels.fetch(tip_channel);

            let tip_url = TIPS[(tip + 1) > TIPS.length? 0 : tip];
            let tips_ = tip_url.split(',');

            if(tips_.length > 1) {
                sub_tips[id] = (typeof sub_tips[id] === 'number'? sub_tips[id] : -1) + 1;

                if(sub_tips[id] >= tips_.length) {
                    // ! No more tips..
                    if((tip + 1) > TIPS.length) {
                        tip_url = TIPS[0];
                        model.set('tip', 0);
                    } 
                    else {
                        tip_url = TIPS[tip+1];
                        tips_ = tip_url.split(',');
                        if(tips_.length > 1) {
                            sub_tips[id] = 0;
                            tip_url = tips_[0];
                        }
                        model.set('tip', tip+1);
                    }
                    await model.save();
                }
                else {
                    tip_url = tips_[sub_tips[id]];
                }
            }
            else {
                if(sub_tips[id]) delete sub_tips[id];
                model.set('tip', tip + 1);
                await model.save();
            }

            await channel.send({ embeds: [ 
                new EmbedBuilder()
                    .setColor(0xabefb3)
                    .setImage(tip_url) 
                ] 
            }).then(async message => {
                await message.react('👍');
                await message.react('👎');
            })
            
            const role = guild.roles.cache.find(x => x.name.toLowerCase().includes('daily tips'));
            if(role) await deduction.send(`<@&${role.id}>`).then(msg => setTimeout(() => msg.delete(), 3000));
        }

        return sub_tips;
    };
    
    const currentUTC = new Date();
    const timeUntil10UTC = 
        (24 - currentUTC.getUTCHours() + 12) % 24 * 3600000 // 1000 GMT+3 = 1300 UTC
        - currentUTC.getUTCMinutes() * 60000
        - currentUTC.getUTCSeconds() * 1000
        - currentUTC.getUTCMilliseconds();

    var sub_tips = {};
    setTimeout(() => {
        sendTip(sub_tips).then(x => sub_tips = x).catch(console.log);
        setInterval(() => sendTip(sub_tips).then(x => sub_tips = x).catch(console.log), 86400000);
    }, timeUntil10UTC);
}