import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Collection, REST, Routes, Events, Client, Interaction, ButtonInteraction, StringSelectMenuInteraction } from 'discord.js';
import { config } from '../../config.js';
import { logger } from '../../utils/logger.js';
import { Command } from '../../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default async function (client: Client) {
    client.commands = new Collection();
    const guilds: { [key: string]: any[] } = {};

    // __dirname is now the commands directory itself
    const commandsDir = __dirname;

    // Look for .js or .ts files, excluding index, declarations and maps
    const commandFiles = fs.readdirSync(commandsDir)
        .filter(file => (file.startsWith('index.') ? false : (file.endsWith('.js') || file.endsWith('.ts'))) && !file.endsWith('.d.ts') && !file.endsWith('.map'));

    for (const file of commandFiles) {
        try {
            // Strip extension and force .js for the dynamic import
            const name = file.slice(0, file.lastIndexOf('.'));
            const module = await import(`./${name}.js`);
            const command: Command = module.default;

            if (!command) {
                logger.warn(`Command ${file} has no export.`);
                continue;
            }

            // Optional: Check if guild exists before registering
            if (command.guild) {
                // validation logic or logging
            }

            if (command.data) {
                // @ts-ignore - command.data can be various builder types
                client.commands.set(command.data.name, command);
                const guildId = command.guild || 'global';

                if (command.guild) {
                    guilds[command.guild] = [...(guilds[command.guild] || []), command.data];
                } else {
                    // Global commands logic if needed
                }

                // Initialize command if it has an init method
                if (command.init) {
                    await command.init(client).catch(err => logger.error(`   ✗ /${name} init error`, err));
                }
            }
            logger.info(`   ✓ /${name} (${command.guild || 'any'})`);
        } catch (error) {
            logger.error(`   ✗ /${file.slice(0, file.lastIndexOf('.'))}`, error);
        }
    }

    const rest = new REST().setToken(config.bot.token);

    try {
        for (const key of Object.keys(guilds)) {
            await rest.put(
                Routes.applicationGuildCommands(client.application!.id, key),
                { body: guilds[key] },
            );
        }
        logger.info(`   Sync ${client.commands.size} commands.`);
    } catch (error) {
        logger.error(`   Failed to put ${client.commands.size} commands.`, error);
    }

    client.on(Events.InteractionCreate, async (interaction: Interaction) => {
        try {
            if (interaction.isStringSelectMenu() || interaction.isButton()) {
                const command = client.commands.get(interaction.customId.split('-')[0]);

                if (!command) {
                    // Silent fail or log debug
                    logger.debug(`Interaction ${interaction.customId} not tied to any command.`);
                    return;
                }

                if (interaction.isButton()) {
                    await command.click!(interaction as ButtonInteraction);
                } else {
                    await command.select!(interaction as StringSelectMenuInteraction);
                }
            }
            else if (interaction.isChatInputCommand()) {
                const command = client.commands.get(interaction.commandName);

                if (!command) {
                    logger.warn(`No command matching ${interaction.commandName} was found.`);
                    return;
                }

                await command.execute(interaction);
            }
            else if (interaction.isAutocomplete()) {
                const command = client.commands.get(interaction.commandName);

                if (command && command.autocomplete) {
                    await command.autocomplete(interaction);
                }
            }
        }
        catch (error) {
            logger.error('Interaction error:', error);

            if (interaction.isRepliable() && (interaction.replied || interaction.deferred)) {
                await interaction.followUp({ content: 'Sorry, an error occurred. Please try again!', ephemeral: true }).catch(() => { });
            }
            else if (interaction.isRepliable()) {
                await interaction.reply({ content: 'Sorry, an error occurred. Please try again!', ephemeral: true }).catch(() => { });
            }
        }
    });
}
