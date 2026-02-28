import {
    ChatInputCommandInteraction,
    ButtonInteraction,
    EmbedBuilder,
    Colors
} from 'discord.js';
import { logger } from '../../../utils/logger.js';
import GameManager from '../game.js';
import { InterrogationLog } from '../../../database.js';
import { createHelpEmbed } from '../commands.js';

/**
 * Handle /mm join command
 */
export async function handleJoin(
    manager: GameManager,
    interaction: ChatInputCommandInteraction | ButtonInteraction
): Promise<void> {
    const activeGame = manager.getActiveGame();
    if (!activeGame?.state) {
        await interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(Colors.Grey)
                    .setTitle('No Active Game')
                    .setDescription('No game is currently running.')
            ],
            ephemeral: true,
        });
        return;
    }

    const userId = interaction.user.id;
    if (activeGame.state.participants.has(userId)) {
        await interaction.reply({
            content: 'You are already part of the investigation!',
            ephemeral: true,
        });
        return;
    }

    activeGame.state.participants.add(userId);

    // Assign MM Role
    try {
        const member = await interaction.guild?.members.fetch(userId);
        const detectiveRoleId = await manager.getDetectiveRoleId(interaction.guild || undefined);
        if (member && detectiveRoleId) await member.roles.add(detectiveRoleId);
    } catch (e) {
        logger.warn(`Failed to add MM role to ${userId} on join`, e);
    }

    // Check if this is their first time (using InterrogationLog as a proxy)
    let isFirstTime = false;
    try {
        const interrogationCount = await InterrogationLog.count({ where: { userId } });
        if (interrogationCount === 0) {
            isFirstTime = true;
        }
    } catch (e) {
        logger.error(`Failed to check interrogation count for ${userId}`, e);
    }

    if (isFirstTime) {
        const welcomeEmbed = new EmbedBuilder()
            .setColor(Colors.Green)
            .setTitle('🔍 Welcome New Investigator!')
            .setDescription(`Welcome to the team, ${interaction.user.displayName}! As a rookie, you should review our tactical handbook below to get started.`)
            .setTimestamp();

        // Find a suspect to suggest
        const suspects = activeGame.config.suspects;
        if (suspects.length > 0) {
            const randomSuspect = suspects[Math.floor(Math.random() * suspects.length)];
            const channel = manager.getChannelsMap()?.get(randomSuspect.currentLocation);
            if (channel) {
                welcomeEmbed.addFields({
                    name: '🏃 QUICK START',
                    value: `Head over to <#${channel.id}> right now and start questioning **${randomSuspect.name}**! Simply type their name followed by your question (e.g. "${randomSuspect.name.split(' ')[0]}, where were you?")`
                });
            }
        }

        const { embed: helpEmbed, files: helpFiles } = createHelpEmbed();

        await interaction.reply({
            embeds: [welcomeEmbed, helpEmbed],
            files: helpFiles,
            ephemeral: true,
        });
    } else {
        await interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(Colors.Green)
                    .setTitle('🔍 Joined Investigation')
                    .setDescription(`Welcome back to the team, detective ${interaction.user.displayName}!`)
            ],
            ephemeral: interaction.isButton() ? true : false,
        });
    }

    // Save state to database
    await manager.saveState();
}
