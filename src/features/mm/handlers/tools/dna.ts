import {
    ChatInputCommandInteraction,
    TextChannel
} from 'discord.js';
import { createToolEmbed } from '../../commands.js';
import GameManager from '../../game.js';

/**
 * Handle /mm dna command
 */
export async function handleDNA(
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

    const channel = interaction.channel;
    let location: string | null = null;

    if (channel instanceof TextChannel) {
        location = manager.getLocationFromChannel(channel);
    }

    if (!location) {
        await interaction.reply({
            content: 'DNA analysis can only be performed while inside a location channel (e.g., #📍server-room).',
            ephemeral: true
        });
        return;
    }

    // Double check discovery (though being in the channel usually implies it)
    if (!activeGame.state?.discoveredLocations.has(location.toLowerCase())) {
        await interaction.reply({
            content: 'You cannot analyze DNA in an undiscovered location.',
            ephemeral: true
        });
        return;
    }

    const result = tools.analyzeDNA(location);
    const embed = createToolEmbed(
        'dna',
        location,
        result.result,
        result.cost,
        result.success,
        result.error
    );

    await interaction.reply({ embeds: [embed] });

    if (result.success) {
        manager.getDashboard().addEvent('tool_use', `DNA analysis at ${location}`);
        manager.broadcastDashboardState();

        // Register evidence for secret triggers
        manager.addDiscoveredEvidence(`dna_${location}`);

        const stats = manager.getOrCreateStats(interaction.user.id, interaction.user.username);
        stats.toolsUsed++;
        stats.evidenceFound += (Array.isArray(result.result) ? result.result.length : 0);

        await manager.saveState();
    }
}
