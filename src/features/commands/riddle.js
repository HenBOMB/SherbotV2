import fs from "fs";
import { 
	SlashCommandBuilder, 
	CommandInteraction, 
	ActionRowBuilder, 
	ButtonBuilder, 
	ButtonStyle, 
	EmbedBuilder, 
	StringSelectMenuBuilder, 
	StringSelectMenuOptionBuilder, 
	Message
} from 'discord.js';

const RIDDLES_01 = fs.readFileSync('src/assets/games/mindyourlogic.no', 'utf8').split('+').slice(1);

export default {
	data: new SlashCommandBuilder()
		.setName('riddle')
        .setDescription('Get a random detective riddle!'),

	/**
	 * @param {CommandInteraction} interaction 
	 */
	async execute(interaction) {
		const id = Math.floor(Math.random() * RIDDLES_01.length);
		const [title, desc, , opts] = RIDDLES_01[id].split('\n');
		
		const row = new ActionRowBuilder().addComponents(opts ?  
			new StringSelectMenuBuilder()
				.setCustomId(`${this.data.name}-opt-${id}`)
				.setPlaceholder('Who did it?')
				.addOptions(
					...opts.split('|').sort(() => Math.random() - 0.5).map(o => new StringSelectMenuOptionBuilder()
						.setLabel(o)
						// .setDescription(`Was it ${o}?`)
						.setValue(o.toLowerCase())
					)
				) 
			:
			new ButtonBuilder()
				.setStyle(ButtonStyle.Danger)
				.setLabel('Reveal Answer')
				.setCustomId(`${this.data.name}-rev-${id}`));
		
		const embed = new EmbedBuilder()
		    .setTitle(title)
		    .setDescription(desc.replace(/\/\/+/g, '\nㅤ\n').replace(/\/+/g, '\n'))
		    .setColor(interaction.client.botcolor)
		    .setThumbnail('https://cdn-icons-png.flaticon.com/128/3874/3874218.png')
		    .setTimestamp()
        	.setFooter({
				text: 'Riddle #' + id
			});

		await interaction.reply({ embeds: [ embed ], components: [ row ] });
	},

	/**
	 * @param {import("discord.js").Interaction<import("discord.js").CacheType>} interaction 
	 */
	async click(interaction) {
		const [ , type, id ] = interaction.customId.split('-');
		const [, , ans ] = RIDDLES_01[id].split('\n');

		if(type === 'rev')
		{
			await interaction.reply({ content: `Answer: ${ans}`, ephemeral: true })
		}
	},

	/**
	 * @param {import("discord.js").Interaction<import("discord.js").CacheType>} interaction 
	 */
	async select(interaction) {
		const [ , , id ] = interaction.customId.split('-');
		const [, , ans, opts] = RIDDLES_01[id].split('\n');

		const options = opts.split('|');

		if(interaction.values[0] === options[options.length-1].toLowerCase())
		{
			await interaction.reply({ content: `Correct! ${ans}`, ephemeral: true })
		}
		else
		{
			const row = new ActionRowBuilder()
				.addComponents(
					new ButtonBuilder()
						.setStyle(ButtonStyle.Danger)
						.setLabel('Reveal Answer')
						.setCustomId(`${this.data.name}-rev-${id}`)
				);

			await interaction.reply({ content: `Incorrect`, components: [ row ], ephemeral: true })
		}
	}
};