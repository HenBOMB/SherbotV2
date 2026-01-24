import { GuildMember, TextChannel } from 'discord.js';
import Suspect from './suspect.js';
import { PlayerStats } from './case.js';

export interface InterrogationBuffer {
    suspect: Suspect;
    messages: string[];
    timer: NodeJS.Timeout;
    member: GuildMember;
    channel: TextChannel;
}

export type GamePhase = 'investigating' | 'accused' | 'ended';

export { PlayerStats };
