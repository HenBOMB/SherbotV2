import {
    ChatInputCommandInteraction
} from 'discord.js';
import { createToolEmbed } from '../../commands.js';
import { logger } from '../../../../utils/logger.js';
import GameManager from '../../game.js';

/**
 * Handle /mm logs command
 */
export async function handleLogs(
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

    const time = interaction.options.getString('time', true);
    const result = tools.viewLogs(time);

    const embed = createToolEmbed(
        'logs',
        time,
        result.result,
        result.cost,
        result.success,
        result.error,
        { hintEngine: activeGame.hints }
    );

    // Get all timestamps from digital logs
    const logsData = activeGame.config.evidence.digital_logs || {};
    const allTimes = Object.keys(logsData).sort((a, b) => {
        return manager.parseTimeToMinutes(a) - manager.parseTimeToMinutes(b);
    });

    const currentIndex = allTimes.indexOf(time);
    const row = manager.createLogsButtons(currentIndex, allTimes);

    const response = await interaction.reply({
        embeds: [embed],
        components: row ? [row] : [],
        fetchReply: true
    });

    if (result.success) {
        manager.getDashboard().addEvent('tool_use', `Logs accessed at ${time}`);
        manager.broadcastDashboardState();

        // Register evidence for secret triggers
        manager.addDiscoveredEvidence(`logs_${time}`);

        const stats = manager.getOrCreateStats(interaction.user.id, interaction.user.username);
        // Maybe track logs specially? For now count as generic tool use
        stats.toolsUsed++;
        stats.evidenceFound += 1;

        await manager.saveState();
    }

    // Button collector
    if (!row) return;

    const collector = response.createMessageComponentCollector({
        filter: i => i.user.id === interaction.user.id,
        time: 60000
    });

    collector.on('collect', async i => {
        try {
            const newTime = i.customId.replace('mm_logs_', '');

            // Validate time exists in our list
            const newIndex = allTimes.indexOf(newTime);
            if (newIndex === -1) {
                await i.reply({ content: '❌ Error: This log timestamp is no longer valid.', ephemeral: true });
                return;
            }

            const newResult = tools.viewLogs(newTime, false);

            // Register evidence for secret triggers
            manager.addDiscoveredEvidence(`logs_${newTime}`);

            const newEmbed = createToolEmbed(
                'logs',
                newTime,
                newResult.result,
                0, // Subsequent navigations are free
                newResult.success,
                newResult.error,
                { hintEngine: activeGame.hints }
            );

            const newRow = manager.createLogsButtons(newIndex, allTimes);

            await i.update({
                embeds: [newEmbed],
                components: newRow ? [newRow] : []
            });
        } catch (err) {
            logger.error('Error in logs button collector:', err);
            try {
                if (!i.replied && !i.deferred) {
                    await i.reply({ content: '❌ An unexpected complication occurred while reviewing correspondence.', ephemeral: true });
                }
            } catch (e) {
                // Ignore
            }
        }
    });
}
