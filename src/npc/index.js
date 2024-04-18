import axios from "axios";
import { GuildMember, TextChannel } from "discord.js";

// const OPTIONS = {
// 	method: 'POST',
// 	url: 'https://open-ai21.p.rapidapi.com/chatbotapi',
// 	headers: {
// 		'content-type': 'application/json',
// 		'X-RapidAPI-Key': '7e9353ff96msh3df3c16bd72b93fp18d49fjsn132fdefd5328',
// 		'X-RapidAPI-Host': 'open-ai21.p.rapidapi.com'
// 	},
// 	data: {
// 		bot_id: 'OEXJ8qFp5E5AwRwymfPts90vrHnmr8yZgNE171101852010w2S0bCtN3THp448W7kDSfyTf3OpW5TUVefz',
// 		user_id: '',
// 		// ? 0.1 prompts a more focused and expected answer, while 0.8 encourages a more creative response
// 		temperature: 0.9, 
// 		top_k: 3,
// 		top_p: 0.5,
// 		max_tokens: 256,
// 		model: 'matag2.0'
// 	}
// };

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
        max_tokens: 60,
        temperature: 0.9
    }
};

const PROMPT = 
`I want you to act like %name%.
I want you to respond and answer like the chracter.
I want you to respond and roleplay like the chracter.
I want your answer be between "" (quotation marks).
I want your roleplay to be between ** (asterisks).
I want your action to be the action that %name% would take.
%name%'s available actions: 
- /leave: Leave the conversation (When %name% wants to stop talking).
- /ban: Ban the User from the party.
- /continue: Continue the conversation with the user (When %name% asks a question.. or not, depends).
- /skip: Choose to not reply to the user but, still continue the conversation.
%name% can /leave if User is inappropriate or %name% or User stops the conversation.
%name% can /ban if User is inappropriate, implying NSFW, sexist or rasist comments.
%name% can /skip if User's message is not meant for %name%, and instead for someone else.
%name% only speaks English and does not understand any other language.`

export class NPC {
	/**
	 * @type {{ [ key: string ]: NPC }}
     * @private
	 */
	static _all = {};

    static get(name) {
        return this._all[name];
    }

    static all() {
        return this._all;
    }

    static sets(cb) {
        this._all = Object.values(this._all).reduce(cb, {});
    }

    /**
     * @param {{ name: string, alias: string[], avatar: string, gender: string? }} options 
     * @param {string[]} traits 
     * @param {string[]} [other=[]] 
     * @returns {NPC}
     */
	constructor(options, traits, other=[])
	{
        if(this.gender) traits = [`is ${this.gender}`, ...traits];

		this.name   = options.name;
		this.alias  = options.alias;
		this.avatar = options.avatar;
		this.gender = options.gender;
        this._focused = '-1';
		
		/**
		 * @private
		 */
		this._role = [
            PROMPT, 
            traits.map(x => `%name% ${x}.`).join('\n'),
            other.join('\n')
        ].join('\n').replace(/%name%/g, this.name);

		/**
         * @type {{ [channelId: string]: string[] }}
		 * @private
		 */
		this._memory = { };

		NPC._all[this.name] = this;
	}

	/**
	 * @param {GuildMember} asker - GuildMember of the person who's asking.
	 * @param {string} sentence - Sentence to ask bot.
	 * @param {TextChannel} channel - Text channel to reply in.
	 * @returns {Promise<null|{ cb: () => Promise<void>, cmd: string?, rp: string? }>} 
	 */
	async respond(asker, sentence, channel) 
	{
        const us = this;
        const hook = await channel.fetchWebhooks().then(hooks => hooks.find(hook => hook.name.includes(this.name))) 
		|| await channel.createWebhook({
			name: this.name,
			avatar: this.avatar,
			reason: 'Added character npc hook ' + this.name
		}).catch(() => null);

		if(!hook) return null;

        const memory = us.getMemory(channel.id);
        const prompt = [
            us._role, 
            memory && memory.length? `\n${us.name}'s memory of the current conversation is:\n${memory.join('\n')}` : null,
            //`User ${asker.displayName}'s ${memory?.find(line => line.includes(asker.displayName))? 'last' : 'first'} message is: ${sentence}`
        ].filter(Boolean).join('\n');
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
			// const text 	= res.data.result;
			const text 	= res.data.choices[0].message.content;
			const cmd 	= /\/(\w+?)/.exec(text);
			const msg 	= /"(.+?)"/.exec(text.replace(/\/(\w+?)/,''))[1];
			const rp 	= /\*(.+?)\*/.exec(text);
			console.log('Response:', text || res.data);
			return (text && {
				cb: () => hook.send(msg).then(() => {
                    us.addMemory(
                        channel.id, `[${asker.displayName}] ${sentence}`, 
                        channel.id, `[${us.name}] ${msg}`
                    );
                    us.setFocus(asker);
                }),
				cmd: cmd? cmd[1] : null,
				rp: rp? rp[1] : null
			}) || null;
		})
		.catch(err => {
			console.error(err);
			return null;
		});
	}

    setFocus(asker) {
		// ? reset previous focus
        NPC.sets((pre, cur) => { 
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