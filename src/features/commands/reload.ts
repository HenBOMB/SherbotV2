import { SlashCommandBuilder, CommandInteraction, REST, Routes, ChatInputCommandInteraction } from "discord.js";
import { config } from "../../config.js";

// We need to import the type, but since we are using dynamic imports for commands, 
// we can't easily import the Command type here without circular dependency issues 
// if we're not careful. But types are erased, so it is fine.
import { Command } from "../../types.js";

export default {
    guild: config.guilds.dev,
    data: new SlashCommandBuilder()
        .setName('reload')
        .setDescription('Reloads a command.')
        .addStringOption(option =>
            option.setName('command')
                .addChoices({ name: 'all', value: 'all' })
                .setDescription('The command to reload.')
                .setRequired(true)),

    async execute(interaction: ChatInputCommandInteraction) {
        const choice = interaction.options.getString('command', true).toLowerCase();
        const command = interaction.client.commands.get(choice);

        if (!command && choice !== 'all') {
            return interaction.reply(`There is no command with name \`${choice}\`!`);
        }

        if (choice === 'all') {
            const rest = new REST().setToken(config.bot.token);
            const appid = interaction.client.application!.id;

            const msg = await interaction.reply({ content: 'Reloading, please wait..', ephemeral: true });

            await rest.get(Routes.applicationCommands(appid)).then(async (commands: any) => {
                msg.edit(`Reloading: 1/${interaction.client.commands.size + 1}`);

                for (const command of commands) {
                    await rest.delete(Routes.applicationCommand(appid, command.id)).catch(console.error);
                }

                const guilds: { [key: string]: any[] } = {};
                for (const command of interaction.client.commands.values()) {
                    const guild = command.guild ? command.guild : 'all';
                    guilds[guild] = [...(guilds[guild] || []), command.data];
                }

                const keys = Object.keys(guilds);

                for (let i = 0; i < keys.length; i++) {
                    await msg.edit(`Reloading: ${i + 2}/${keys.length + 1}`);
                    const id = keys[i];
                    await rest.put(
                        id === 'all' ?
                            Routes.applicationCommands(appid) :
                            Routes.applicationGuildCommands(appid, id),
                        { body: guilds[id] },
                    );
                }

                await interaction.followUp({ content: 'Reloaded!', ephemeral: true });
            }).catch(console.error);
            return;
        }

        if (!command) return; // Should allow 'all' or existing command

        try {
            interaction.client.commands.delete(command.data.name as string);
            // In TS/ESM, we can't delete from cache easily like require.cache
            // But we can re-import with a cache buster query param
            const newCommandModule = await import(`./${command.data.name}.js?update=${Date.now()}`);
            const newCommand = newCommandModule.default;
            interaction.client.commands.set(newCommand.data.name, newCommand);
            await interaction.reply(`Command \`${newCommand.data.name}\` was reloaded!`);
        } catch (error: any) {
            console.error(error);
            await interaction.reply(`There was an error while reloading a command \`${command.data.name}\`:\n\`${error.message}\``);
        }
    },
} as Command;
