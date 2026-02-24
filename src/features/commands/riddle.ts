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
    ButtonInteraction,
    StringSelectMenuInteraction
} from 'discord.js';
import path from 'path';
import { Command } from "../../types.js";

// Fix path resolution for assets
const RIDDLES_01 = fs.readFileSync('src/assets/games/mindyourlogic.no', 'utf8').split('+').slice(1);

export default {
    data: new SlashCommandBuilder()
        .setName('riddle')
        .setDescription('Get a random detective riddle!'),

    async execute(interaction: CommandInteraction) {
        const id = Math.floor(Math.random() * RIDDLES_01.length);
        const parts = RIDDLES_01[id].split('\n');
        const title = parts[0];
        const desc = parts[1];
        const opts = parts[3];

        const row = new ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>().addComponents(opts ?
            new StringSelectMenuBuilder()
                .setCustomId(`riddle-opt-${id}`) // Used explicit name since 'this' context might be lost
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
                .setCustomId(`riddle-rev-${id}`));

        const embed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(desc.replace(/\/\/+/g, '\nㅤ\n').replace(/\/+/g, '\n'))
            .setColor(interaction.client.botcolor)
            .setThumbnail('https://cdn-icons-png.flaticon.com/128/3874/3874218.png')
            .setTimestamp()
            .setFooter({
                text: 'Riddle #' + id
            });

        // Cast to any because types are a bit strict with ActionRows mixing components in builder phase vs final
        await interaction.reply({ embeds: [embed], components: [row as any] });
    },

    async click(interaction: ButtonInteraction) {
        const [, type, idStr] = interaction.customId.split('-');
        const id = parseInt(idStr);
        const parts = RIDDLES_01[id].split('\n');
        const ans = parts[2];

        if (type === 'rev') {
            await interaction.reply({ content: `Answer: ${ans}`, ephemeral: true })
        }
    },

    async select(interaction: StringSelectMenuInteraction) {
        const [, , idStr] = interaction.customId.split('-');
        const id = parseInt(idStr);
        const parts = RIDDLES_01[id].split('\n');
        const ans = parts[2];
        const opts = parts[3];

        const options = opts.split('|');

        if (interaction.values[0] === options[options.length - 1].toLowerCase()) {
            await interaction.reply({ content: `Correct! ${ans}`, ephemeral: true })
        }
        else {
            const row = new ActionRowBuilder<ButtonBuilder>()
                .addComponents(
                    new ButtonBuilder()
                        .setStyle(ButtonStyle.Danger)
                        .setLabel('Reveal Answer')
                        .setCustomId(`riddle-rev-${id}`)
                );

            await interaction.reply({ content: `Incorrect`, components: [row], ephemeral: true })
        }
    }
} as Command;
