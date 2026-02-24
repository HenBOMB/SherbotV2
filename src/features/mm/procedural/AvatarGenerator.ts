import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const beanheads = require('beanheads');
const { BeanHead } = beanheads;
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { aiService } from '../ai-service.js';

export class AvatarGenerator {
    private outputDir: string;
    private previousAvatars: any[] = [];

    public resetHistory() {
        this.previousAvatars = [];
    }

    constructor() {
        // Ensure output directory exists
        this.outputDir = path.resolve(process.cwd(), 'public', 'avatars');
        if (!fs.existsSync(this.outputDir)) {
            fs.mkdirSync(this.outputDir, { recursive: true });
        }
    }

    async generateAvatar(filename: string = uuidv4(), context?: { role: string; gender: string; description?: string }): Promise<string> {
        let props;

        if (context) {
            try {
                console.log(`Generating avatar props for ${context.role} (${context.gender})...`);
                props = await this.generateAvatarProps(context);
            } catch (e) {
                console.error("Failed to generate avatar props via LLM, falling back to random:", e);
                props = this.getRandomProps();
            }
        } else {
            props = this.getRandomProps();
        }

        // Render to SVG string
        const svgStringRaw = renderToStaticMarkup(React.createElement(BeanHead, props));

        // Fix for Sharp/librsvg rendering of transform-origin: center
        // By default it might use the viewbox, causing offsets. We force it to use the element box.
        const svgString = svgStringRaw.replace(
            /style="transform-origin:center"/g,
            'style="transform-box: fill-box; transform-origin: center;"'
        );

        // Convert to PNG using Sharp
        const outputPath = path.join(this.outputDir, `${filename}.png`);

        await sharp(Buffer.from(svgString))
            .resize(512, 512)
            .png()
            .toFile(outputPath);

        return outputPath;
    }

