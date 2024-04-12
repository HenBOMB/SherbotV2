import fs from 'fs';
import { EmbedBuilder } from 'discord.js';
import { Server } from '../models.js';

const TIPS = fs.readFileSync('src/assets/tips.no', 'utf8').split('\n');

/**
 * @param {import('discord.js').Client} client
 */
export default function(client) {
    
}