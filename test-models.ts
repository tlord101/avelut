import { GoogleGenAI } from "@google/genai";

async function main() {
    const ai = new GoogleGenAI({ apiKey: process.env.VITE_GEMINI_API_KEY });
    try {
        const response = await ai.models.list();
        for (const model of response) {
            console.log(model.name);
        }
    } catch (e: any) {
        console.error("ERROR:", e);
    }
}
main();
