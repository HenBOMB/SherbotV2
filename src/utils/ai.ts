import { aiService, ChatMessage } from "../features/mm/ai-service.js";
import { logger } from "./logger.js";

/**
 * Generate an initial profile for a user based on their messages.
 */
export async function generateProfile(messages: string[], userId: string): Promise<string> {
    if (messages.length === 0) return "No sufficient message history to generate a profile.";

    const input = messages.join("\n");

    try {
        const response = await aiService.chatCompletion([
            {
                role: 'system',
                content: 'You are an expert behavioral analyst. Based on a collection of Discord messages from a user, generate a concise profile. Focus on: \n1. Communication style (e.g., formal, casual, technical, helpful).\n2. Main interests or topics they discuss.\n3. Notable personality traits or recurring themes.\nKeep the profile under 150 words.'
            },
            { role: 'user', content: `Here are the messages:\n\n${input}` }
        ], {
            temperature: 0.7,
            max_tokens: 300,
            suspectId: userId,
            caseId: 'system_profiler'
        });

        return response.content?.trim() || "Failed to generate profile.";
    } catch (error) {
        logger.error("Error generating AI profile:", error);
        return "Profile generation unavailable.";
    }
}

/**
 * Refine an existing profile with new messages.
 */
export async function refineProfile(existingProfile: string, newMessages: string[], userId: string): Promise<string> {
    if (newMessages.length === 0) return existingProfile;

    const input = newMessages.join("\n");

    try {
        const response = await aiService.chatCompletion([
            {
                role: 'system',
                content: `You are an expert behavioral analyst. Update an existing user profile with new message data. 
Maintain the core characteristics but update interests, communication style, or recurring themes based on the new activity. 
If new data contradicts or expands on the old profile, adjust accordingly. 
Keep the final profile concise (under 200 words).

Existing Profile:
${existingProfile}`
            },
            { role: 'user', content: `New messages for analysis:\n\n${input}` }
        ], {
            temperature: 0.7,
            max_tokens: 400,
            suspectId: userId,
            caseId: 'system_profiler'
        });

        return response.content?.trim() || existingProfile;
    } catch (error) {
        logger.error("Error refining AI profile:", error);
        return existingProfile;
    }
}

/**
 * Translate a tip image content to a target language.
 */
export async function translateTip(imageUrl: string, targetLanguage: string): Promise<string> {
    try {
        const response = await aiService.chatCompletion([
            {
                role: 'system',
                content: `You are an expert translator. You will be provided with an image containing a detective tip or piece of advice. 
                Your task is to:
                1. Extract the text from the image.
                2. Translate that text into ${targetLanguage}.
                3. Maintain the tone and style of the original advice.
                Return ONLY the translated text. No commentary.`
            },
            {
                role: 'user',
                content: [
                    { type: "image_url", image_url: { url: imageUrl } }
                ] as any
            }
        ], {
            temperature: 0.3,
            max_tokens: 500
        });

        return response.content?.trim() || "Translation failed.";
    } catch (error) {
        logger.error(`Error translating tip at ${imageUrl}:`, error);
        return "Translation unavailable.";
    }
}
