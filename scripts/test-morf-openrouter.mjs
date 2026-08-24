import 'dotenv/config';
import { OpenRouter } from '@openrouter/sdk';

const apiKey =
  process.env.MORF_AI_OPENROUTER_API_KEY ||
  process.env.OPENROUTER_API_KEY;

if (!apiKey) {
  console.log('Morf AI pendiente de activación.');
  process.exit(1);
}

const client = new OpenRouter({
  apiKey,
  httpReferer: 'https://auth.allsender.tech',
  appTitle: 'AllSender Morf AI',
});

try {
  const response = await client.chat.send({
    chatRequest: {
      model: 'openrouter/auto',
      messages: [
        {
          role: 'user',
          content: 'Responde exactamente: Morf AI operativo.',
        },
      ],
      maxTokens: 30,
      temperature: 0.2,
    },
  });

  const text =
    response?.choices?.[0]?.message?.content ||
    response?.choices?.[0]?.delta?.content ||
    '';

  console.log('OK:', text || 'Morf AI respondió correctamente.');
} catch (error) {
  console.log('Morf AI no pudo responder ahora.');
  console.log(String(error?.message || error).slice(0, 800));
  process.exit(1);
}
