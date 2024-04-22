import axios from "axios";
import { GuildMember, TextChannel } from "discord.js";

const OPTIONS = {
    method: 'POST',
    url: 'https://cheapest-gpt-4-turbo-gpt-4-vision-chatgpt-openai-ai-api.p.rapidapi.com/v1/chat/completions',
    headers: {
        'content-type': 'application/json',
        'X-RapidAPI-Key': '7e9353ff96msh3df3c16bd72b93fp18d49fjsn132fdefd5328',
        'X-RapidAPI-Host': 'cheapest-gpt-4-turbo-gpt-4-vision-chatgpt-openai-ai-api.p.rapidapi.com'
    },
    data: {
        model: 'gpt-4-turbo-preview',
        max_tokens: 200,
        temperature: 0.92
    }
};

// ! - I want your action to be the action that %name% would take.
// ~ + I want you to log the action %name% will take at the end of your message.

const PROMPT = 
`I want you to act like %name%.
I want you to respond and answer like the chracter.
I want you to respond and roleplay like the chracter.
I want you to choose an action to take.
I want your answer to be in this format: "answer" *roleplay* /action.
%name%'s available actions: 
- /leave: Leave the conversation and dont talk to %asker% anymore.
- /ban: Ban %asker% from the party.
- /continue: Continue the conversation with the %asker%.
- /skip: Leave the conversation and and dont say anything.
%name% can /leave if %asker% is inappropriate or %name% or %asker% stops the conversation.
%name% can /continue if %name% asks a question.
%name% can /ban if %asker% is inappropriate, implying NSFW, sexist or rasist comments.
%name% can /skip if %asker%'s message is not meant for %name%, and instead for someone else.
%name% only speaks English and does not understand any other language.
%name% does not know anything about Generative Models or AI or ChatBots.
%name% does not know they are in a Murder Mystery game and does not mention it ever.
`;

export default class NPC {
    /**
     * @param {import('./index').default} mm - Murder Mystery
     * @param {{ name: string, alias: string[], avatar: string, gender: string? }} options 
     * @param {string[]} traits 
     * @param {string[]} [other=[]] 
     * @param {(msg: string) => string} [filter] 
     * @returns {NPC}
     */
	constructor(mm, options, traits=[], other=[], filter)
	{
        this.traits = traits? traits : [];
        this.other  = other? other : [];
		this.filter = filter? filter : (x => x);
        
        this.mm     = mm;
		this.id     = options.id || null;
		this.name   = options.name;
		this.alias  = options.alias;
		this.avatar = options.avatar;
		this.gender = options.gender;
        this._focused = '-1';
        this._busy    = false;

        if(this.gender) traits = [`is ${this.gender}`, ...traits];
		
		/**
		 * @private
		 */
		this._role = [
            PROMPT, 
            this.traits.map(x => `%name% ${x}.`).join('\n'),
            this.other.join('\n')
        ].join('\n').replace(/%name%/g, this.name);

		/**
         * @type {{ [channelId: string]: string[] }}
		 * @private
		 */
		this._memory = { };
	}

	/**
	 * @param {GuildMember} asker - GuildMember of the person who's asking.
	 * @param {string} sentence - Sentence to ask bot.
	 * @param {TextChannel} channel - Text channel to reply in.
	 * @returns {Promise<null|{ cb: () => Promise<void>, cmd: string?, rp: string? }>} 
	 */
	async respond(asker, sentence, channel) 
	{
        if(this._busy) return null;
        
        this._busy = true;
        const us = this;
        const hook = us.id? null : await channel.fetchWebhooks().then(hooks => hooks.find(hook => hook.name.includes(us.name))) 
		|| await channel.createWebhook({
			name: us.name,
			avatar: us.avatar,
			reason: 'Added character npc hook ' + us.name
		}).catch(() => null);

		if(!hook && !us.id) return null;

        const memory = us.getMemory(channel.id);
        const prompt = [
            us._role, 
            memory && memory.length? `${us.name}'s remembers what others said before:\n${memory.join('\n')}` : null,
            //`User ${asker.displayName}'s ${memory?.find(line => line.includes(asker.displayName))? 'last' : 'first'} message is: ${sentence}`
        ].filter(Boolean).join('\n').replace(/%asker%/g, asker.displayName);
        // console.log('\nPrompt:', prompt);

		return axios.request({
			...OPTIONS,
			data: {
				...OPTIONS.data,
				messages: [
					{
                        role: 'system',
                        content: prompt
					},
                    {
                        role: 'user',
                        content: sentence
					}
				],
			}
		})
		.then(res => {
            us._busy = false;
            const text 	= res.data.choices[0].message.content;
			console.log('Response:', text || res.data);
			const cmd 	= /\/(\w+)/.exec(text);
            const msg 	= us.filter(/"(.+?)"/.exec(text.replace(/\/(\w+)/,''))[1]);
			const rp 	= /\*(.+?)\*/.exec(text);
            const final = `${msg}`;//${rp[1]? `\n${rp[1].startsWith('*')?'':'*'}${rp[1]}${rp[1].endsWith('*')?'':'*'}` : ''}`;
            return (text && {
				cb: () => (us.id? channel.send(final) : hook.send(final)).then(() => {
                    us.addMemory(
                        channel.id, `- ${asker.displayName}: ${sentence}`, 
                        // channel.id, `- "${final}"`
                    );
                    us.setFocus(asker);
                    if(cmd && (cmd.includes('skip') || cmd.includes('leave') || cmd.includes('ban')))
                    {
                        us._focused = '-1';
                    }
                }),
				cmd: cmd? cmd[1] : null,
				rp: rp? rp[1] : null
			}) || null;
		})
		.catch(err => {
            us._busy = false;
			console.error(err);
			return null;
		});
	}

    setFocus(asker) {
		// ? reset previous focus
        this.mm.editNpcs((pre, cur) => { 
            if(cur._focused === asker.id) cur._focused = '-1'; 
            pre[cur.name] = cur; 
            return pre; 
        });
        // ? apply new focus
        this._focused = asker.id;
    }

    getMemory(id) {
        return this._memory[id] || [];
    }

    setMemory(id, memory) {
        this._memory[id] = memory;
    }

    clearMemory(id) {
        this._memory[id] = [];
    }

    addMemory(id, ...memory) {
        this.setMemory([...memory, ...this.getMemory(id)]);
    }
}