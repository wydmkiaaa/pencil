import React, { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  ExternalLink,
  FileText,
  Layers,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  Video,
} from 'lucide-react';
import { extractPdfTextInBrowser } from '../lib/pdfExtract';
import {
  createChapter,
  createFlashcardsBatch,
  createSubject,
  deleteChapter,
  deleteFlashcard,
  deleteSubject,
  updateChapterNotesAndPdfs,
  updateChapterVideos,
} from '../lib/studyRepo';
import { PastelSelect } from './PastelSelect';
import {
  BLUEPRINT_LIMITS,
  SUBJECT_COLOR_PALETTE,
  type Chapter,
  type Flashcard,
  type PdfSourceMeta,
  type Subject,
  type VideoLecture,
} from '../types/study';

interface SyllabusViewProps {
  uid: string;
  subjects: Subject[];
  chapters: Chapter[];
  flashcards: Flashcard[];
}

function extractYouTubeEmbedUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtube.com')) {
      const v = u.searchParams.get('v');
      return v ? `https://www.youtube.com/embed/${v}` : null;
    }
    if (u.hostname === 'youtu.be') {
      const id = u.pathname.replace('/', '');
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }
    return null;
  } catch {
    return null;
  }
}

export const SyllabusView: React.FC<SyllabusViewProps> = ({
  uid,
  subjects,
  chapters,
  flashcards,
}) => {
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>('');
  const [selectedChapterId, setSelectedChapterId] = useState<string>('');

  // Create Subject form
  const [showAddSubject, setShowAddSubject] = useState(false);
  const [subjName, setSubjName] = useState('');
  const [subjColor, setSubjColor] = useState(SUBJECT_COLOR_PALETTE[1].hex);
  const [subjDesc, setSubjDesc] = useState('');

  // Create Chapter form
  const [chapterTitle, setChapterTitle] = useState('');

  // Chapter workspace state
  const [notesDraft, setNotesDraft] = useState('');
  const [notesDirty, setNotesDirty] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);

  // Video lectures
  const [videoTitle, setVideoTitle] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(null);

  // PDF.js client-side extraction + AI flashcard/notes generation
  const [pdfStatus, setPdfStatus] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [extractedPayload, setExtractedPayload] = useState<{
    fileName: string;
    pageCount: number;
    text: string;
  } | null>(null);
  const [generatingAi, setGeneratingAi] = useState(false);
  const [cardCount, setCardCount] = useState(8);

  // Manual flashcard form
  const [manualFront, setManualFront] = useState('');
  const [manualBack, setManualBack] = useState('');

  useEffect(() => {
    if (!selectedSubjectId && subjects.length > 0) {
      setSelectedSubjectId(subjects[0].id);
    } else if (selectedSubjectId && !subjects.some((s) => s.id === selectedSubjectId)) {
      setSelectedSubjectId(subjects[0]?.id || '');
    }
  }, [subjects, selectedSubjectId]);

  const subjectChapters = useMemo(
    () => chapters.filter((c) => c.subjectId === selectedSubjectId).sort((a, b) => a.order - b.order),
    [chapters, selectedSubjectId],
  );

  useEffect(() => {
    if (subjectChapters.length > 0 && !subjectChapters.some((c) => c.id === selectedChapterId)) {
      setSelectedChapterId(subjectChapters[0].id);
    } else if (subjectChapters.length === 0) {
      setSelectedChapterId('');
    }
  }, [subjectChapters, selectedChapterId]);

  const activeSubject = subjects.find((s) => s.id === selectedSubjectId) || null;
  const activeChapter = subjectChapters.find((c) => c.id === selectedChapterId) || null;

  useEffect(() => {
    if (activeChapter) {
      setNotesDraft(activeChapter.notes || '');
      setNotesDirty(false);
      setPreviewVideoUrl(null);
      setExtractedPayload(null);
      setPdfStatus(null);
      setPdfError(null);
    } else {
      setNotesDraft('');
      setNotesDirty(false);
    }
  }, [activeChapter?.id]);

  const chapterFlashcards = useMemo(
    () => flashcards.filter((f) => f.chapterId === selectedChapterId),
    [flashcards, selectedChapterId],
  );

  const handleCreateSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subjName.trim()) return;
    const newId = await createSubject(uid, {
      name: subjName,
      color: subjColor,
      description: subjDesc,
    });
    setSubjName('');
    setSubjDesc('');
    setShowAddSubject(false);
    setSelectedSubjectId(newId);
  };

  const handleCreateChapter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSubjectId || !chapterTitle.trim()) return;
    const nextOrder = subjectChapters.length + 1;
    const newId = await createChapter(uid, {
      subjectId: selectedSubjectId,
      title: chapterTitle,
      order: nextOrder,
    });
    setChapterTitle('');
    setSelectedChapterId(newId);
  };

  const handleSaveNotes = async () => {
    if (!activeChapter) return;
    setSavingNotes(true);
    try {
      await updateChapterNotesAndPdfs(uid, activeChapter.id, notesDraft, activeChapter.pdfSources || []);
      setNotesDirty(false);
    } finally {
      setSavingNotes(false);
    }
  };

  const handleAddVideo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeChapter || !videoTitle.trim() || !videoUrl.trim()) return;
    const nextList: VideoLecture[] = [
      ...(activeChapter.videoLectures || []),
      { title: videoTitle.trim(), url: videoUrl.trim() },
    ];
    await updateChapterVideos(uid, activeChapter.id, nextList);
    setVideoTitle('');
    setVideoUrl('');
  };

  const handleRemoveVideo = async (index: number) => {
    if (!activeChapter) return;
    const nextList = (activeChapter.videoLectures || []).filter((_, idx) => idx !== index);
    await updateChapterVideos(uid, activeChapter.id, nextList);
  };

  const handlePdfSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setPdfError(null);
    setPdfStatus('Reading PDF locally in browser...');
    try {
      const result = await extractPdfTextInBrowser(file, (page, total) => {
        setPdfStatus(`Extracting text locally: page ${page} of ${total}...`);
      });
      if (result.text.length < 30) {
        setPdfError('Could not extract readable text from this PDF (it may be a scanned image PDF).');
        setPdfStatus(null);
        return;
      }
      setExtractedPayload(result);
      setPdfStatus(
        `Extracted ${result.pageCount} pages (${result.text.length.toLocaleString()} chars) in browser. Ready to generate notes & flashcards.`,
      );
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : 'Failed to extract PDF text.');
      setPdfStatus(null);
    }
  };

  const handleGenerateFromPdf = async () => {
    if (!activeChapter || !activeSubject || !extractedPayload) return;
    setPdfError(null);
    setGeneratingAi(true);
    try {
      const res = await fetch('/api/ai/flashcards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          extractedText: extractedPayload.text,
          subjectName: activeSubject.name,
          chapterTitle: activeChapter.title,
          cardCount,
        }),
      });
      const data = (await res.json()) as {
        summaryNotes?: string;
        flashcards?: Array<{ front: string; back: string }>;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || 'Failed to generate study material.');
      }

      const appendedNotes = [
        notesDraft.trim(),
        data.summaryNotes
          ? `--- Notes from ${extractedPayload.fileName} ---\n${data.summaryNotes.trim()}`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n')
        .slice(0, BLUEPRINT_LIMITS.CHAPTER_NOTES_MAX);

      const nextPdfMeta: PdfSourceMeta[] = [
        ...(activeChapter.pdfSources || []).slice(-9),
        {
          fileName: extractedPayload.fileName,
          pageCount: extractedPayload.pageCount,
          extractedAt: new Date().toISOString(),
        },
      ];

      await updateChapterNotesAndPdfs(uid, activeChapter.id, appendedNotes, nextPdfMeta);
      setNotesDraft(appendedNotes);
      setNotesDirty(false);

      if (data.flashcards && data.flashcards.length > 0) {
        await createFlashcardsBatch(uid, activeSubject.id, activeChapter.id, data.flashcards);
      }

      setPdfStatus(
        `Saved generated notes and ${data.flashcards?.length ?? 0} flashcards to Firestore (raw PDF not uploaded).`,
      );
      setExtractedPayload(null);
    } catch (err) {
      setPdfError(err instanceof Error ? err.message : 'Generation failed.');
    } finally {
      setGeneratingAi(false);
    }
  };

  const handleAddManualCard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSubject || !activeChapter || !manualFront.trim() || !manualBack.trim()) return;
    await createFlashcardsBatch(uid, activeSubject.id, activeChapter.id, [
      { front: manualFront.trim(), back: manualBack.trim() },
    ]);
    setManualFront('');
    setManualBack('');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Syllabus &amp; Material</h1>
          <p className="text-sm text-[var(--pastel-muted)]">
            Color-code your subjects, organize chapters, attach video lectures, and turn local PDFs into notes and flashcards.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowAddSubject((prev) => !prev)}
          className="px-4 py-2 rounded-full bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)] text-xs font-bold hover:opacity-90 flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>{showAddSubject ? 'Close' : 'New Subject'}</span>
        </button>
      </div>

      {showAddSubject && (
        <form
          onSubmit={handleCreateSubject}
          className="bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl p-6 space-y-4"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input
              type="text"
              required
              value={subjName}
              onChange={(e) => setSubjName(e.target.value)}
              placeholder="Subject name (e.g., Cell Biology)"
              maxLength={100}
              className="px-4 py-2 text-sm rounded-2xl border border-[var(--pastel-border)] bg-[var(--pastel-canvas)] focus:outline-none"
            />
            <input
              type="text"
              value={subjDesc}
              onChange={(e) => setSubjDesc(e.target.value)}
              placeholder="Short syllabus goal or course code (optional)"
              maxLength={400}
              className="px-4 py-2 text-sm rounded-2xl border border-[var(--pastel-border)] bg-[var(--pastel-canvas)] focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-[var(--pastel-muted)] mr-1">Color code:</span>
              {SUBJECT_COLOR_PALETTE.map((swatch) => (
                <button
                  key={swatch.hex}
                  type="button"
                  onClick={() => setSubjColor(swatch.hex)}
                  aria-label={swatch.name}
                  className={`w-6 h-6 rounded-full cursor-pointer transition-transform ${
                    subjColor === swatch.hex ? 'ring-2 ring-offset-2 ring-[var(--pastel-ink)] scale-110' : ''
                  }`}
                  style={{ backgroundColor: swatch.hex }}
                />
              ))}
              <input
                type="color"
                value={subjColor}
                onChange={(e) => setSubjColor(e.target.value)}
                aria-label="Custom subject color"
                className="w-7 h-7 rounded-full cursor-pointer border-0 bg-transparent"
              />
            </div>

            <button
              type="submit"
              className="px-5 py-2 rounded-full bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)] text-xs font-bold cursor-pointer"
            >
              Save Subject
            </button>
          </div>
        </form>
      )}

      {/* Subject Selector Strip */}
      {subjects.length === 0 ? (
        <div className="bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl p-10 text-center space-y-3">
          <BookOpen className="w-6 h-6 mx-auto text-[var(--pastel-muted)]" />
          <p className="text-sm font-bold">Create your first color-coded subject</p>
          <p className="text-xs text-[var(--pastel-muted)] max-w-md mx-auto">
            Add subjects like Mathematics, Literature, or Biology to organize chapters, video lectures, notes, and flashcards.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Subjects + Chapters */}
          <aside className="lg:col-span-4 space-y-6">
            <div className="bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl p-5 space-y-2">
              <div className="text-xs font-bold text-[var(--pastel-muted)] px-2 pb-1">
                Subjects ({subjects.length})
              </div>
              {subjects.map((s) => {
                const active = s.id === selectedSubjectId;
                return (
                  <div
                    key={s.id}
                    className={`flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-2xl transition-colors ${
                      active ? 'bg-[var(--pastel-soft)]' : 'hover:bg-[var(--pastel-canvas)]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedSubjectId(s.id)}
                      className="flex items-center gap-2.5 text-left min-w-0 flex-1 cursor-pointer"
                    >
                      <span
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ backgroundColor: s.color }}
                      />
                      <span className="text-sm font-semibold truncate">{s.name}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteSubject(uid, s.id)}
                      aria-label={`Delete ${s.name}`}
                      className="p-1 text-[var(--pastel-muted)] hover:text-red-600 cursor-pointer shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>

            {activeSubject && (
              <div className="bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl p-5 space-y-3">
                <div className="flex items-center justify-between px-1">
                  <span className="text-xs font-bold text-[var(--pastel-muted)]">
                    Chapters · {activeSubject.name}
                  </span>
                </div>

                <form onSubmit={handleCreateChapter} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={chapterTitle}
                    onChange={(e) => setChapterTitle(e.target.value)}
                    placeholder="Add chapter..."
                    maxLength={160}
                    className="flex-1 px-4 py-2 text-xs rounded-2xl border border-[var(--pastel-border)] bg-[var(--pastel-canvas)] focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={!chapterTitle.trim()}
                    className="w-9 h-9 rounded-full bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)] flex items-center justify-center cursor-pointer disabled:opacity-40 shrink-0"
                    aria-label="Add chapter"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </form>

                <div className="space-y-1">
                  {subjectChapters.length === 0 ? (
                    <p className="py-4 text-xs text-[var(--pastel-muted)] text-center">
                      No chapters yet.
                    </p>
                  ) : (
                    subjectChapters.map((ch, idx) => (
                      <div
                        key={ch.id}
                        className={`py-2.5 px-3.5 flex items-center justify-between gap-2 rounded-2xl transition-colors ${
                          ch.id === selectedChapterId ? 'bg-[var(--pastel-soft)]' : 'hover:bg-[var(--pastel-canvas)]'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => setSelectedChapterId(ch.id)}
                          className="text-left min-w-0 flex-1 cursor-pointer"
                        >
                          <div className="text-xs font-semibold truncate">
                            {String(idx + 1).padStart(2, '0')}. {ch.title}
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteChapter(uid, ch.id)}
                          aria-label={`Delete ${ch.title}`}
                          className="p-1 text-[var(--pastel-muted)] hover:text-red-600 cursor-pointer shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </aside>

          {/* Right Column: Chapter Workspace */}
          <main className="lg:col-span-8 space-y-6">
            {!activeChapter ? (
              <div className="bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl p-10 text-center space-y-2">
                <p className="text-sm font-bold">Select or add a chapter</p>
                <p className="text-xs text-[var(--pastel-muted)]">
                  Each chapter stores your notes, lecture videos, and flashcards generated from local PDFs.
                </p>
              </div>
            ) : (
              <>
                {/* Chapter Notes & PDF.js Extraction */}
                <section className="bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl p-6 space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-xs text-[var(--pastel-muted)] flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: activeSubject?.color }}
                        />
                        <span>{activeSubject?.name}</span>
                      </div>
                      <h2 className="text-xl font-extrabold tracking-tight">{activeChapter.title}</h2>
                    </div>

                    <button
                      type="button"
                      disabled={!notesDirty || savingNotes}
                      onClick={() => void handleSaveNotes()}
                      className="px-4 py-2 rounded-full bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)] text-xs font-bold hover:opacity-90 cursor-pointer disabled:opacity-45"
                    >
                      {savingNotes ? 'Saving...' : notesDirty ? 'Save Notes' : 'Notes Saved'}
                    </button>
                  </div>

                  {/* PDF.js Local Extraction Bar */}
                  <div className="p-4 rounded-2xl bg-[var(--pastel-canvas)] border border-[var(--pastel-border)] space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="space-y-0.5">
                        <div className="text-xs font-semibold flex items-center gap-1.5">
                          <FileText className="w-3.5 h-3.5 text-[var(--pastel-muted)]" />
                          <span>PDF Study Material (Client-Side Extraction)</span>
                        </div>
                        <p className="text-[11px] text-[var(--pastel-muted)]">
                          Text is extracted locally in your browser with PDF.js. Only generated notes &amp; flashcards are saved.
                        </p>
                      </div>

                      <label className="px-4 py-2 rounded-full border border-[var(--pastel-border)] bg-[var(--pastel-surface)] hover:bg-[var(--pastel-soft)] text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap">
                        <Upload className="w-3.5 h-3.5" />
                        <span>Select PDF</span>
                        <input
                          type="file"
                          accept="application/pdf,.pdf"
                          onChange={(e) => void handlePdfSelected(e)}
                          className="hidden"
                        />
                      </label>
                    </div>

                    {pdfStatus && (
                      <p className="text-xs text-[var(--pastel-ink)]">{pdfStatus}</p>
                    )}
                    {pdfError && (
                      <p className="text-xs text-red-700">{pdfError}</p>
                    )}

                    {extractedPayload && (
                      <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[var(--pastel-border)]">
                        <div className="flex items-center gap-2 text-xs text-[var(--pastel-muted)]">
                          <span>Flashcards to generate:</span>
                          <PastelSelect
                            value={String(cardCount)}
                            onChange={(val) => setCardCount(Number(val))}
                            ariaLabel="Number of flashcards to generate"
                            variant="pill"
                            className="min-w-[100px]"
                            options={[5, 8, 12, 16].map((n) => ({
                              value: String(n),
                              label: `${n} cards`,
                            }))}
                          />
                        </div>

                        <button
                          type="button"
                          disabled={generatingAi}
                          onClick={() => void handleGenerateFromPdf()}
                          className="px-4 py-2 rounded-full bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)] text-xs font-bold hover:opacity-90 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>
                            {generatingAi ? 'Generating Notes & Flashcards...' : 'Generate Notes & Flashcards'}
                          </span>
                        </button>
                      </div>
                    )}

                    {(activeChapter.pdfSources || []).length > 0 && (
                      <div className="text-[11px] text-[var(--pastel-muted)] pt-1">
                        Processed PDFs:{' '}
                        {(activeChapter.pdfSources || [])
                          .map((p) => `${p.fileName} (${p.pageCount}p)`)
                          .join(' · ')}
                      </div>
                    )}
                  </div>

                  {/* Notes Editor */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--pastel-muted)]">
                      Chapter Notes
                    </label>
                    <textarea
                      rows={9}
                      value={notesDraft}
                      onChange={(e) => {
                        setNotesDraft(e.target.value);
                        setNotesDirty(true);
                      }}
                      placeholder="Write chapter summaries, formulas, or key definitions here..."
                      className="w-full p-4 text-sm leading-relaxed rounded-2xl border border-[var(--pastel-border)] bg-[var(--pastel-canvas)] focus:outline-none resize-y"
                    />
                  </div>
                </section>

                {/* Video Lectures */}
                <section className="bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl p-6 space-y-4">
                  <div className="flex items-center gap-2">
                    <Video className="w-4 h-4 text-[var(--pastel-muted)]" />
                    <h3 className="text-base font-extrabold tracking-tight">Video Lectures</h3>
                  </div>

                  <form onSubmit={handleAddVideo} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2.5">
                    <input
                      type="text"
                      required
                      value={videoTitle}
                      onChange={(e) => setVideoTitle(e.target.value)}
                      placeholder="Lecture title"
                      maxLength={160}
                      className="px-4 py-2.5 text-xs rounded-2xl border border-[var(--pastel-border)] bg-[var(--pastel-canvas)] focus:outline-none"
                    />
                    <input
                      type="url"
                      required
                      value={videoUrl}
                      onChange={(e) => setVideoUrl(e.target.value)}
                      placeholder="https://youtube.com/watch?v=..."
                      maxLength={500}
                      className="px-4 py-2.5 text-xs rounded-2xl border border-[var(--pastel-border)] bg-[var(--pastel-canvas)] focus:outline-none"
                    />
                    <button
                      type="submit"
                      className="py-2.5 px-5 rounded-full bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)] text-xs font-bold cursor-pointer whitespace-nowrap"
                    >
                      Attach
                    </button>
                  </form>

                  {(activeChapter.videoLectures || []).length > 0 && (
                    <div className="divide-y divide-[var(--pastel-border)]">
                      {(activeChapter.videoLectures || []).map((vid, idx) => {
                        const embed = extractYouTubeEmbedUrl(vid.url);
                        return (
                          <div key={`${vid.url}-${idx}`} className="py-2.5 flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-sm font-semibold truncate">{vid.title}</div>
                              <div className="text-xs text-[var(--pastel-muted)] truncate">{vid.url}</div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {embed && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setPreviewVideoUrl((prev) => (prev === embed ? null : embed))
                                  }
                                  className="px-3 py-1 rounded-full border border-[var(--pastel-border)] text-xs font-semibold hover:bg-[var(--pastel-soft)] cursor-pointer"
                                >
                                  {previewVideoUrl === embed ? 'Hide' : 'Watch'}
                                </button>
                              )}
                              <a
                                href={vid.url}
                                target="_blank"
                                rel="noreferrer"
                                className="p-1.5 text-[var(--pastel-muted)] hover:text-[var(--pastel-ink)]"
                                aria-label="Open lecture link"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                              </a>
                              <button
                                type="button"
                                onClick={() => void handleRemoveVideo(idx)}
                                aria-label="Remove video lecture"
                                className="p-1.5 text-[var(--pastel-muted)] hover:text-red-600 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {previewVideoUrl && (
                    <div className="aspect-video rounded-2xl overflow-hidden border border-[var(--pastel-border)] bg-black">
                      <iframe
                        src={previewVideoUrl}
                        title="Lecture Video Player"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                        className="w-full h-full"
                      />
                    </div>
                  )}
                </section>

                {/* Chapter Flashcards */}
                <section className="bg-[var(--pastel-surface)] border border-[var(--pastel-border)] rounded-3xl p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Layers className="w-4 h-4 text-[var(--pastel-muted)]" />
                      <h3 className="text-base font-extrabold tracking-tight">
                        Chapter Flashcards ({chapterFlashcards.length})
                      </h3>
                    </div>
                  </div>

                  <form onSubmit={handleAddManualCard} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2.5">
                    <input
                      type="text"
                      required
                      value={manualFront}
                      onChange={(e) => setManualFront(e.target.value)}
                      placeholder="Front (Question / Concept)"
                      maxLength={1000}
                      className="px-4 py-2.5 text-xs rounded-2xl border border-[var(--pastel-border)] bg-[var(--pastel-canvas)] focus:outline-none"
                    />
                    <input
                      type="text"
                      required
                      value={manualBack}
                      onChange={(e) => setManualBack(e.target.value)}
                      placeholder="Back (Answer / Definition)"
                      maxLength={2000}
                      className="px-4 py-2.5 text-xs rounded-2xl border border-[var(--pastel-border)] bg-[var(--pastel-canvas)] focus:outline-none"
                    />
                    <button
                      type="submit"
                      className="py-2.5 px-5 rounded-full bg-[var(--pastel-accent)] text-[var(--pastel-accent-ink)] text-xs font-bold cursor-pointer whitespace-nowrap"
                    >
                      Add Card
                    </button>
                  </form>

                  {chapterFlashcards.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {chapterFlashcards.map((card) => (
                        <div
                          key={card.id}
                          className="p-4 rounded-2xl border border-[var(--pastel-border)] bg-[var(--pastel-canvas)] space-y-1.5 flex flex-col justify-between"
                        >
                          <div className="space-y-1">
                            <div className="text-xs font-bold">{card.front}</div>
                            <div className="text-xs text-[var(--pastel-muted)] leading-relaxed">
                              {card.back}
                            </div>
                          </div>
                          <div className="flex items-center justify-between pt-2 text-[11px] text-[var(--pastel-muted)]">
                            <span className="font-mono-tabular">
                              Interval: {card.intervalDays}d · Ease {card.easeFactor}
                            </span>
                            <button
                              type="button"
                              onClick={() => void deleteFlashcard(uid, card.id)}
                              aria-label="Delete flashcard"
                              className="hover:text-red-600 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </>
            )}
          </main>
        </div>
      )}
    </div>
  );
};
