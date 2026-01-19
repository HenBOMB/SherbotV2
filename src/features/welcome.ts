import fs from 'fs';
import { Client, EmbedBuilder, GuildMember, TextChannel } from 'discord.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import path from 'path';

export default function (client: Client) {
    const assetPath = path.resolve('src/assets/welcome.no');
    // Ensure asset exists or handle error
    let WELCOMES: string[] = [];
    try {
        WELCOMES = fs.readFileSync(assetPath, 'utf8').split('\n');
    } catch (e) {
        logger.error('Failed to load welcome messages:', e);
        WELCOMES = ['Welcome %user% to the server!'];
    }

    client.on('guildMemberAdd', async (member: GuildMember) => {
        if (member.user.bot) return;
        if (member.guild.id !== config.guilds.main) return;

        try {
            await member.roles.add(config.roles.defaultMember);

            const welcomeChannel = await client.channels.fetch(config.channels.welcome) as TextChannel;
            if (welcomeChannel) {
                await welcomeChannel.send({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(client.botcolor)
                            .setTitle(WELCOMES[Math.floor(Math.random() * WELCOMES.length)].replace(/%user%/g, member.user.globalName || member.user.username))
                            .setDescription(`Welcome ${member} to ${member.guild.name.replace('|', '—')} 🎉`)
                            .setThumbnail(member.user.displayAvatarURL())
                            .setTimestamp()
                            .setFooter({
                                text: `${member.user.globalName || member.user.username}`,
                                iconURL: member.guild.iconURL() || undefined
                            })
                    ]
                });
            } else {
                logger.warn(`Welcome channel ${config.channels.welcome} not found.`);
            }

            await member.user.send({
                embeds: [
                    new EmbedBuilder()
                        .setColor(client.botcolor)
                        .setTitle(`Verification Required`)
                        .setThumbnail('https://cdn-icons-png.flaticon.com/512/1779/1779281.png')
                        .setDescription(`
        🗝️ Head over to <#${config.channels.verification}> to verify yourself.
        
        **You must answer the following questions:**
        
        > 1. Have you read the rules?
        > 2. Why are you interested in deduction? 
        > 3. How long have you been practicing deduction? 
        > 4. What is your favorite field of study?
        > 5. What is your purpose of joining this server?
        
        [Click here for more info](https://discord.com/channels/${config.guilds.main}/${config.channels.verification}/906150446966648882)
        ㅤ
        `)
                        .setFooter({ text: member.guild.name })
                        .setTimestamp()
                ]
            }).catch(err => {
                logger.warn(`Could not send DM to ${member.user.tag}:`, err);
            });
        } catch (error) {
            logger.error(`Error in welcome handler for ${member.user.tag}:`, error);
        }
    })
}
