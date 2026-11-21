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

  app.post('/api/ai/blurt-review', async (req, res) => {
    const ai = getAiClient();
    if (!ai) {
      res.status(500).json({ error: 'Gemini API key is not configured on the server.' });
      return;
    }

    try {
      const { blurtText, referenceNotes, subjectName, chapterTitle } = req.body as {
        blurtText?: string;
        referenceNotes?: string;
        subjectName?: string;
        chapterTitle?: string;
      };

      const cleanBlurt = typeof blurtText === 'string' ? blurtText.trim() : '';
      const cleanRef = typeof referenceNotes === 'string' ? referenceNotes.trim() : '';

      if (cleanBlurt.length < 10) {
        res.status(400).json({ error: 'Write at least a few sentences in your blurt before requesting AI review.' });
        return;
      }
      if (cleanRef.length < 20) {
        res.status(400).json({ error: 'Please select chapter notes or upload/paste reference material (at least 20 chars).' });
        return;
      }

      const prompt = [
        `Subject: ${subjectName || 'General Study'}`,
        `Topic / Chapter: ${chapterTitle || 'Study Material'}`,
        'Compare the learner’s active-recall blurt written from memory against the reference notes below.',
        'Identify specific strong points they accurately recalled, specific weak points/gaps or inaccuracies, and missed key facts.',
        'Reference Material:\n' + cleanRef.slice(0, 28000),
        'Learner Blurt (written from memory):\n' + cleanBlurt.slice(0, 18000),
      ].join('\n\n');

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          systemInstruction:
            'You are a constructive study tutor evaluating active-recall blurting strictly against the provided reference notes. Be encouraging, specific, and accurate.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: {
                type: Type.STRING,
                description: '2-3 sentence summary comparing the learner blurt to the reference material.',
              },
              strongPoints: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: 'Concepts or facts the learner recalled accurately (3 to 8 items).',
              },
              weakPoints: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    topic: { type: Type.STRING, description: 'Short concept/subtopic name.' },
                    gap: { type: Type.STRING, description: 'What was missing, incomplete, or inaccurate.' },
                    suggestedReview: { type: Type.STRING, description: 'Concrete correction or key detail from notes.' },
                  },
                  required: ['topic', 'gap', 'suggestedReview'],
                },
                description: 'Weak points or missing areas needing review (2 to 8 items).',
              },
              missedKeyFacts: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: 'Specific facts, formulas, or terms omitted in the blurt (up to 8 items).',
              },
            },
            required: ['summary', 'strongPoints', 'weakPoints', 'missedKeyFacts'],
          },
        },
      });

      const rawJson = (response.text ?? '{}').trim();
      const parsed = JSON.parse(rawJson) as {
        summary?: string;
        strongPoints?: string[];
        weakPoints?: Array<{ topic: string; gap: string; suggestedReview: string }>;
        missedKeyFacts?: string[];
      };

      res.json({
        summary: typeof parsed.summary === 'string' ? parsed.summary.trim().slice(0, 1900) : '',
        strongPoints: Array.isArray(parsed.strongPoints)
          ? parsed.strongPoints
              .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
              .slice(0, 15)
              .map((s) => s.trim().slice(0, 550))
          : [],
        weakPoints: Array.isArray(parsed.weakPoints)
          ? parsed.weakPoints
              .filter((w) => w && typeof w.topic === 'string' && typeof w.gap === 'string')
              .slice(0, 15)
              .map((w) => ({
                topic: w.topic.trim().slice(0, 180),
                gap: w.gap.trim().slice(0, 950),
                suggestedReview: (typeof w.suggestedReview === 'string' ? w.suggestedReview : '').trim().slice(0, 950),
              }))
          : [],
        missedKeyFacts: Array.isArray(parsed.missedKeyFacts)
          ? parsed.missedKeyFacts
              .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
              .slice(0, 15)
              .map((s) => s.trim().slice(0, 550))
          : [],
      });
    } catch (error) {
      console.error('AI blurt review error:', error);
      const message = error instanceof Error ? error.message : 'Failed to review blurt.';
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/ai/weakpoint-flashcards', async (req, res) => {
    const ai = getAiClient();
    if (!ai) {
      res.status(500).json({ error: 'Gemini API key is not configured on the server.' });
      return;
    }

    try {
      const { weakPoints, missedKeyFacts, referenceNotes, subjectName, chapterTitle, cardCount } = req.body as {
        weakPoints?: Array<{ topic: string; gap: string; suggestedReview: string }>;
        missedKeyFacts?: string[];
        referenceNotes?: string;
        subjectName?: string;
        chapterTitle?: string;
        cardCount?: number;
      };

      const cleanWeakPoints = Array.isArray(weakPoints) ? weakPoints.slice(0, 15) : [];
      const cleanMissed = Array.isArray(missedKeyFacts) ? missedKeyFacts.slice(0, 15) : [];

      if (cleanWeakPoints.length === 0 && cleanMissed.length === 0) {
        res.status(400).json({ error: 'No weak points provided to generate flashcards from.' });
        return;
      }

      const targetCards = Math.min(Math.max(Number(cardCount) || 6, 2), 15);
      const prompt = [
        `Subject: ${subjectName || 'General Study'}`,
        `Chapter: ${chapterTitle || 'Blurting Review'}`,
        `Generate ${targetCards} targeted active-recall flashcards specifically addressing the learner's weak points and missed facts below.`,
        'Weak Points:\n' +
          cleanWeakPoints
            .map((w, i) => `${i + 1}. ${w.topic}: ${w.gap} (Correction: ${w.suggestedReview})`)
            .join('\n'),
        cleanMissed.length > 0 ? 'Missed Key Facts:\n- ' + cleanMissed.join('\n- ') : '',
        referenceNotes ? 'Reference Context:\n' + String(referenceNotes).slice(0, 12000) : '',
      ]
        .filter(Boolean)
        .join('\n\n');

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          systemInstruction:
            'Create crisp, high-yield flashcards targeting only the missed concepts and weak points. Keep fronts <= 200 chars and backs <= 500 chars.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              flashcards: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    front: { type: Type.STRING },
                    back: { type: Type.STRING },
                  },
                  required: ['front', 'back'],
                },
              },
            },
            required: ['flashcards'],
          },
        },
      });

      const rawJson = (response.text ?? '{}').trim();
      const parsed = JSON.parse(rawJson) as {
        flashcards?: Array<{ front: string; back: string }>;
      };

      res.json({
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
      console.error('AI weakpoint flashcard error:', error);
      const message = error instanceof Error ? error.message : 'Failed to generate weak-point flashcards.';
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
