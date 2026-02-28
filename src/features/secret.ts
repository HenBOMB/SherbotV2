import { Client, Message, TextChannel } from 'discord.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export default function (client: Client) {
    let prev = '';

    client.on('messageCreate', async (message: Message) => {
        if (message.author.bot) {
            return;
        }
        if (message.content) {
            const botId = client.user?.id;
            if (message.content.trim() === `<@${botId}>` || message.content.trim() === `<@!${botId}>` || message.content.trim() === '<@712429527321542777>') { // Bot Mention?
                const quirkyReplies = [
                    "Here I am!",
                    "You rang?",
                    "At your service!",
                    "Did someone say my name?",
                    "Present!",
                    "Reporting for duty!",
                    "Who summoned me?",
                    "I'm awake! I'm awake!",
                    "Need something?",
                    "Rolling out!",
                    "Sarge here",
                ];
                const randomReply = quirkyReplies[Math.floor(Math.random() * quirkyReplies.length)];
                message.reply(randomReply).catch(() => { });
            }
        }
        else {
            return;
        }

        prev = message.guildId || '';

        if (!message.member) return;

        // Check if author is an owner
        if (!config.users.owners.includes(message.author.id)) return;

        if (!message.content.startsWith('$sb')) return;

        const command = message.content.replace('$sb', '').trim().split(' ')[0];

        // --- COMMAND: PREMIUM ---
        if (command === 'premium') {
            const args = message.content.split(' ');
            if (args.length >= 3) {
                const guildId = args[2];
                try {
                    const { Server } = await import('../database.js');
                    const [server] = await Server.findOrCreate({
                        where: { id: guildId },
                        defaults: {
                            id: guildId,
                            tip: 0,
                            tip_channel: null
                        }
                    });

                    server.isPremium = true;
                    await server.save();

                    const guildName = (await client.guilds.fetch(guildId))?.name;
                    logger.info(`Premium status set for guild: ${guildName}`);
                } catch (err) {
                    logger.error('Failed to set premium status:', err);
                }
                message.delete().catch(() => { });
            } else {
                message.delete().catch(() => { });
            }
            return;
        }

        // --- COMMAND: RELOAD ---
        if (command === 'reload') {
            const args = message.content.split(' ');
            if (args.length < 3) {
                const msg = await (message.channel as TextChannel).send('Usage: `$sb reload <command|all>`');
                setTimeout(() => {
                    msg.delete().catch(() => { });
                    message.delete().catch(() => { });
                }, 2000);
                return;
            }

            const choice = args[2].toLowerCase();
            const cmd = client.commands.get(choice);

            if (!cmd && choice !== 'all') {
                message.delete().catch(() => { });
                return;
            }

            if (choice === 'all') {
                const { REST, Routes } = await import('discord.js');
                const rest = new REST().setToken(config.bot.token);
                const appid = client.application ? client.application.id : undefined;

                if (!appid) {
                    const msg = await (message.channel as TextChannel).send('Client application not ready.');
                    setTimeout(() => {
                        msg.delete().catch(() => { });
                        message.delete().catch(() => { });
                    }, 2000);
                    return;
                }

                const msg = await (message.channel as TextChannel).send('Reloading all commands globally and locally, please wait..');

                try {
                    const commands = await rest.get(Routes.applicationCommands(appid)) as any[];
                    await msg.edit(`Reloading: 1/${client.commands.size + 1}`);

                    for (const dc of commands) {
                        await rest.delete(Routes.applicationCommand(appid, dc.id)).catch(() => { });
                    }

                    const guilds: { [key: string]: any[] } = {};
                    const globalCommands: any[] = [];

                    for (const c of client.commands.values()) {
                        if (c.guild) {
                            guilds[c.guild] = [...(guilds[c.guild] || []), c.data];
                        } else {
                            globalCommands.push(c.data);
                        }
                    }

                    const keys = Object.keys(guilds);

                    for (let i = 0; i < keys.length; i++) {
                        await msg.edit(`Reloading guilds: ${i + 1}/${keys.length}`);
                        const id = keys[i];
                        await rest.put(
                            Routes.applicationGuildCommands(appid, id),
                            { body: guilds[id] },
                        );
                    }

                    if (globalCommands.length > 0) {
                        await msg.edit(`Reloading global commands...`);
                        await rest.put(
                            Routes.applicationCommands(appid),
                            { body: globalCommands },
                        );
                    }

                    await msg.edit('✅ All commands reloaded successfully!');
                    setTimeout(() => {
                        msg.delete().catch(() => { });
                        message.delete().catch(() => { });
                    }, 2000);
                } catch (error) {
                    logger.error(error);
                    await msg.edit('❌ Failed to reload all commands.');
                    message.delete().catch(() => { });
                }
                return;
            }

            try {
                if (!cmd) return;
                client.commands.delete(cmd.data.name as string);
                const newCommandModule = await import(`../commands/${cmd.data.name}.js?update=${Date.now()}`);
                const newCommand = newCommandModule.default;
                client.commands.set(newCommand.data.name, newCommand);
                const msg = await (message.channel as TextChannel).send(`✅ Command \`${newCommand.data.name}\` was reloaded!`);
                setTimeout(() => {
                    msg.delete().catch(() => { });
                    message.delete().catch(() => { });
                }, 2000);
            } catch (error: any) {
                logger.error(error);
                message.delete().catch(() => { });
            }
            return;
        }

        // --- COMMAND: SUDO ---
        if (command === 'sudo') {
            const idMatch = /<#(\d+)>/g.exec(message.content.slice(9));
            const id = idMatch?.at(1) || message.channelId;
            const content = message.content.slice(9).replace(new RegExp(`<#${id}>`), '').trim();

            if (!message.guild) return;

            const target = message.guild.channels.cache.get(id) as TextChannel;

            if (!target) {
                message.delete().catch(() => { });
                return;
            }

            if (!content || content.length < 5) {
                message.delete().catch(() => { });
                return;
            }

            target.send(content).then(async (sentMsg) => {
                logger.info('Sudo sent:', sentMsg);
            }).catch(err => {
                logger.error('Failed to sudo send:', err);
            });
            return;
        }

        // --- COMMAND: HISTORY ---
        if (command === 'history') {
            const args = message.content.split(' ').slice(2);
            const subCommand = args[0]?.toLowerCase();

            const { default: GameManager } = await import('./mm/game.js');
            const { EmbedBuilder, Colors } = await import('discord.js');
            const gm = GameManager.getInstance(message.guildId || '');

            if (!gm) {
                const msg = await message.reply('❌ No active game manager for this server.');
                setTimeout(() => {
                    msg.delete().catch(() => { });
                    message.delete().catch(() => { });
                }, 2000);
                return;
            }

            if (!subCommand || subCommand !== 'see') {
                const msg = await message.reply('Usage: `$sb history see [suspect name]`');
                setTimeout(() => {
                    msg.delete().catch(() => { });
                    message.delete().catch(() => { });
                }, 2000);
                return;
            }

            const targetName = args.slice(1).join(' ').toLowerCase();

            if (!targetName) {
                const msg = await message.reply('Usage: `$sb history see [suspect name]`');
                setTimeout(() => {
                    msg.delete().catch(() => { });
                    message.delete().catch(() => { });
                }, 2000);
                return;
            }

            const suspects = gm.getSuspectByFuzzyMatch(targetName);
            if (suspects.length === 0) {
                const msg = await message.reply(`❌ No suspect found matching "${targetName}".`);
                setTimeout(() => {
                    msg.delete().catch(() => { });
                    message.delete().catch(() => { });
                }, 2000);
                return;
            }

            const suspect = suspects[0];
            const history = suspect.getFullHistory();

            if (history.size === 0) {
                const msg = await message.reply(`📜 ${suspect.data.name} has no conversational history yet.`);
                setTimeout(() => {
                    msg.delete().catch(() => { });
                    message.delete().catch(() => { });
                }, 2000);
                return;
            }

            const embed = new EmbedBuilder()
                .setTitle(`📜 Interrogation History: ${suspect.data.name}`)
                .setColor(Colors.Blue)
                .setThumbnail(suspect.data.avatar || null)
                .setTimestamp();

            for (const [channelId, messages] of history.entries()) {
                const channel = message.guild?.channels.cache.get(channelId);
                const channelName = channel ? `#${channel.name}` : `Unknown Channel (${channelId})`;
                const displayMessages = [...messages].reverse().join('\n');

                embed.addFields({
                    name: `📍 ${channelName}`,
                    value: displayMessages.substring(0, 1024) || 'No messages'
                });
            }

            const targetChannel = message.channel as TextChannel;
            await targetChannel.send({ embeds: [embed] });
            return;
        }

        // --- COMMAND: WIPE ---
        if (command === 'wipe') {
            const args = message.content.split(' ').slice(2);
            const targetName = args.join(' ').toLowerCase();

            const { default: GameManager } = await import('./mm/game.js');
            const gm = GameManager.getInstance(message.guildId || '');

            if (!gm) {
                const msg = await message.reply('❌ No active game manager for this server.');
                setTimeout(() => {
                    msg.delete().catch(() => { });
                    message.delete().catch(() => { });
                }, 2000);
                return;
            }

            if (!targetName) {
                const msg = await message.reply('Usage: `$sb wipe [suspect name / all]`');
                setTimeout(() => {
                    msg.delete().catch(() => { });
                    message.delete().catch(() => { });
                }, 2000);
                return;
            }

            if (targetName === 'all') {
                try {
                    await gm.clearAllHistory();
                    const msg = await message.reply('🧹 **GLOBAL WIPE**: All suspects have been fully reset. Composure, secrets, and memories are gone.');
                    setTimeout(() => {
                        msg.delete().catch(() => { });
                        message.delete().catch(() => { });
                    }, 2000);
                } catch (err) {
                    logger.error('Failed to wipe all suspects:', err);
                    await message.reply('❌ Failed to wipe all suspects.');
                }
            } else {
                const suspects = gm.getSuspectByFuzzyMatch(targetName);
                if (suspects.length === 0) {
                    const msg = await message.reply(`❌ No suspect found matching "${targetName}".`);
                    setTimeout(() => {
                        msg.delete().catch(() => { });
                        message.delete().catch(() => { });
                    }, 2000);
                    return;
                }
                const suspect = suspects[0];
                try {
                    await gm.clearSuspectHistory(suspect.data.id);
                    const msg = await message.reply(`🧹 **SUSPECT WIPE**: ${suspect.data.name} has been fully reset to their initial state.`);
                    setTimeout(() => {
                        msg.delete().catch(() => { });
                        message.delete().catch(() => { });
                    }, 2000);
                } catch (err) {
                    logger.error(`Failed to wipe suspect ${suspect.data.id}:`, err);
                    await message.reply(`❌ Failed to wipe ${suspect.data.name}.`);
                }
            }
            return;
        }

        // --- COMMAND: CACHE ---
        if (command === 'cache') {
            const args = message.content.split(' ').slice(2);
            const subCommand = args[0]?.toLowerCase();

            if (subCommand === 'reset') {
                try {
                    const { InterrogationCache } = await import('../database.js');
                    const { default: GameManager } = await import('./mm/game.js');

                    await InterrogationCache.destroy({ where: {} });

                    const gm = GameManager.getInstance(message.guildId || '');
                    if (gm) {
                        for (const suspect of gm.getSuspectsMap().values()) {
                            suspect.fullReset();
                        }
                    }

                    const msg = await message.reply('🫙 **CACHE RESET**: The global smart cache has been purged and suspect memories cleared.');
                    setTimeout(() => {
                        msg.delete().catch(() => { });
                        message.delete().catch(() => { });
                    }, 2000);
                } catch (err) {
                    logger.error('Failed to reset cache:', err);
                    await message.reply('❌ Failed to reset cache.');
                }
                return;
            }
        }

        // Delete command message
        message.delete().catch(() => { });
    });
}
