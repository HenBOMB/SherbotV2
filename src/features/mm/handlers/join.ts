import {
    ChatInputCommandInteraction,
    EmbedBuilder,
    Colors
} from 'discord.js';
import GameManager from '../game.js';

/**
 * Handle /mm join command
 */
export async function handleJoin(
    manager: GameManager,
    interaction: ChatInputCommandInteraction
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
    await interaction.reply({
        embeds: [
            new EmbedBuilder()
                .setColor(Colors.Green)
                .setTitle('🔍 Joined Investigation')
                .setDescription(`Welcome to the team, ${interaction.user.displayName}!`)
        ],
    });

    // Save state to database
    await manager.saveState();
}
