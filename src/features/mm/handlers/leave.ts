import {
    ChatInputCommandInteraction,
    ButtonInteraction,
    EmbedBuilder,
    Colors
} from 'discord.js';
import { logger } from '../../../utils/logger.js';
import GameManager from '../game.js';

/**
 * Handle /mm leave command
 */
export async function handleLeave(
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
    if (!activeGame.state.participants.has(userId)) {
        await interaction.reply({
            content: 'You are not part of the investigation team!',
            ephemeral: true,
        });
        return;
    }

    activeGame.state.participants.delete(userId);

    // Remove MM Role
    try {
        const member = await interaction.guild?.members.fetch(userId);
        const detectiveRoleId = await manager.getDetectiveRoleId(interaction.guild || undefined);
        if (member && detectiveRoleId) await member.roles.remove(detectiveRoleId);
    } catch (e) {
        logger.warn(`Failed to remove MM role from ${userId} on leave`, e);
    }

    await interaction.reply({
        embeds: [
            new EmbedBuilder()
                .setColor(Colors.Orange)
                .setTitle('👋 Left Investigation')
                .setDescription(`${interaction.user.displayName} has left the detective team.`)
        ],
        ephemeral: interaction.isButton() ? true : false,
    });

    // Save state to database
    await manager.saveState();
}
