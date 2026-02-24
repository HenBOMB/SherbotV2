import {
    ChatInputCommandInteraction,
    ButtonInteraction,
    EmbedBuilder,
    Colors
} from 'discord.js';
import { logger } from '../../../utils/logger.js';
import GameManager from '../game.js';

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

    await interaction.reply({
        embeds: [
            new EmbedBuilder()
                .setColor(Colors.Green)
                .setTitle('🔍 Joined Investigation')
                .setDescription(`Welcome to the team, ${interaction.user.displayName}!`)
        ],
        ephemeral: interaction.isButton() ? true : false,
    });

    // Save state to database
    await manager.saveState();
}
