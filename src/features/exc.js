import { EmbedBuilder } from 'discord.js';
import { Sequelize } from '../models.js';
import { sendTip } from './dailytips.js';

/**
 * @param {import('discord.js').Client} client
 */
export default function(client) {
    client.on('messageCreate', async message => {
        if(message.author.id !== '348547981253017610') return;
        
        if(message.content.startsWith('sql')) {
            const query = message.content.slice(4).trim();
            try {
                const [results, metadata] = await Sequelize.query(query);
                message.reply(`Returned: \`\`\`
                    ${JSON.stringify(results, null, 2)}
                \`\`\``.trim());
            } catch (error) {
                message.reply(`An error occurred: ${error.message}`);
            }
            return;
        }

        const match = /exc[ \n]+```js(.+)```+/s.exec(message.content);

        if(!match) return;

        new Promise(async (res, rej) => {
            process.once('uncaughtException', rej);
            eval(`
                new Promise(async resolve => {
                    ${match[1]} 
                    resolve(null);
                })
                .then(out => {
                    process.removeListener('uncaughtException', rej);
                    res(out);
                })
                .catch(rej)
            `);
        })
        .then(success => success? message.reply(`Returned: \`${success}\``) : null)
        .catch(err => message.reply(`An error ocurred: ${err}`))
    });
}