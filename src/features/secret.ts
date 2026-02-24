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
            // Logging logic was commented out in original. Keeping it commented or removed.
            // If strictly following migration, we can leave it out or keep as debug log.
            // logger.debug(`[${message.guild?.name}] [${(message.channel as TextChannel)?.name}] ${message.author.displayName}: ${message.content}`);

            const botId = client.user?.id;
            if (message.content.trim() === `<@${botId}>` || message.content.trim() === `<@!${botId}>` || message.content.trim() === '<@712429527321542777>') { // Bot Mention?
                const quirkyReplies = [
                    "Here I am!",
                    "You rang?",
                    "At your service!",
                    "Did someone say my name?",
                    "Present!",
                    "Reporting for duty!",
                    "Who summons the mighty Sherbot?",
                    "I'm awake! I'm awake!",
                    "Need something?",
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

        const channel = message.channel;

        if (!message.content.startsWith('$sb')) return;

        const command = message.content.replace('$sb', '').trim().split(' ')[0];

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

                    await message.reply(`✅ Server \`${guildName}\` is now designated as premium!`);
                } catch (err) {
                    logger.error('Failed to set premium status:', err);
                    await message.reply('❌ Failed to set premium status.');
                }
            } else {
                await message.reply('Usage: `$sb premium <serverid>`');
            }
            return;
        }

        if (command === 'reload') {
            const args = message.content.split(' ');
            if (args.length < 3) {
                await message.reply('Usage: `$sb reload <command|all>`');
                return;
            }

            const choice = args[2].toLowerCase();
            const command = client.commands.get(choice);

            if (!command && choice !== 'all') {
                await message.reply(`There is no command with name \`${choice}\`!`);
                return;
            }

            if (choice === 'all') {
                const { REST, Routes } = await import('discord.js');
                const rest = new REST().setToken(config.bot.token);
                // Handle application undefined
                const appid = client.application ? client.application.id : undefined;

                if (!appid) {
                    await message.reply('Client application not ready.');
                    return;
                }

                const msg = await message.reply('Reloading all commands globally and locally, please wait..');

                try {
                    const commands = await rest.get(Routes.applicationCommands(appid)) as any[];
                    await msg.edit(`Reloading: 1/${client.commands.size + 1}`);

                    for (const cmd of commands) {
                        await rest.delete(Routes.applicationCommand(appid, cmd.id)).catch(console.error);
                    }

                    const guilds: { [key: string]: any[] } = {};
                    const globalCommands: any[] = [];

                    for (const cmd of client.commands.values()) {
                        if (cmd.guild) {
                            guilds[cmd.guild] = [...(guilds[cmd.guild] || []), cmd.data];
                        } else {
                            globalCommands.push(cmd.data);
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
                } catch (error) {
                    logger.error(error);
                    await msg.edit('❌ Failed to reload all commands.');
                }
                return;
            }

            try {
                if (!command) return;
                client.commands.delete(command.data.name as string);
                const newCommandModule = await import(`../commands/${command.data.name}.js?update=${Date.now()}`);
                const newCommand = newCommandModule.default;
                client.commands.set(newCommand.data.name, newCommand);
                await message.reply(`✅ Command \`${newCommand.data.name}\` was reloaded!`);
            } catch (error: any) {
                logger.error(error);
                await message.reply(`❌ Error reloading \`${command?.data?.name || choice}\`:\n\`${error.message}\``);
            }
            return;
        }

        if (command === 'sudo') {
            // ? $sb sudo <#id> <content>
            const idMatch = /<#(\d+)>/g.exec(message.content.slice(9));
            const id = idMatch?.at(1) || message.channelId;
            const content = message.content.slice(9).replace(new RegExp(`<#${id}>`), '').trim();

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
