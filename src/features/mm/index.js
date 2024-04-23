import fs from 'fs';
import NPC from './npc.js';
import { ChannelType, Client, Colors, Guild, Message, OverwriteType, PermissionFlagsBits, Role, TextChannel } from 'discord.js';
import Player from './player.js';

export default class MurderMystery {
    /**
     * @param {import('discord.js').Client} client
     */
    constructor(client, name) {
        /**
         * @private
         */
        this.name = name;
        /**
         * @type {{ [name: string]: Player }}
         * @private
         */
        this._players = {};
        /**
         * @private
         */
        this._ignore = []
        /**
         * @private
         */
        this.client = client;
        /**
         * @type {{ [ key: string ]: NPC }}
         * @private
         */
        this._npcs = { };
        /**
         * @private
         */
        this._messageCreate = null;

        /**
         * @type {string[]}
         * @private
         */
        this.rooms = []

        /**
         * @type {Role}
         * @private
         */
        this.role = null;

        /**
         * @private
         */
        this.dir = `data/${this.name.replace(/ +/g, '_').toLowerCase()}`;

        if(!fs.existsSync(this.dir+'/_settings.json')) throw 'Missing Murder Mystery settings.';

        /**
         * @type {{ name: string, role: string, guild: string, players: string[], bans: string[] }}
         * @private
         */
        this.settings = JSON.parse(fs.readFileSync(this.dir+'/_settings.json', 'utf8'));

        this.setup(client);
    }

    /**
     * @param {Client} client 
     * @private
     */
    async setup(client) {
        const reason = this.settings.name + ' Murder Mystery Root Category';
        const guild = await client.guilds.fetch(this.settings.guild);
        this.role = guild.roles.cache.find(role => role.name === this.settings.role) 
            || await guild.roles.create({ 
                name: this.settings.role, 
                color: Colors.Gold, 
                hoist : false,
                mentionable: false,
                reason,
            });
        const category = guild.channels.cache.find(channel => channel.name === this.settings.name && channel.type === ChannelType.GuildCategory) 
            || await guild.channels.create(
                { 
                    name: this.settings.name, 
                    reason,
                    type: ChannelType.GuildCategory,
                    position: 0,
                });
        
        const rooms = fs.readdirSync(this.dir+'/room');
        this.rooms = [];

        for (let i = 0; i < rooms.length; i++) 
        {
            const room = JSON.parse(fs.readFileSync(this.dir+'/room/'+rooms[i], 'utf8'));
            const channel = guild.channels.cache.find(channel => channel.name === room.name && channel.parentId === category.id) 
                || await guild.channels.create({
                    name: room.name,
                    position: room.order? room.order - 1 : (i + 1),
                    topic: room.topic,
                    parent: category.id,
                    permissionOverwrites: [
                        {
                            id: guild.roles.everyone.id,
                            type: OverwriteType.Role,
                            deny: [...(room.hidden? [ PermissionFlagsBits.ViewChannel ] : []), PermissionFlagsBits.SendMessages ]
                        },
                        {
                            id: this.role.id,
                            type: OverwriteType.Role,
                            allow: [ PermissionFlagsBits.SendMessages ],
                        },
                    ]
                });
            this.rooms.push(channel.id);
        }
    }

    /**
     * @param {Client} client 
     * @private
     */
    // TODO: untested
    async refresh() {
        const guild = this.getGuild();

        for(const player of Object.values(this._players))
        {
            for(const room of this.getChannels())
            {
                // ? For those banned, remove all perms
                if(this.isBanned(player.id))
                {
                    const perms = room.permissionsFor(player.id);
                    perms?.has('SendMessages') && perms.remove('SendMessages');
                    continue;
                }
                // ? For hidden rooms, add only those players who've found it
                if(!room.permissionsFor(guild.roles.everyone.id).has('ViewChannel') || !player.discovered.includes(room.name)) continue;
                const perms = room.permissionsFor(player.id);
                !perms.has(PermissionFlagsBits.ViewChannel) && perms.add(PermissionFlagsBits.ViewChannel);
                // ? -
            }
        }
    }

