import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;

function getAiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.post('/api/ai/flashcards', async (req, res) => {
    const ai = getAiClient();
    if (!ai) {
      res.status(500).json({ error: 'Gemini API key is not configured on the server.' });
      return;
    }

    try {
      const { extractedText, subjectName, chapterTitle, cardCount } = req.body as {
        extractedText?: string;
        subjectName?: string;
        chapterTitle?: string;
        cardCount?: number;
      };

      const cleanedText = typeof extractedText === 'string' ? extractedText.trim() : '';
      if (cleanedText.length < 30) {
        res.status(400).json({ error: 'Please provide at least 30 characters of extracted study material.' });
        return;
      }

      const targetCards = Math.min(Math.max(Number(cardCount) || 8, 3), 20);
      const boundedText = cleanedText.slice(0, 28000);

      const prompt = [
        `Subject: ${subjectName || 'General Study'}`,
        `Chapter: ${chapterTitle || 'Study Material'}`,
        `Generate concise, high-yield structured study notes AND ${targetCards} active-recall flashcards from the following extracted study material.`,
        'Each flashcard front should ask a clear, specific question or concept prompt (<= 200 chars), and the back should give an accurate, memorable answer (<= 500 chars).',
        'Study Material:',
        boundedText,
      ].join('\n\n');

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          systemInstruction:
            'You are an expert curriculum designer creating clear study notes and spaced-repetition flashcards strictly grounded in the provided study text.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summaryNotes: {
                type: Type.STRING,
                description: 'Well-organized study notes summarizing key definitions, concepts, and takeaways in clean plain text / markdown bullets.',
              },
              flashcards: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    front: {
                      type: Type.STRING,
                      description: 'The question or concept prompt on the front of the flashcard.',
                    },
                    back: {
                      type: Type.STRING,
                      description: 'The concise, accurate answer on the back of the flashcard.',
                    },
                  },
                  required: ['front', 'back'],
                },
              },
            },
            required: ['summaryNotes', 'flashcards'],
          },
        },
      });

      const rawJson = (response.text ?? '{}').trim();
      const parsed = JSON.parse(rawJson) as {
        summaryNotes?: string;
        flashcards?: Array<{ front: string; back: string }>;
      };

      res.json({
        summaryNotes: typeof parsed.summaryNotes === 'string' ? parsed.summaryNotes : '',
        flashcards: Array.isArray(parsed.flashcards)
          ? parsed.flashcards
              .filter((c) => c && typeof c.front === 'string' && typeof c.back === 'string')
              .map((c) => ({
                front: c.front.trim().slice(0, 950),
                back: c.back.trim().slice(0, 1950),
              }))
          : [],
      });
    } catch (error) {
      console.error('AI flashcard generation error:', error);
      const message = error instanceof Error ? error.message : 'Failed to generate flashcards.';
      res.status(500).json({ error: message });
    }
  });

  const httpServer = http.createServer(app);

  if (process.env.NODE_ENV !== 'production') {
    const viteModule = await import('vite');
    const vite = await viteModule.createServer({
      server: {
        middlewareMode: true,
        hmr: false,
        ws: { server: httpServer },
        allowedHosts: true,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found. Run npm run build first.');
      }
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Pencil server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
