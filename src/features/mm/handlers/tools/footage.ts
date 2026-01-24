import {
    ChatInputCommandInteraction
} from 'discord.js';
import { createToolEmbed } from '../../commands.js';
import { logger } from '../../../../utils/logger.js';
import GameManager from '../../game.js';

const BATTERY_COST = 10;

/**
 * Handle /mm footage command
 */
export async function handleFootage(
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
    const result = tools.viewFootage(time);
    let battery = 100;

    const embed = createToolEmbed(
        'footage',
        time,
        result.result,
        result.cost,
        result.success,
        result.error,
        { battery }
    );

    // Get all timestamps for buttons
    const allTimes = Object.keys(activeGame.config.evidence.footage || {}).sort((a, b) => {
        return manager.parseTimeToMinutes(a) - manager.parseTimeToMinutes(b);
    });

    const currentIndex = allTimes.indexOf(time);
    const row = manager.createFootageButtons(currentIndex, allTimes);

    const response = await interaction.reply({
        embeds: [embed],
        components: row ? [row] : [],
        fetchReply: true
    });

    if (result.success) {
        manager.getDashboard().addEvent('tool_use', `Footage viewed at ${time}`);
        manager.broadcastDashboardState();

        // Register evidence for secret triggers
        manager.addDiscoveredEvidence(`logs_${time}`);

        const stats = manager.getOrCreateStats(interaction.user.id, interaction.user.username);
        stats.toolsUsed++;
        stats.evidenceFound += 1;

        await manager.saveState();
    }

    // Button collector
    if (!row) return;

    const collector = response.createMessageComponentCollector({
        filter: i => i.user.id === interaction.user.id,
        time: 120000 // 2 minutes
    });

    collector.on('collect', async i => {
        try {
            const newTime = i.customId.replace('mm_footage_', '');

            // Consume battery
            battery -= BATTERY_COST;
            const isExpired = battery <= 0;

            // Validate time exists in our list
            const newIndex = allTimes.indexOf(newTime);
            if (newIndex === -1) {
                logger.warn(`Footage time not found in list: ${newTime} (User: ${i.user.tag})`);
                await i.reply({ content: '❌ Error: This footage timestamp is no longer valid.', ephemeral: true });
                return;
            }

            const newResult = tools.viewFootage(newTime, false);

            // Register evidence for secret triggers
            manager.addDiscoveredEvidence(`logs_${newTime}`);

            const newEmbed = createToolEmbed(
                'footage',
                newTime,
                isExpired ? null : newResult.result,
                0, // Subsequent navigations are free
                newResult.success,
                newResult.error,
                { battery: Math.max(0, battery) }
            );

            // If expired, or end of list, disable buttons
            let newRow = isExpired ? null : manager.createFootageButtons(newIndex, allTimes);

            await i.update({
                embeds: [newEmbed],
                components: newRow ? [newRow] : []
            });

            if (isExpired) {
                collector.stop('battery_exhausted');
            }
        } catch (err) {
            logger.error('Error in footage button collector:', err);
            // Attempt to notify user if interaction is still valid/open
            try {
                if (!i.replied && !i.deferred) {
                    await i.reply({ content: '❌ A system error occurred while switching footage.', ephemeral: true });
                }
            } catch (e) {
                // Ignore double-reply errors
            }
        }
    });

    collector.on('end', async (_, reason) => {
        if (reason === 'time' || reason === 'battery_exhausted') {
            try {
                const finalEmbed = createToolEmbed(
                    'footage',
                    time,
                    null,
                    0,
                    true,
                    undefined,
                    { battery: 0 }
                );
                await response.edit({ components: [], embeds: [finalEmbed] }).catch(() => { });
            } catch (e) { }
        }
    });
}
