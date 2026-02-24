
import { AvatarGenerator } from '../src/features/mm/procedural/AvatarGenerator.js';
import fs from 'fs';
import path from 'path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import beanheads from 'beanheads';
const { BeanHead } = beanheads;

async function main() {
    console.log("Testing AvatarGenerator...");
    const gen = new AvatarGenerator();

    // Force props to reproduce the issue
    // User image shows long hair + beanie
    const props = {
        accessory: 'shades',
        body: 'chest',
        clothing: 'tankTop',
        clothingColor: 'white',
        hair: 'long',
        hairColor: 'brown',
        hat: 'beanie',
        hatColor: 'white',
        mask: 'true',
        faceMask: 'true',
        skinTone: 'brown',
        mouth: 'sad',
        eyes: 'normal',
        eyebrows: 'concerned'
    };

    console.log("Generating with props:", props);

    // Render directly to inspect string
    const svgString = renderToStaticMarkup(React.createElement(BeanHead, props));
    const svgPath = path.resolve(process.cwd(), 'debug-avatar.svg');
    fs.writeFileSync(svgPath, svgString);
    console.log(`Saved debug SVG to ${svgPath}`);

    // Generate normal PNG
    try {
        const pngPath = await gen.generateAvatar('debug-avatar');
        console.log(`Generated PNG to ${pngPath}`);
    } catch (e) {
        console.error("Failed to generate PNG:", e);
    }
}

main().catch(console.error);
