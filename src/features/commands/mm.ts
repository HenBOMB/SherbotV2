import { ChatInputCommandInteraction, AutocompleteInteraction } from 'discord.js';
import { mmCommands } from '../mm/commands.js';
import GameManager from '../mm/game.js';
import { Command } from '../../types.js';

// Singleton game manager (initialized on first command)
let gameManager: GameManager | null = null;

const command: Command = {
    guild: '1462571184787947674', // Your server ID
    data: mmCommands,

    async execute(interaction: ChatInputCommandInteraction) {
        // Lazy init game manager with guild from interaction
        if (!gameManager && interaction.guild) {
            gameManager = new GameManager(
                interaction.client,
                interaction.guild.id,
                'data'
            );
        }

        if (!gameManager) {
            await interaction.reply({
                content: 'Failed to initialize game manager.',
                ephemeral: true,
            });
            return;
        }

        const subcommand = interaction.options.getSubcommand();

        switch (subcommand) {
            case 'start': {
                const caseId = interaction.options.getString('case', true);
                const time = interaction.options.getInteger('time') ?? undefined;
                await gameManager.startGame(interaction, caseId, time);
                break;
            }

            case 'status':
                await gameManager.handleStatus(interaction);
                break;

            case 'join':
                await gameManager.handleJoin(interaction);
                break;

            case 'dna':
                await gameManager.handleDNA(interaction);
                break;

            case 'footage':
                await gameManager.handleFootage(interaction);
                break;

            case 'locate':
                await gameManager.handleLocate(interaction);
                break;

            case 'accuse':
                await gameManager.handleAccuse(interaction);
                break;

            case 'end':
                await gameManager.handleEnd(interaction);
                break;

            case 'suspects':
                await gameManager.handleSuspects(interaction);
                break;

            case 'help':
                await gameManager.handleHelp(interaction);
                break;

            default:
                await interaction.reply({
                    content: `Unknown subcommand: ${subcommand}`,
                    ephemeral: true,
                });
        }
    },

    async autocomplete(interaction: AutocompleteInteraction) {
        if (!gameManager && interaction.guild) {
            gameManager = new GameManager(
                interaction.client,
                interaction.guild.id,
                'data'
            );
        }

        if (gameManager) {
            await gameManager.handleAutocomplete(interaction);
        }
    },

    async init(client: Client) {
        // Initialize game manager on startup for restoration
        const guildId = this.guild || '1462571184787947674';
        if (!gameManager) {
            gameManager = new GameManager(client, guildId, 'data');
            await gameManager.restoreGames();
        }
    }
};

import { Client } from 'discord.js';

export default command;
