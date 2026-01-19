import { Collection, CommandInteraction, SlashCommandBuilder, SlashCommandSubcommandsOnlyBuilder, ButtonInteraction, StringSelectMenuInteraction, AutocompleteInteraction } from 'discord.js';

export interface Command {
    data: any; // Using any for data to allow property access without complex union narrowing for now
    execute(interaction: CommandInteraction): Promise<void>;
    guild?: string;
    click?(interaction: ButtonInteraction): Promise<void>;
    select?(interaction: StringSelectMenuInteraction): Promise<void>;
    init?(client: Client): Promise<void>;
    autocomplete?(interaction: AutocompleteInteraction): Promise<void>;
}

declare module 'discord.js' {
    interface Client {
        commands: Collection<string, Command>;
        botcolor: number;
    }
}
