import {
    ChatInputCommandInteraction,
    EmbedBuilder,
    Colors
} from 'discord.js';
import { hasPermission, denyPermission } from '../commands.js';
import { logger } from '../../../utils/logger.js';
import GameManager from '../game.js';

/**
 * Handle /mma finalize command
 */
export async function handleFinalize(
    manager: GameManager,
    interaction: ChatInputCommandInteraction
): Promise<void> {
    logger.info(`Game manually finalized by ${interaction.user.tag}.`);

    if (!hasPermission(interaction)) {
        await denyPermission(interaction);
        return;
    }

    const activeGame = manager.getActiveGame();

    if (!activeGame?.state || activeGame.state.phase !== 'investigating') {
        await interaction.reply({ content: 'No active investigation to finalize.', ephemeral: true });
        return;
    }

    await interaction.deferReply();

    // Remove detective roles before terminating the game
    await manager.removeDetectiveRoleFromAll();

    activeGame.end();
    manager.stopTimer();

    const embed = new EmbedBuilder()
        .setColor(Colors.DarkRed)
        .setTitle('⚖️ INVESTIGATION FINALIZED: TIME EXPIRED')
        .setDescription(`\`\`\`ansi\n\u001b[1;31m[!] THE CASE HAS CONCLUDED\u001b[0m\n\`\`\`\nThe Yard has formally closed the investigation. Any culprits still at large have slipped into the fog.\n\nScotland Yard thanks you for your service.`);

    const investigationChannel = manager.getChannelsMap().get('case-briefing');
    if (investigationChannel) {
        await investigationChannel.send({ embeds: [embed] });
    }

    manager.purgeEphemeralState();
    await manager.saveState();
    manager.broadcastDashboardState();

    await interaction.editReply('✅ Investigation finalized gracefully.');
}
