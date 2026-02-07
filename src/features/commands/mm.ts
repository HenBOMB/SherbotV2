import { ChatInputCommandInteraction, AutocompleteInteraction, Client } from 'discord.js';
import { mmCommands } from '../mm/commands.js';
import GameManager from '../mm/game.js';
import { Command } from '../../types.js';

const command: Command = {
    guild: '1462571184787947674', // Your server ID
    data: mmCommands,

    async execute(interaction: ChatInputCommandInteraction) {
        let gameManager = GameManager.getInstance(interaction.guildId || undefined);

        // Lazy init if first time
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

            case 'logs':
                await gameManager.handleLogs(interaction);
                break;

            case 'explore':
                await gameManager.handleExplore(interaction);
                break;

            case 'evidence':
                await gameManager.handleEvidence(interaction);
                break;

            case 'examine':
                await gameManager.handleExamine(interaction);
                break;

            case 'present':
                await gameManager.handlePresent(interaction);
                break;

            case 'accuse':
                await gameManager.handleAccuse(interaction);
                break;

            case 'suspects':
                await gameManager.handleSuspects(interaction);
                break;

            case 'secrets':
                await gameManager.handleSecrets(interaction);
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
        const gameManager = GameManager.getInstance(interaction.guildId || undefined);
        if (gameManager) {
            await gameManager.handleAutocomplete(interaction);
        }
    },

    async init(client: Client) {
        // Initialize game manager on startup for restoration
        const guildId = '1462571184787947674';
        if (!GameManager.getInstance()) {
            const gm = new GameManager(client, guildId, 'data');
            await gm.restoreGames();
        }
    }
};

export default command;
