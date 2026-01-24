import {
    ChatInputCommandInteraction
} from 'discord.js';
import { createToolEmbed } from '../../commands.js';
import GameManager from '../../game.js';

/**
 * Handle /mm examine command
 */
export async function handleExamine(
    manager: GameManager,
    interaction: ChatInputCommandInteraction
): Promise<void> {
    if (!manager.isParticipant(interaction.user.id)) {
        await interaction.reply({
            content: 'You must join the investigation with `/mm join` before you can use detective tools.',
            ephemeral: true
        });
        return;
    }

    const tools = manager.getTools();
    const activeGame = manager.getActiveGame();

    if (!tools || !activeGame?.isActive()) {
        await interaction.reply({ content: 'No active game.', ephemeral: true });
        return;
    }

    const item = interaction.options.getString('item', true);

    // Security check: Must have discovered the item already
    const discovered = manager.getDiscoveredEvidence();
    if (!discovered.has(`physical_${item.toLowerCase()}`)) {
        await interaction.reply({
            content: `You haven't discovered any item named "${item}" yet. Explore more to find clues!`,
            ephemeral: true
        });
        return;
    }

    const result = tools.examine(item);

    const embed = createToolEmbed(
        'examine' as any,
        item,
        result.result,
        result.cost,
        result.success,
        result.error
    );

    // If successful, maybe highlight it in the log
    if (result.success) {
        manager.getDashboard().addEvent('tool_use', `Examined item: ${item}`);
        manager.broadcastDashboardState();
        await manager.saveState();
    }

    await interaction.reply({ embeds: [embed] });
}
