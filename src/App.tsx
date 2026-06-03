import React, { useState, useRef, useEffect, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
// Explicitly using the Vite way to load workers
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { PDFDocument } from 'pdf-lib';
import { UploadCloud, Scissors, Loader2, FileUp, Lock, Unlock } from 'lucide-react';
import { CropBox } from './components/CropBox';
import { cn } from './lib/utils';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

const PT_TO_MM = 25.4 / 72; // 1 PDF point in millimetres
const MM_TO_PT = 72 / 25.4; // 1 mm in PDF points

function ptToMm(pt: number) {
  return pt * PT_TO_MM;
}
function mmToPt(mm: number) {
  return mm * MM_TO_PT;
}
function fmt(mm: number) {
  return mm.toFixed(2);
}

interface MarginInputs {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [fileBuffer, setFileBuffer] = useState<ArrayBuffer | null>(null);
  const [combinedImageDataUrl, setCombinedImageDataUrl] = useState<string | null>(null);
  const [pdfDimensions, setPdfDimensions] = useState<{ width: number; height: number } | null>(null);
  const [numTotalPages, setNumTotalPages] = useState<number>(0);
  const [renderingProgress, setRenderingProgress] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const [cropBox, setCropBox] = useState<{ x: number; y: number; width: number; height: number }>({ x: 0, y: 0, width: 0, height: 0 });
  const [containerDimensions, setContainerDimensions] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Equal-crop state ──────────────────────────────────────────────────────
  const [margins, setMargins] = useState<MarginInputs>({ top: 0, bottom: 0, left: 0, right: 0 });
  const [lockEqual, setLockEqual] = useState(false);
  // When non-null, this drives CropBox from outside
  const [controlledBox, setControlledBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  // Prevents feedback loop: when we push a controlledBox in, the resulting
  // cropBox onChange must NOT overwrite the margin inputs
  const isControlledUpdate = useRef(false);

  // ─────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current && pdfDimensions) {
        const { clientWidth, clientHeight } = containerRef.current;
        const aspect = pdfDimensions.width / pdfDimensions.height;

        let width = clientWidth;
        let height = width / aspect;

        if (height > clientHeight) {
          height = clientHeight;
          width = height * aspect;
        }

        setContainerDimensions({ width, height });
      }
    };

    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, [pdfDimensions, combinedImageDataUrl]);

  // Reset margins when a new file is loaded
  useEffect(() => {
    if (combinedImageDataUrl) {
      setMargins({ top: 0, bottom: 0, left: 0, right: 0 });
      setControlledBox(null);
    }
  }, [combinedImageDataUrl]);

  // Sync margin inputs when the crop box is moved by dragging
  useEffect(() => {
    if (isControlledUpdate.current) {
      // This cropBox change came from our own input → don't overwrite inputs
      isControlledUpdate.current = false;
      return;
    }
    if (!pdfDimensions || !containerDimensions.width) return;
    const sf = pdfDimensions.width / containerDimensions.width;
    setMargins({
      left:   Math.max(0, ptToMm(cropBox.x * sf)),
      top:    Math.max(0, ptToMm(cropBox.y * sf)),
      right:  Math.max(0, ptToMm((containerDimensions.width  - cropBox.x - cropBox.width)  * sf)),
      bottom: Math.max(0, ptToMm((containerDimensions.height - cropBox.y - cropBox.height) * sf)),
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cropBox]);

  const processUploadedPDF = async (buffer: ArrayBuffer) => {
    setIsLoading(true);
    setRenderingProgress(0);
    setCombinedImageDataUrl(null);
    setNumTotalPages(0);

    try {
      const pdf = await pdfjsLib.getDocument({ data: buffer.slice(0) }).promise;
      const numPages = pdf.numPages;
      setNumTotalPages(numPages);

      // First page establishes dimensions
      const firstPage = await pdf.getPage(1);
      const baseViewport = firstPage.getViewport({ scale: 1.0 });
      setPdfDimensions({ width: baseViewport.width, height: baseViewport.height });

      const renderScale = 1.5;
      const viewport = firstPage.getViewport({ scale: renderScale });

      const combinedCanvas = document.createElement('canvas');
      combinedCanvas.width = viewport.width;
      combinedCanvas.height = viewport.height;
      const ctx = combinedCanvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;

      // White background base
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, combinedCanvas.width, combinedCanvas.height);

      // We will multiply pages on top. Adjust alpha dynamically so large PDFs
      // don't turn completely black, but stay dark enough for a single outline to show.
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = Math.max(0.05, 1 / Math.min(numPages, 10));

      const pageCanvas = document.createElement('canvas');
      pageCanvas.width = viewport.width;
      pageCanvas.height = viewport.height;
      const pageCtx = pageCanvas.getContext('2d', { willReadFrequently: true });
      if (!pageCtx) return;

      for (let i = 1; i <= numPages; i++) {
        const page = await pdf.getPage(i);

        // Ensure page canvas is cleared and has white background
        pageCtx.globalCompositeOperation = 'source-over';
        pageCtx.globalAlpha = 1.0;
        pageCtx.fillStyle = 'white';
        pageCtx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);

        const renderContext = {
          canvasContext: pageCtx,
          viewport: page.getViewport({ scale: renderScale }),
        };

        await page.render(renderContext).promise;

        ctx.drawImage(pageCanvas, 0, 0);

        setRenderingProgress(Math.round((i / numPages) * 100));
        // Quick yield to main thread to prevent UI freezing and allow progress bar rendering
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      // Save to a single JPEG data URL for memory-efficient DOM rendering
      setCombinedImageDataUrl(combinedCanvas.toDataURL('image/jpeg', 0.8));
    } catch (error) {
      console.error('Error rendering PDF:', error);
      alert('Failed to render PDF preview.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setFile(file);
    const buffer = await file.arrayBuffer();
    setFileBuffer(buffer);
    await processUploadedPDF(buffer);
  };

  const handleCrop = async () => {
    if (!fileBuffer || !pdfDimensions || !containerDimensions.width) return;

    setIsProcessing(true);
    try {
      const scaleFactor = pdfDimensions.width / containerDimensions.width;

      const pdfCropX = cropBox.x * scaleFactor;
      const pdfCropY = pdfDimensions.height - (cropBox.y + cropBox.height) * scaleFactor;
      const pdfCropWidth = cropBox.width * scaleFactor;
      const pdfCropHeight = cropBox.height * scaleFactor;

      const pdfDoc = await PDFDocument.load(fileBuffer.slice(0));
      const pages = pdfDoc.getPages();

      pages.forEach((page) => {
        page.setCropBox(pdfCropX, pdfCropY, pdfCropWidth, pdfCropHeight);
      });

      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);

      const downloadLink = document.createElement('a');
      downloadLink.href = url;
      downloadLink.download = `cropped_${file?.name || 'document.pdf'}`;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Failed to crop', e);
      alert('Failed to crop PDF.');
    } finally {
      setIsProcessing(false);
    }
  };

  // ── Equal-crop helpers ────────────────────────────────────────────────────

  /** Convert a margin value (in PDF points) to a pixel offset in the preview */
  const ptToPx = useCallback(
    (pt: number, axis: 'x' | 'y') => {
      if (!pdfDimensions || !containerDimensions.width) return 0;
      const scale =
        axis === 'x'
          ? containerDimensions.width / pdfDimensions.width
          : containerDimensions.height / pdfDimensions.height;
      return pt * scale;
    },
    [pdfDimensions, containerDimensions],
  );

  const applyMargins = useCallback(
    (m: MarginInputs) => {
      if (!containerDimensions.width || !containerDimensions.height) return;

      const leftPx   = ptToPx(mmToPt(m.left),   'x');
      const rightPx  = ptToPx(mmToPt(m.right),  'x');
      const topPx    = ptToPx(mmToPt(m.top),    'y');
      const bottomPx = ptToPx(mmToPt(m.bottom), 'y');

      const newBox = {
        x: leftPx,
        y: topPx,
        width: Math.max(10, containerDimensions.width - leftPx - rightPx),
        height: Math.max(10, containerDimensions.height - topPx - bottomPx),
      };
      isControlledUpdate.current = true;
      setControlledBox(newBox);
    },
    [ptToPx, containerDimensions],
  );

  const handleMarginChange = (side: keyof MarginInputs, raw: string) => {
    const val = Math.max(0, Number(raw) || 0);
    let next: MarginInputs;
    if (lockEqual) {
      next = { top: val, bottom: val, left: val, right: val };
    } else {
      next = { ...margins, [side]: val };
    }
    setMargins(next);
    applyMargins(next);
  };

  const handleResetMargins = () => {
    const reset: MarginInputs = { top: 0, bottom: 0, left: 0, right: 0 };
    setMargins(reset);
    applyMargins(reset);
  };

  // ─────────────────────────────────────────────────────────────────────────

  // Compute dimension info (used both in sidebar and pinned panel)
  const dimInfo = pdfDimensions && containerDimensions.width > 0 ? (() => {
    const sf = pdfDimensions.width / containerDimensions.width;
    return {
      origW:      ptToMm(pdfDimensions.width),
      origH:      ptToMm(pdfDimensions.height),
      cropLeft:   Math.max(0, ptToMm(cropBox.x * sf)),
      cropTop:    Math.max(0, ptToMm(cropBox.y * sf)),
      cropRight:  Math.max(0, ptToMm((containerDimensions.width  - cropBox.x - cropBox.width)  * sf)),
      cropBottom: Math.max(0, ptToMm((containerDimensions.height - cropBox.y - cropBox.height) * sf)),
      resultW:    ptToMm(cropBox.width  * sf),
      resultH:    ptToMm(cropBox.height * sf),
    };
  })() : null;

  return (
    <div className="flex h-screen bg-[#f5f5f5] text-slate-900 font-sans overflow-hidden">
      {/* Sidebar Controls */}
      <div className="w-[320px] bg-white border-r border-[#e5e5e5] flex flex-col shadow-sm z-20">
        <div className="p-6 border-b border-[#e5e5e5]">
          <h1 className="text-2xl font-semibold tracking-tight">PDF Cropper</h1>
          <p className="text-sm text-slate-500 mt-1">Overlay and batch crop</p>
        </div>

        {/* Scrollable controls */}
        <div className="p-6 flex-1 flex flex-col gap-6 overflow-y-auto min-h-0">
          {!fileBuffer && (
            <label className="flex flex-col items-center justify-center w-full h-40 border-2 border-dashed border-slate-300 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer group">
              <UploadCloud className="w-8 h-8 text-slate-400 group-hover:text-blue-500 transition-colors mb-3" />
              <span className="text-sm font-medium text-slate-600">Upload PDF</span>
              <span className="text-xs text-slate-400 mt-1">Support large files</span>
              <input type="file" accept=".pdf" className="hidden" onChange={handleFileUpload} />
            </label>
          )}

          {fileBuffer && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
                <FileUp className="w-5 h-5 text-blue-500 flex-shrink-0" />
                <div className="overflow-hidden">
                  <p className="text-sm font-medium truncate">{file?.name}</p>
                  <p className="text-xs text-slate-500">{numTotalPages} Pages</p>
                </div>
              </div>

              <div className="flex gap-2">
                <label className="flex-1">
                  <div className="inline-flex w-full items-center justify-center py-2 px-4 rounded-lg bg-white border border-slate-300 hover:bg-slate-50 text-sm font-medium cursor-pointer transition-colors text-slate-700">
                    Replace File
                  </div>
                  <input type="file" accept=".pdf" className="hidden" onChange={handleFileUpload} />
                </label>
              </div>

              {/* ── Equal Crop Panel ─────────────────────────────────── */}
              <div className="mt-2 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-700">Equal Crop Margins</h3>
                    <p className="text-xs text-slate-500 mt-0.5">Enter crop amount in mm</p>
                  </div>
                  <button
                    title={lockEqual ? 'Unlock sides' : 'Lock all sides equal'}
                    onClick={() => setLockEqual((v) => !v)}
                    className={cn(
                      'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors border',
                      lockEqual
                        ? 'bg-blue-50 border-blue-300 text-blue-700'
                        : 'bg-slate-50 border-slate-300 text-slate-600 hover:bg-slate-100',
                    )}
                  >
                    {lockEqual ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                    {lockEqual ? 'Locked' : 'Lock'}
                  </button>
                </div>

                {/* Visual margin layout */}
                <div className="grid grid-cols-3 gap-2 items-center">
                  <div />
                  <MarginField label="Top"    value={margins.top}    onChange={(v) => handleMarginChange('top', v)} />
                  <div />

                  <MarginField label="Left"   value={margins.left}   onChange={(v) => handleMarginChange('left', v)} />
                  <div className="flex items-center justify-center">
                    <div className="w-10 h-10 rounded border-2 border-slate-300 bg-slate-100" style={{ boxShadow: 'inset 0 0 0 3px white' }} />
                  </div>
                  <MarginField label="Right"  value={margins.right}  onChange={(v) => handleMarginChange('right', v)} />

                  <div />
                  <MarginField label="Bottom" value={margins.bottom} onChange={(v) => handleMarginChange('bottom', v)} />
                  <div />
                </div>

                <button
                  onClick={handleResetMargins}
                  className="w-full py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium text-slate-600 transition-colors"
                >
                  Reset Margins
                </button>
              </div>

              {/* ── Crop & Download ──────────────────────────────────── */}
              <div className="mt-2">
                <div className="mb-3">
                  <h3 className="text-sm font-semibold mb-1 text-slate-700">Crop Area</h3>
                  <p className="text-xs text-slate-500">Drag the rectangle or use the fields above. Applies to all pages.</p>
                </div>

                <button
                  onClick={handleCrop}
                  disabled={isProcessing || isLoading || !combinedImageDataUrl}
                  className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <Scissors className="w-4 h-4" />
                      Crop &amp; Download
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── Dimension Info — pinned at the bottom, always visible ── */}
        {dimInfo && (
          <div className="border-t border-slate-200 bg-white text-xs flex-shrink-0">
            {/* Row 1: Original + After crop */}
            <div className="grid grid-cols-2 divide-x divide-slate-200">
              <div className="px-3 py-2 bg-slate-50">
                <p className="font-semibold text-slate-400 uppercase tracking-wider text-[10px] mb-0.5">Original</p>
                <p className="font-mono text-slate-700 font-medium leading-tight">
                  {fmt(dimInfo.origW)}<br />{fmt(dimInfo.origH)} mm
                </p>
              </div>
              <div className="px-3 py-2 bg-emerald-50">
                <p className="font-semibold text-emerald-500 uppercase tracking-wider text-[10px] mb-0.5">After crop</p>
                <p className="font-mono text-emerald-800 font-medium leading-tight">
                  {fmt(dimInfo.resultW)}<br />{fmt(dimInfo.resultH)} mm
                </p>
              </div>
            </div>
            {/* Row 2: Cropped away per side */}
            <div className="px-3 py-2 bg-orange-50 border-t border-slate-200">
              <p className="font-semibold text-orange-400 uppercase tracking-wider text-[10px] mb-1">Cropped away</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                <DimRow label="Top"    value={dimInfo.cropTop}    unit="mm" color="text-orange-700" />
                <DimRow label="Right"  value={dimInfo.cropRight}  unit="mm" color="text-orange-700" />
                <DimRow label="Bottom" value={dimInfo.cropBottom} unit="mm" color="text-orange-700" />
                <DimRow label="Left"   value={dimInfo.cropLeft}   unit="mm" color="text-orange-700" />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Main Canvas Area */}
      <div className="flex-1 flex flex-col overflow-hidden relative" ref={containerRef}>
        {!fileBuffer ? (
          <div className="m-auto text-center flex flex-col items-center justify-center">
            <div className="w-20 h-20 rounded-full bg-blue-50 flex items-center justify-center mb-4">
              <UploadCloud className="w-8 h-8 text-blue-500" />
            </div>
            <h2 className="text-xl font-medium text-slate-700">No PDF Loaded</h2>
            <p className="text-slate-500 mt-2 max-w-sm">Upload a PDF to see all pages overlaid with transparency and crop them at once.</p>
          </div>
        ) : isLoading ? (
          <div className="m-auto text-center flex flex-col items-center justify-center">
            <Loader2 className="w-10 h-10 animate-spin text-blue-500 mb-4" />
            <h2 className="text-xl font-medium text-slate-700">Rendering Pages... {renderingProgress}%</h2>
            <div className="w-64 h-2 bg-slate-200 rounded-full mt-4 overflow-hidden">
              <div className="h-full bg-blue-500 transition-all duration-200" style={{ width: `${renderingProgress}%` }} />
            </div>
            <p className="text-slate-500 mt-4 text-sm">Processing all {numTotalPages || '...'} pages sequentially</p>
          </div>
        ) : (
          <div className="w-full h-full p-8 flex items-center justify-center overflow-auto relative bg-[#e5e5e5] pattern-dots">
            {/* The document container */}
            <div
              className="relative bg-white shadow-2xl"
              style={{
                width: containerDimensions.width,
                height: containerDimensions.height,
              }}
            >
              {combinedImageDataUrl && (
                <img
                  src={combinedImageDataUrl}
                  alt="Combined Pages"
                  className="absolute inset-0 w-full h-full pointer-events-none"
                />
              )}

              <CropBox
                containerWidth={containerDimensions.width}
                containerHeight={containerDimensions.height}
                onChange={setCropBox}
                controlledBox={controlledBox}
                showOriginalBorder={true}
              />
            </div>
          </div>
        )}
      </div>

      <style>{`
        .pattern-dots {
          background-image: radial-gradient(#cbd5e1 1px, transparent 1px);
          background-size: 20px 20px;
        }
      `}</style>
    </div>
  );
}

// ── Small reusable margin number field ────────────────────────────────────────
function MarginField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <input
        type="number"
        min={0}
        value={value === 0 ? '' : value}
        placeholder="0"
        onChange={(e) => onChange(e.target.value)}
        className="w-full text-center text-sm border border-slate-300 rounded-md py-1.5 px-1 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-blue-400 transition"
      />
      <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">{label} mm</span>
    </div>
  );
}

// ── Dimension row (label + value) ───────────────────────────────────────────────────
function DimRow({ label, value, unit, color }: { label: string; value: number; unit: string; color: string }) {
  return (
    <div className="flex items-center justify-between gap-1">
      <span className="text-slate-500">{label}</span>
      <span className={`font-mono font-semibold tabular-nums ${color}`}>
        {value.toFixed(2)}&nbsp;<span className="font-normal text-[10px]">{unit}</span>
      </span>
    </div>
  );
}
