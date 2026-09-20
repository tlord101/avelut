import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';

const grok = createOpenAI({
  baseURL: 'https://api.x.ai/v1',
  apiKey: "test",
});

async function main() {
    try {
        await generateText({
            model: grok('grok-realtime'),
            prompt: 'Hi'
        });
    } catch(e) {
        console.log(e.message);
    }
}
main();