    continue() {
        if(this._messageCreate)
        {
            this.client.removeListener('messageCreate', this._messageCreate);
            this._messageCreate = null;
        }

        const us = this;
        /**
         * @param {Message<boolean>} message
         */
        us._messageCreate = async function (message) {
            if(!message.member) return; // ? webhook

            const user = message.member.user;

            if(message.author.bot || 
                message.guildId !== us.settings.guild || 
                us.isBanned(message, user.id) ||
                us._ignore.includes(user.id) || 
                !us.rooms.includes(message.channelId) || 
                !us._players[user.displayName]) return;
    
            const words = message.content.match(/\w+/g);
            const npc = Object.values(us._npcs).find(npc => 
                npc._focused === user.id || 
                npc.alias.find(alias => words.find(word => word.toLowerCase() === alias.toLowerCase()))
            );
    
            if(!npc) return;
            
            const channel = message.channel;
            const content = message.content;
    
            if(content.length < 7) return;
    
            var response = npc.respond(
                user, 
                content,
                channel
            );
            
            const bot = channel.guild.members.cache.get('712429527321542777');
    
            await new Promise(res => setTimeout(res, 1700));
            await bot.setNickname(npc.name);
            await channel.sendTyping();
            await new Promise(res => setTimeout(res, 4000));
    
            response = await response.catch(err => {
                console.error(err);
                return null;
            });
    
            if(!response)
            {
                await bot.setNickname('Sherbot');
                return;
            }
    
            if(!npc.id)
            {
                await bot.setNickname(npc.name);
                channel.send('ㅤ').then(msg => msg.delete());
                await new Promise(res => setTimeout(res, 288)); // ! X - Y
            }

            await response.cb();

            await bot.setNickname('Sherbot');

            if(response.cmd.includes('ban'))
            {
                us.ban(user.id);
            }

            if(response.cmd.includes('leave'))
            {
                us._ignore.push(user.id);
            }
        }

        us.client.on('messageCreate', us._messageCreate);
    }

    // TODO: 
    destroy() {
        // ? destroy all channels, data, everything, or maybe encode it all into 1
        throw 'TODO: destroy()';
    }
    
    // TODO: UNTESTED
    stop() {
        if(this._messageCreate)
        {
            this.client.removeListener('messageCreate', this._messageCreate);
            this._messageCreate = null;
        }
    }

    // TODO: UNTESTED
    async ban(id) {
        if(this.isBanned(id)) return;
        this._banned.push(id);
        const member = await this.getGuild().members.fetch(id);
        await member.roles.remove(this.role);
        this.settings.bans.push(member.id);
        this.saveSettings();
        await this.refresh();
    }

    isBanned(id) {
        return this.settings.bans.includes(id);
    }

    /**
     * @returns {Guild}
     */
    getGuild() {
        return this.client.guilds.cache.get(this.settings.guild);
    }

    /**
     * @returns {TextChannel[]}
     */
    getChannels() {
        return this.getGuild().channels.cache.find(c => c.name === this.settings.name).children;
    }

    /**
     * @param {...string|[string, function(msg): msg]} npcs - Filenames of npcs.
     */
    loadNpcsFromFiles(...npcs) {
        console.log('- loaded bots:');
        for(const data of npcs) {
            const [ name, cb ] = typeof data === 'string'? [data, null] : data;
            const path = `${this.dir}/npc/${name.toLowerCase()}.json`;
            if(!fs.existsSync(path))
            {
                console.log('   ✗', `${name}`);
                continue;
            }
            const obj = JSON.parse(fs.readFileSync(path, 'utf8'));
            this._npcs[obj[0].name] = new NPC(this, obj[0], obj[1], obj[2], cb);
            console.log('   ✓', `${obj[0].name}`);
        }
    }

    /**
     * @param {...[name: string, id: Snowflake, role: string]} players - Players to load.
     */
    loadPlayersManually(...players) {
        for(const player of players)
        {
            // ? name, id, role
            this._players[player[0]] = new Player(player[0], player[1], player[2]);
        }
    }
    
    /**
     * @param {(pre:{},cur:NPC) => NPC} fn 
     */
    editNpcs(fn) {
        this._npcs = Object.values(this._npcs).reduce(fn, {});
    }   

    saveSettings() {
        fs.writeFileSync(this.dir+'/_settings.json', JSON.stringify(this.settings, null, 2));
    }
}