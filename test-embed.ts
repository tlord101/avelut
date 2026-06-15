import { GoogleGenAI } from "@google/genai";

async function main() {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    try {
        const response = await ai.models.embedContent({
            model: 'gemini-embedding-2',
            contents: 'What is the meaning of life?',
        });
        console.log("gemini-embedding-2 SUCCESS");
    } catch (e: any) {
        console.error("gemini-embedding-2 ERROR:", e.message);
    }
}
main();
