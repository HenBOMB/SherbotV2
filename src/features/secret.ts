import { Client, Message, TextChannel } from 'discord.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export default function (client: Client) {
    let prev = '';

    client.on('messageCreate', async (message: Message) => {
        if (message.content) {
            // Logging logic was commented out in original. Keeping it commented or removed.
            // If strictly following migration, we can leave it out or keep as debug log.
            // logger.debug(`[${message.guild?.name}] [${(message.channel as TextChannel)?.name}] ${message.author.displayName}: ${message.content}`);

            if (message.content == '<@712429527321542777>') { // Bot Mention?
                message.reply('Hello!').catch(() => { });
            }
        }
        else {
            return;
        }

        prev = message.guildId || '';

        if (!message.member || message.author.bot) return;

        // Check if author is an owner
        if (!config.users.owners.includes(message.author.id)) return;

        const channel = message.channel;

        if (message.content.startsWith('sudo')) {
            // ? sudo <#id> <content>
            const idMatch = /<#(\d+)>/g.exec(message.content.slice(5));
            const id = idMatch?.at(1) || message.channelId;
            const content = message.content.slice(5).replace(new RegExp(`<#${id}>`), '').trim();

            if (!message.guild) return;

            const target = message.guild.channels.cache.get(id) as TextChannel;

            if (!target) {
                await message.delete().catch(() => { }).then(() => {
                    (message.channel as TextChannel).send({ content: 'That channel does not exist.', ephemeral: true } as any).catch(() => { });
                });
                return;
            }

            if (!content || content.length < 5) {
                // Handling short content
                await message.delete().catch(() => { }).then(() => {
                    (message.channel as TextChannel).send({ content: 'Content too short or missing.', ephemeral: true } as any).catch(() => { });
                });
                return;
            }

            target.send(content).then(msg => {
                if (target.id === channel.id) {
                    message.delete().catch(() => { });
                }
                else {
                    message.reply({ content: `Sudo'd at: ${msg.url}` }).catch(() => { });
                }
            }).catch(err => {
                logger.error('Failed to sudo send:', err);
                message.reply('Failed to send message.');
            });
        }
    })
}
