import { Client, Message, PermissionsBitField, TextChannel, User } from 'discord.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export default function (client: Client) {
    if (!config.features.autoModEnabled) return;

    client.on('messageCreate', async (message: Message) => {
        const content = message.content;

        if (!message.member || message.member.user.bot) return;

        // ? No filtering if you can kick.
        // Using string "KickMembers" as PermissionResolvable
        if (message.member.roles.cache.some(role => role.permissions.has(PermissionsBitField.Flags.KickMembers))) return;

        if (content.includes('https://discord.gg')) {
            try {
                const kicked = await message.member.kick().catch(() => null);

                await message.delete().catch(() => { });

                if (kicked) {
                    const modLogChannel = await client.channels.fetch(config.channels.modLog) as TextChannel;
                    if (modLogChannel) {
                        // Assuming the hardcoded user ID was usage of an owner/admin mention, we replaced that logic or keep it if it's specific.
                        // Original: <@348547981253017610>
                        // We'll use the first owner from config if available or just omit.
                        const ping = config.users.owners[0] ? `<@${config.users.owners[0]}>` : '';
                        await modLogChannel.send(`Kicked ${kicked.user.displayName}, sent a discord invite link. ${ping}`);
                    }
                }
                else {
                    logger.warn(`Failed to kick member ${message.member.user.tag} for send invite link.`);
                }
            } catch (error) {
                logger.error('Error in invite link handler:', error);
            }
        }

        // ? 🔑┃verification
        if (message.channelId === config.channels.verification) {
            if (
                (content.match(/(\d[-) .]+.+)/mg) ||
                    content.includes('Have you read the rules?') ||
                    content.includes('Why are you interested in deduction?') ||
                    content.includes('What is your favorite field of study?')) &&
                content.toLowerCase().includes('deduct')
            ) {
                setTimeout(async () => {
                    try {
                        // Check if message still exists
                        if (message.partial) await message.fetch();
                        await message.react(['✅', '👍'][Math.floor(Math.random() * 2)]);
                        if (message.member) {
                            await message.member.roles.add(config.roles.verified);
                        }
                    } catch (e) {
                        logger.error('Error in verification auto-role:', e);
                    }
                }, 9000);
            }
        }
        // ? 🙋┃introductions
        else if (message.channelId === config.channels.introductions) {
            // Note: introductions ID was hardcoded in original mod.js differently than verification
            // mod.js: 670108903224377354
            // I added this to config.ts
            if (
                content.match(/Name:/) ||
                content.match(/Contact:/)
            ) {
                await message.react('👋'); // Original had a special char '', assuming wave or similar utf8 issue. Replacing with wave.
            }
        }
    })
}
