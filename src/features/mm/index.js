import fs from 'fs';
import NPC from './npc.js';
import { CategoryChannel, ChannelType, Client, Colors, Message, OverwriteType, PermissionFlagsBits, SortOrderType } from 'discord.js';
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
        this._banned = [];
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
         * @private
         */
        this.rooms = []

        /**
         * @private
         */
        this.dir = `data/${this.name.replace(/ +/g, '_').toLowerCase()}`;

        this.setup(client);
    }

    /**
     * @param {Client} client 
     * @private
     */
    async setup(client) {
        if(!fs.existsSync(this.dir+'/settings.json')) throw 'Missing Murder Mystery settings.';

        const settings = JSON.parse(fs.readFileSync(this.dir+'/settings.json', 'utf8'));
        const reason = settings.name + ' Murder Mystery Root Category';
        const guild = await client.guilds.fetch(settings.guild);
        const role = guild.roles.cache.find(role => role.name === settings.role) 
            || guild.roles.create({ 
                name: settings.role, 
                color: Colors.Gold, 
                hoist : false,
                mentionable: false,
                reason,
            });
        const category = guild.channels.cache.find(channel => channel.name === settings.name && channel.type === ChannelType.GuildCategory) 
            || await guild.channels.create(
                { 
                    name: settings.name, 
                    reason,
                    type: ChannelType.GuildCategory,
                    position: 0,
                });
        
        const rooms = fs.readdirSync(this.dir+'/room');

        for (let i = 0; i < rooms.length; i++) 
        {
            const room = JSON.parse(fs.readFileSync(this.dir+'/room/'+rooms[i], 'utf8'));
            const channel = guild.channels.cache.find(channel => channel.name === room.name) 
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
                            id: role.id,
                            type: OverwriteType.Role,
                            allow: [ PermissionFlagsBits.SendMessages ],
                        },
                    ]
                });
            if(!this.rooms.includes(channel.id)) this.rooms.push(channel.id);
        }
    }

    /**
     * Update user permissions in the rooms: TODO
     * @param {Client} client 
     * @private
     */
    async refresh(client) {
        const settings = JSON.parse(fs.readFileSync(this.dir+'/settings.json', 'utf8'));
        const guild = await client.guilds.fetch(settings.guild);
        /**
         * @type {CategoryChannel}
         */
        const category = guild.channels.cache.find(channel => channel.name === settings.name && channel.type === ChannelType.GuildCategory);

        for(const player of Object.values(this._players))
        {
            for(const room of category.children.cache.values())
            {
                if(!room.permissionsFor(guild.roles.everyone.id).has('ViewChannel') || !player.discovered.includes(room.name)) continue;
                room.permissionsFor(player.id).add(PermissionFlagsBits.ViewChannel);
            }
        }
    }

    continue() {
        if(this._messageCreate)
        {
            this.client.removeListener('messageCreate', this._messageCreate);
            this._messageCreate = null;
        }

        /**
         * @param {Message<boolean>} message
         */
        this._messageCreate = async function (message) {
            if(message.author.bot || 
                this._banned.includes(message.member.id) ||
                this._ignore.includes(message.member.id) || 
                !this.rooms.includes(message.channelId) || 
                !this._players[message.member.displayName]) return;
    
            // ! block banned users
    
            const words = message.content.match(/\w+/g);
            const npc = Object.values(this._npcs)
                .find(npc => 
                    npc._focused === message.member.id || 
                    npc.alias.find(alias => words.find(word => word.toLowerCase() === alias.toLowerCase()))
                );
    
            if(!npc) return;
            
            const channel = message.channel;
            const content = message.content;
            const member = message.member;
    
            if(content.length < 7) return;
    
            var response = npc.respond(
                member, 
                content,
                channel
            );
            
            const bot = channel.guild.members.cache.get('712429527321542777');
    
            await new Promise(res => setTimeout(res, 1700));
            await bot.setNickname(npc.name);
            await channel.sendTyping();
            await new Promise(res => setTimeout(res, 4000));
    
            response = await response;
    
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
                this._banned.push(member.id);
            }

            if(response.cmd.includes('leave'))
            {
                this._ignore.push(member.id);
            }
        }

        const us = this;
        us.client.on('messageCreate', this._messageCreate);
    }
    
    stop() {
        if(this._messageCreate)
        {
            this.client.removeListener('messageCreate', this._messageCreate);
            this._messageCreate = null;
        }
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
}