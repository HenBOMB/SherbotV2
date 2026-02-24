import {
    ChatInputCommandInteraction,
    TextChannel,
    EmbedBuilder,
    Colors
} from 'discord.js';
import { createToolEmbed } from '../../commands.js';
import GameManager from '../../game.js';

/**
 * Handle /mm search command
 */
export async function handleSearch(
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
    if (!(channel instanceof TextChannel)) {
        await interaction.reply({ content: 'Must be used in a text channel.', ephemeral: true });
        return;
    }

    const locationId = manager.getLocationFromChannel(channel);
    if (!locationId) {
        await interaction.reply({ content: 'Not a valid location.', ephemeral: true });
        return;
    }

    // --- CHANNEL LOCK CHECK ---
    if (manager.isExploring(channel.id)) {
        await interaction.reply({
            content: '⚠️ An active search is already in progress in this area. Please wait for it to complete.',
            ephemeral: true
        });
        return;
    }

    // Lock the channel
    manager.setExploring(channel.id, true);

    // Initial response
    await interaction.reply({
        embeds: [
            new EmbedBuilder()
                .setColor(Colors.Yellow)
                .setTitle('🧭 Area Search Initialized')
                .setDescription(`\`\`\`ansi\n\u001b[1;33m[ SCANNING AREA: ${locationId.toUpperCase()} ]\u001b[0m\n\u001b[0;37mDeployment of FORENSIC_SWEEP drones... 20%\u001b[0m\n\`\`\`\nSearching for physical evidence. This will take a moment...`)
        ]
    });

    // --- ARTIFICIAL DELAY (5 seconds) ---
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Safety check: Is the game still active?
    if (!activeGame.isActive()) {
        manager.setExploring(channel.id, false);
        await interaction.editReply({ content: 'The investigation has ended. Scanning aborted.' });
        return;
    }

    const result = tools.search(locationId);
    const embed = createToolEmbed(
        'search',
        locationId,
        result.result,
        result.cost,
        result.success,
        result.error
    );

    // Update the original message with findings
    await interaction.editReply({ embeds: [embed] });

    // Unlock the channel
    manager.setExploring(channel.id, false);

    if (result.success) {
        manager.getDashboard().addEvent('tool_use', `Searched ${locationId}`);

        // Register evidence for secret triggers
        const findings = Array.isArray(result.result) ? result.result : [];
        findings.forEach(f => {
            if (f.startsWith('ITEM:')) {
                const itemId = f.replace('ITEM:', '');
                manager.addDiscoveredEvidence(`physical_${itemId}`);
            }
        });

        const stats = manager.getOrCreateStats(interaction.user.id, interaction.user.username);
        stats.toolsUsed++;
        // No more rooms discovered by search, removed room logic.

        manager.broadcastDashboardState();
        await manager.saveState();
    }
}
