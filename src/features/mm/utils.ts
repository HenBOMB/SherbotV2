/**
 * Parse a time string (HH:MM or HH:MM:SS) into total minutes.
 * Handles ranges by taking the start time and handles seconds as fractions.
 * 
 * @param time - The time string to parse (e.g., "03:30", "03:35-03:40", "03:35:15")
 * @returns Total minutes as a number
 */
export function parseTimeToMinutes(time: string): number {
    const match = time.match(/(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
    if (!match) return 0;

    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const seconds = match[3] ? parseInt(match[3], 10) : 0;

    return hours * 60 + minutes + (seconds / 60);
}
