import { GoogleGenAI } from "@google/genai";

async function main() {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    try {
        const response = await ai.models.embedContent({
            model: 'text-embedding-004',
            contents: 'What is the meaning of life?',
        });
        console.log("text-embedding-004 SUCCESS");
    } catch (e: any) {
        console.error("text-embedding-004 ERROR:", e.message);
    }
}
main();
