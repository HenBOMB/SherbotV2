import {
    ChatInputCommandInteraction,
    EmbedBuilder,
    Colors
} from 'discord.js';
import { createStatusEmbed } from '../commands.js';
import GameManager from '../game.js';

/**
 * Handle /mm status command
 */
export async function handleStatus(
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
                    .setDescription('Start a game with `/mm start <case>`')
            ],
            ephemeral: true,
        });
        return;
    }

    const state = activeGame.state;

    let accusedName: string | undefined;
    let killerName: string | undefined;

    if (state.phase === 'accused' && state.accusation) {
        const suspect = activeGame.getSuspect(state.accusation.accusedId);
        accusedName = suspect?.name;

        const killer = activeGame.getSuspect(activeGame.config.solution);
        killerName = killer?.name;
    }

    const totalVotes = Object.keys(state.accusations || {}).length;
    const votesNeeded = Math.ceil(state.participants.size / 2);

    const embed = createStatusEmbed(
        activeGame.config.name,
        activeGame.getRemainingTime(),
        state.points,
        state.participants.size,
        state.phase,
        state.playerStats,
        state.accusation ? { ...state.accusation, accusedName } : { currentVotes: totalVotes, votesNeeded } as any,
        killerName
    );

    await interaction.reply({ embeds: [embed] });
}
