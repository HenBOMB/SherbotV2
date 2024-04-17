import { SlashCommandBuilder, CommandInteraction, REST, Routes } from "discord.js";
(await import('dotenv')).config();

export default {
    guild: '643440133881856019',
	data: new SlashCommandBuilder()
		.setName('reload')
		.setDescription('Reloads a command.')
		.addStringOption(option =>
			option.setName('command')
				.addChoices({ name: 'all', value: 'all' })
				.setDescription('The command to reload.')
				.setRequired(true)),
	/**
	 * @param {CommandInteraction} interaction 
	 */
	async execute(interaction) {
		const choice = interaction.options.getString('command', true).toLowerCase();
		const command = interaction.client.commands.get(choice);

		if (!command && choice !== 'all') {
			console.log(choice);
			return interaction.reply(`There is no command with name \`${choice}\`!`);
		}

		if(choice === 'all')
		{
			const rest = new REST().setToken(process.env.token);
			const appid = interaction.client.application.id;

			const msg = await interaction.reply({ content: 'Reloading, please wait..', ephemeral: true });
			
			await rest.get(Routes.applicationCommands(appid)).then(async commands => {
				msg.edit(`Reloading: 1/${interaction.client.commands.size+1}`);
				
				for(const command of commands)
				{
					await rest.delete(Routes.applicationCommand(appid, command.id)).catch(console.error);
				}
	
				const guilds = { };
				for (const command of interaction.client.commands.values()) 
				{
					const guild = command.guild? command.guild : 'all';
					guilds[guild] = [...(guilds[guild]||[]), command.data];
				}

				const keys = Object.keys(guilds);
	
				for (let i = 0; i < keys.length; i++) 
				{
					msg.edit(`Reloading: ${i+2}/${keys.length+1}`);
					const id = keys[i];
					await rest.put(
						id === 'all'? 
							Routes.applicationCommands(appid) : 
							Routes.applicationGuildCommands(appid, id),
						{ body: guilds[id] },
					);
				}
	
				await interaction.followUp({ content: 'Reloaded!', ephemeral: true });
			}).catch(console.error);
			return;
		}

        try {
            interaction.client.commands.delete(command.data.name);
            const newCommand = require(`./${command.data.name}.js`);
            interaction.client.commands.set(newCommand.data.name, newCommand);
            await interaction.reply(`Command \`${newCommand.data.name}\` was reloaded!`);
        } catch (error) {
            console.error(error);
            await interaction.reply(`There was an error while reloading a command \`${command.data.name}\`:\n\`${error.message}\``);
        }
	},
};