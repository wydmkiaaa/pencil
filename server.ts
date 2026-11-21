import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

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
      timeout: 20000,
      retryOptions: {
        attempts: 1,
      },
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function extractReadableAiError(err: unknown): { status: number; message: string; transient: boolean } {
  const raw = err instanceof Error ? err.message : String(err);
  let status = 500;
  let message = raw || 'AI request failed.';

  // Try parsing JSON payloads embedded in SDK errors
  try {
    const parsed = JSON.parse(raw) as { error?: { code?: number; message?: string; status?: string } };
    if (parsed?.error) {
      if (typeof parsed.error.code === 'number') status = parsed.error.code;
      if (typeof parsed.error.message === 'string') message = parsed.error.message;
    }
  } catch {
    const codeMatch = raw.match(/\b(400|401|403|404|429|500|502|503|504)\b/);
    if (codeMatch) status = Number(codeMatch[1]);
  }

  const lower = `${raw} ${message}`.toLowerCase();
  const isTimeout =
    (err instanceof Error && err.name === 'AbortError') ||
    lower.includes('aborted') ||
    lower.includes('timeout') ||
    lower.includes('timed out');

  if (isTimeout && status === 500) {
    status = 504;
    message = 'The AI model took too long to respond.';
  }

  const transient =
    isTimeout ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    lower.includes('unavailable') ||
    lower.includes('high demand') ||
    lower.includes('overloaded') ||
    lower.includes('resource_exhausted') ||
    lower.includes('try again');

  return { status, message, transient };
}

function parseJsonResponse<T>(rawText: string | undefined): T {
  let text = (rawText ?? '').trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  }
  return JSON.parse(text || '{}') as T;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let primaryCooldownUntil = 0;

async function generateJsonWithFallback<T>(
  ai: GoogleGenAI,
  params: {
    contents: string;
    systemInstruction: string;
    responseSchema: Record<string, unknown>;
  },
): Promise<T> {
  const skipPrimary = Date.now() < primaryCooldownUntil;
  const attempts: Array<{ model: string; useLowThinking: boolean; delayMs: number }> = [
    ...(skipPrimary
      ? []
      : [{ model: 'gemini-4-hydrogen', useLowThinking: true, delayMs: 0 }]),
    { model: 'gemini-3.1-flash-lite', useLowThinking: false, delayMs: 0 },
    { model: 'gemini-3.1-flash-lite', useLowThinking: false, delayMs: 700 },
  ];

  let lastError: unknown = null;

  for (const attempt of attempts) {
    if (attempt.delayMs > 0) {
      await sleep(attempt.delayMs);
    }
    try {
      const response = await ai.models.generateContent({
        model: attempt.model,
        contents: params.contents,
        config: {
          systemInstruction: params.systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: params.responseSchema,
          maxOutputTokens: 2048,
          ...(attempt.useLowThinking
            ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
            : {}),
        },
      });
      return parseJsonResponse<T>(response.text);
    } catch (err) {
      lastError = err;
      const info = extractReadableAiError(err);
      if (attempt.model === 'gemini-4-hydrogen' && (info.transient || info.status === 404)) {
        primaryCooldownUntil = Date.now() + 3 * 60_000;
      }
      // Do not retry non-transient auth/invalid-request errors on the same model
      if (!info.transient && info.status !== 404) {
        throw err;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('AI service is temporarily unavailable.');
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

      const parsed = await generateJsonWithFallback<{
        summaryNotes?: string;
        flashcards?: Array<{ front: string; back: string }>;
      }>(ai, {
        contents: prompt,
        systemInstruction:
          'You are an expert curriculum designer creating clear study notes and spaced-repetition flashcards strictly grounded in the provided study text.',
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
      });

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
      const info = extractReadableAiError(error);
      res.status(info.status >= 400 && info.status < 600 ? info.status : 500).json({
        error: info.message || 'Failed to generate flashcards.',
      });
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
        'Reference Material:\n' + cleanRef.slice(0, 18000),
        'Learner Blurt (written from memory):\n' + cleanBlurt.slice(0, 12000),
      ].join('\n\n');

      const parsed = await generateJsonWithFallback<{
        summary?: string;
        strongPoints?: string[];
        weakPoints?: Array<{ topic: string; gap: string; suggestedReview: string }>;
        missedKeyFacts?: string[];
      }>(ai, {
        contents: prompt,
        systemInstruction:
          'You are a constructive study tutor evaluating active-recall blurting strictly against the provided reference notes. Be encouraging, specific, and accurate.',
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
      });

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
      const info = extractReadableAiError(error);
      res.status(info.status >= 400 && info.status < 600 ? info.status : 500).json({
        error: info.message || 'Failed to review blurt.',
      });
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

      const parsed = await generateJsonWithFallback<{
        flashcards?: Array<{ front: string; back: string }>;
      }>(ai, {
        contents: prompt,
        systemInstruction:
          'Create crisp, high-yield flashcards targeting only the missed concepts and weak points. Keep fronts <= 200 chars and backs <= 500 chars.',
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
      });

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
      const info = extractReadableAiError(error);
      res.status(info.status >= 400 && info.status < 600 ? info.status : 500).json({
        error: info.message || 'Failed to generate weak-point flashcards.',
      });
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