    private async generateAvatarProps(context: { role: string; gender: string; description?: string }): Promise<any> {
        // Valid options extracted from library inspection
        const validOptions = {
            body: ['chest', 'breasts'],
            // others: naked
            clothing: ['shirt', 'dressShirt', 'vneck', 'tankTop', 'dress'],
            hair: ['none', 'long', 'bun', 'short', 'pixie', 'balding', 'buzz', 'afro', 'bob'],
            mouth: ['grin', 'sad', 'openSmile', 'lips', 'open', 'serious', 'tongue'],
            // others: heart
            eyes: ['normal', 'leftTwitch', 'happy', 'content', 'squint', 'simple', 'dizzy', 'wink'],
            eyebrows: ['raised', 'leftLowered', 'serious', 'angry', 'concerned'],
            accessory: ['none', 'roundGlasses', 'tinyGlasses', 'shades'],
            facialHair: ['none', 'none2', 'none3', 'stubble', 'mediumBeard'],
            hairColor: ['blonde', 'orange', 'black', 'white', 'brown', 'blue', 'pink'],
            clothingColor: ['white', 'blue', 'black', 'green', 'red'],
            circleColor: ['blue', 'green', 'red', 'yellow'],
            lipColor: ['red', 'purple', 'pink', 'turqoise', 'green'],
            skinTone: ['light', 'brown', 'dark', 'black']
        };

        const systemPrompt = `You return valid minified JSON representing character appearance.
Use ONLY:
- Body: ${validOptions.body.join(',')}
- Clothing: ${validOptions.clothing.join(',')}
- ClothingColor: ${validOptions.clothingColor.join(',')}
- Hair: ${validOptions.hair.join(',')}
- HairColor: ${validOptions.hairColor.join(',')}
- HatColor: ${validOptions.clothingColor.join(',')}
- Mouth: ${validOptions.mouth.join(',')}
- Eyes: ${validOptions.eyes.join(',')}
- Eyebrows: ${validOptions.eyebrows.join(',')}
- Accessory: ${validOptions.accessory.join(',')}
- FacialHair: ${validOptions.facialHair.join(',')}
- SkinTone: ${validOptions.skinTone.join(',')}
- LipColor: ${validOptions.lipColor.join(',')}
- CircleColor: ${validOptions.circleColor.join(',')}
`;

        const historyText = this.previousAvatars.length > 0
            ? `\nTry to choose unique options and avoid repeating these visual traits:\n${JSON.stringify(this.previousAvatars)}`
            : '';

        const userPrompt = `Role: ${context.role}
Desc: ${context.description || 'N/A'}
Gender: ${context.gender}${historyText}

Format:
{"body":"","clothing":"","clothingColor":"","hair":"","hairColor":"","hatColor":"","mouth":"","eyes":"","eyebrows":"","accessory":"","facialHair":"","skinTone":"","lipColor":"","circleColor":""}`;

        try {
            const response = await aiService.generateText(systemPrompt, userPrompt, { temperature: 0.7 });

            // Clean up potentially dirty JSON (e.g. markdown blocks or intro text)
            let cleanJson = response.replace(/```json/g, '').replace(/```/g, '').trim();
            const firstBrace = cleanJson.indexOf('{');
            const lastBrace = cleanJson.lastIndexOf('}');

            if (firstBrace === -1) {
                cleanJson = '{' + cleanJson;
            }

            if (lastBrace === -1) {
                cleanJson = cleanJson + '}';
            }

            const json = JSON.parse(cleanJson);

            json.hat = 'none';

            // Safety overrides for critical fields
            if (json.body && !validOptions.body.includes(json.body)) json.body = 'chest';
            if (json.clothing && !validOptions.clothing.includes(json.clothing)) json.clothing = 'shirt';
            if (json.hair && !validOptions.hair.includes(json.hair)) json.hair = 'short';
            if (json.facialHair && !validOptions.facialHair.includes(json.facialHair)) json.facialHair = 'none';

            // Color validation
            if (json.hairColor && !validOptions.hairColor.includes(json.hairColor)) json.hairColor = 'brown';
            if (json.clothingColor && !validOptions.clothingColor.includes(json.clothingColor)) json.clothingColor = 'white';
            if (json.hatColor && !validOptions.clothingColor.includes(json.hatColor)) json.hatColor = 'black';
            if (json.skinTone && !validOptions.skinTone.includes(json.skinTone)) json.skinTone = 'light';
            if (json.lipColor && !validOptions.lipColor.includes(json.lipColor)) json.lipColor = 'pink';
            if (json.circleColor && !validOptions.circleColor.includes(json.circleColor)) json.circleColor = 'blue';

            this.previousAvatars.push({
                hair: json.hair,
                hairColor: json.hairColor,
                clothing: json.clothing,
                clothingColor: json.clothingColor,
                accessory: json.accessory,
                facialHair: json.facialHair
            });

            return {
                ...this.getRandomProps(), // Defaults
                ...json, // Overrides from LLM
                mask: false,
                faceMask: false
            };
        } catch (e) {
            console.error("LLM Generation failed, parsing error?", e);
            throw e;
        }
    }

    private getRandomProps(): any {
        const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];
        const boolean = () => Math.random() > 0.5;

        return {
            accessory: pick(['none', 'roundGlasses', 'tinyGlasses', 'shades']),
            body: pick(['chest', 'breasts']),
            circleColor: pick(['blue', 'green', 'red', 'yellow']),
            clothing: pick(['naked', 'shirt', 'dressShirt', 'tankTop', 'vneck']),
            clothingColor: pick(['white', 'blue', 'black', 'green', 'red']),
            eyebrows: pick(['raised', 'serious', 'angry', 'concerned']),
            eyes: pick(['normal', 'leftTwitch', 'happy', 'content', 'squint', 'simple', 'dizzy', 'wink', 'heart']),
            facialHair: pick(['none', 'none', 'mediumBeard']),
            graphic: 'none',
            hair: pick(['none', 'long', 'bun', 'short', 'pixie', 'balding', 'buzz', 'afro', 'bob']),
            hairColor: pick(['blonde', 'orange', 'black', 'white', 'brown', 'blue', 'pink']),
            hat: pick(['none', 'none', 'beanie', 'turban']),
            hatColor: pick(['white', 'blue', 'black', 'green', 'red']),
            lashes: boolean().toString(),
            lipColor: pick(['red', 'purple', 'pink', 'turqoise', 'green']),
            mask: false,
            faceMask: false,
            mouth: pick(['grin', 'sad', 'openSmile', 'lips', 'open', 'serious', 'tongue']),
            skinTone: pick(['light', 'yellow', 'brown', 'dark', 'red', 'black'])
        };
    }
}
