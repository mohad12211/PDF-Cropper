import React, { useState, useEffect, useRef } from 'react';
import { cn } from '../lib/utils';

interface CropBoxProps {
  containerWidth: number;
  containerHeight: number;
  initialBox?: { x: number; y: number; width: number; height: number };
  /** When provided, this becomes a controlled value from outside (e.g. equal-crop inputs) */
  controlledBox?: { x: number; y: number; width: number; height: number } | null;
  onChange: (box: { x: number; y: number; width: number; height: number }) => void;
  /** Whether to show the original PDF page border */
  showOriginalBorder?: boolean;
  /**
   * When true, all four margins are kept equal during handle drags.
   * Free-move drag is disabled. Requires pxPerMmX / pxPerMmY to work correctly.
   */
  locked?: boolean;
  /**
   * When true, the crop result is constrained to the ISO √2 aspect ratio (h/w = √2 for portrait,
   * w/h = √2 for landscape). Free-move drag is disabled when this is active.
   */
  lockRatio?: boolean;
  /** Whether the source PDF is portrait (height ≥ width). Used by lockRatio. */
  pdfIsPortrait?: boolean;
  /** Pixels per millimetre along the X axis (containerWidth / pdfWidthMm) */
  pxPerMmX?: number;
  /** Pixels per millimetre along the Y axis (containerHeight / pdfHeightMm) */
  pxPerMmY?: number;
}

export function CropBox({
  containerWidth,
  containerHeight,
  initialBox,
  controlledBox,
  onChange,
  showOriginalBorder = false,
  locked = false,
  lockRatio = false,
  pdfIsPortrait = true,
  pxPerMmX,
  pxPerMmY,
}: CropBoxProps) {
  const defaultBox = () => ({
    x: containerWidth * 0.1,
    y: containerHeight * 0.1,
    width: containerWidth * 0.8,
    height: containerHeight * 0.8,
  });

  const [box, setBox] = useState(initialBox || defaultBox());

  const [isDragging, setIsDragging] = useState(false);
  const dragMode = useRef<string | null>(null);
  const dragStartInfo = useRef<{ startX: number; startY: number; startBox: typeof box } | null>(null);
  const reqRef = useRef<number | null>(null);

  // Use a ref for the box to avoid dependency cycles during active dragging
  const boxRef = useRef(box);

  // Reset box when container size changes (new file loaded)
  useEffect(() => {
    if (!initialBox && containerWidth > 0 && containerHeight > 0) {
      const newBox = defaultBox();
      setBox(newBox);
      boxRef.current = newBox;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerWidth, containerHeight]);

  // Sync when a controlled box is pushed in from outside (equal-crop panel)
  useEffect(() => {
    if (controlledBox) {
      setBox(controlledBox);
      boxRef.current = controlledBox;
    }
  }, [controlledBox]);

  useEffect(() => {
    onChange(box);
  }, [box, onChange]);

  const handlePointerDown = (e: React.PointerEvent, mode: string) => {
    // When locked or ratio-locked, move drag is not allowed; handle resizing is still allowed
    if ((locked || lockRatio) && mode === 'move') return;
    e.stopPropagation();
    setIsDragging(true);
    dragMode.current = mode;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStartInfo.current = {
      startX: e.clientX,
      startY: e.clientY,
      startBox: { ...boxRef.current },
    };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging || !dragStartInfo.current || !dragMode.current) return;

    const dx = e.clientX - dragStartInfo.current.startX;
    const dy = e.clientY - dragStartInfo.current.startY;
    const { startBox } = dragStartInfo.current;

    if (reqRef.current) cancelAnimationFrame(reqRef.current);

    reqRef.current = requestAnimationFrame(() => {
      let newBox = { ...startBox };

      if (locked && pxPerMmX && pxPerMmY) {
        // Equal-margin mode: derive the new margin (in mm) from the dragged side,
        // then apply it symmetrically to all four sides.
        let marginMmX: number | null = null;
        let marginMmY: number | null = null;

        if (dragMode.current?.includes('left')) {
          const newLeftPx = Math.max(0, Math.min(startBox.x + startBox.width - 20, startBox.x + dx));
          marginMmX = newLeftPx / pxPerMmX;
        }
        if (dragMode.current?.includes('right')) {
          const newRightEdgePx = startBox.x + Math.max(20, Math.min(containerWidth - startBox.x, startBox.width + dx));
          marginMmX = Math.max(0, containerWidth - newRightEdgePx) / pxPerMmX;
        }
        if (dragMode.current?.includes('top')) {
          const newTopPx = Math.max(0, Math.min(startBox.y + startBox.height - 20, startBox.y + dy));
          marginMmY = newTopPx / pxPerMmY;
        }
        if (dragMode.current?.includes('bottom')) {
          const newBottomEdgePx = startBox.y + Math.max(20, Math.min(containerHeight - startBox.y, startBox.height + dy));
          marginMmY = Math.max(0, containerHeight - newBottomEdgePx) / pxPerMmY;
        }

        // If both axes changed (corner handle), average them for a single equal margin.
        let marginMm = 0;
        if (marginMmX !== null && marginMmY !== null) {
          marginMm = (marginMmX + marginMmY) / 2;
        } else if (marginMmX !== null) {
          marginMm = marginMmX;
        } else if (marginMmY !== null) {
          marginMm = marginMmY;
        }
        marginMm = Math.max(0, marginMm);

        const leftPx   = marginMm * pxPerMmX;
        const topPx    = marginMm * pxPerMmY;
        newBox = {
          x: leftPx,
          y: topPx,
          width:  Math.max(20, containerWidth  - 2 * leftPx),
          height: Math.max(20, containerHeight - 2 * topPx),
        };
      } else if (lockRatio) {
        // √2-ratio mode: allow free resizing but snap to ISO aspect ratio.
        // The dragged side drives the size on its axis; the other axis is derived.
        const SQRT2 = Math.SQRT2;
        // targetRatio = h / w
        const targetRatio = pdfIsPortrait ? SQRT2 : 1 / SQRT2;

        const mode = dragMode.current ?? '';
        const isHorizontal = mode.includes('left') || mode.includes('right');
        const isVertical   = mode.includes('top')  || mode.includes('bottom');

        // First compute the unconstrained new box on the dragged axis
        if (mode.includes('left')) {
          const targetX = Math.min(startBox.x + startBox.width - 20, Math.max(0, startBox.x + dx));
          newBox.width += startBox.x - targetX;
          newBox.x = targetX;
        }
        if (mode.includes('right')) {
          newBox.width = Math.max(20, Math.min(containerWidth - startBox.x, startBox.width + dx));
        }
        if (mode.includes('top')) {
          const targetY = Math.min(startBox.y + startBox.height - 20, Math.max(0, startBox.y + dy));
          newBox.height += startBox.y - targetY;
          newBox.y = targetY;
        }
        if (mode.includes('bottom')) {
          newBox.height = Math.max(20, Math.min(containerHeight - startBox.y, startBox.height + dy));
        }

        // Now snap the non-dragged axis to preserve the √2 ratio.
        // Corner handles: use the axis with the bigger movement as the reference.
        if (isHorizontal && isVertical) {
          // Corner: pick axis with larger delta
          if (Math.abs(dx) >= Math.abs(dy)) {
            // Width is the reference → adjust height, keep top edge, extend bottom
            newBox.height = newBox.width * targetRatio;
          } else {
            // Height is the reference → adjust width, keep left edge, extend right
            newBox.width = newBox.height / targetRatio;
          }
        } else if (isHorizontal) {
          // Width changed → adjust height symmetrically around centre
          const centreY = startBox.y + startBox.height / 2;
          newBox.height = newBox.width * targetRatio;
          newBox.y = Math.max(0, centreY - newBox.height / 2);
          // Clamp to container
          if (newBox.y + newBox.height > containerHeight) {
            newBox.y = containerHeight - newBox.height;
          }
        } else if (isVertical) {
          // Height changed → adjust width symmetrically around centre
          const centreX = startBox.x + startBox.width / 2;
          newBox.width = newBox.height / targetRatio;
          newBox.x = Math.max(0, centreX - newBox.width / 2);
          // Clamp to container
          if (newBox.x + newBox.width > containerWidth) {
            newBox.x = containerWidth - newBox.width;
          }
        }

        // Final safety clamp
        newBox.width  = Math.max(20, Math.min(newBox.width,  containerWidth));
        newBox.height = Math.max(20, Math.min(newBox.height, containerHeight));
        newBox.x = Math.max(0, Math.min(newBox.x, containerWidth  - newBox.width));
        newBox.y = Math.max(0, Math.min(newBox.y, containerHeight - newBox.height));
      } else if (dragMode.current === 'move') {
        newBox.x = Math.max(0, Math.min(containerWidth - newBox.width, startBox.x + dx));
        newBox.y = Math.max(0, Math.min(containerHeight - newBox.height, startBox.y + dy));
      } else {
        if (dragMode.current?.includes('left')) {
          const targetX = Math.min(startBox.x + startBox.width - 20, Math.max(0, startBox.x + dx));
          newBox.width += startBox.x - targetX;
          newBox.x = targetX;
        }
        if (dragMode.current?.includes('right')) {
          newBox.width = Math.max(20, Math.min(containerWidth - startBox.x, startBox.width + dx));
        }
        if (dragMode.current?.includes('top')) {
          const targetY = Math.min(startBox.y + startBox.height - 20, Math.max(0, startBox.y + dy));
          newBox.height += startBox.y - targetY;
          newBox.y = targetY;
        }
        if (dragMode.current?.includes('bottom')) {
          newBox.height = Math.max(20, Math.min(containerHeight - startBox.y, startBox.height + dy));
        }
      }
      boxRef.current = newBox;
      setBox(newBox);
    });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    setIsDragging(false);
    dragMode.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (reqRef.current) cancelAnimationFrame(reqRef.current);
  };

  const handles = [
    { mode: 'top-left', cursor: 'nwse-resize', top: -5, left: -5 },
    { mode: 'top', cursor: 'ns-resize', top: -5, left: '50%', ml: -5 },
    { mode: 'top-right', cursor: 'nesw-resize', top: -5, right: -5 },
    { mode: 'left', cursor: 'ew-resize', top: '50%', mt: -5, left: -5 },
    { mode: 'right', cursor: 'ew-resize', top: '50%', mt: -5, right: -5 },
    { mode: 'bottom-left', cursor: 'nesw-resize', bottom: -5, left: -5 },
    { mode: 'bottom', cursor: 'ns-resize', bottom: -5, left: '50%', ml: -5 },
    { mode: 'bottom-right', cursor: 'nwse-resize', bottom: -5, right: -5 },
  ];

  return (
    <div className="absolute inset-0 z-10 pointer-events-none" style={{ width: containerWidth, height: containerHeight }}>
      {/* Original PDF page border indicator */}
      {showOriginalBorder && (
        <>
          {/* Pulsing corner markers */}
          {[
            { top: -1, left: -1 },
            { top: -1, right: -1 },
            { bottom: -1, left: -1 },
            { bottom: -1, right: -1 },
          ].map((pos, i) => (
            <div
              key={i}
              className="absolute w-4 h-4 pointer-events-none z-20"
              style={{
                ...pos,
                borderTop: pos.top !== undefined ? '3px solid #f97316' : undefined,
                borderBottom: pos.bottom !== undefined ? '3px solid #f97316' : undefined,
                borderLeft: pos.left !== undefined ? '3px solid #f97316' : undefined,
                borderRight: pos.right !== undefined ? '3px solid #f97316' : undefined,
              }}
            />
          ))}
          {/* Dashed border around full PDF area */}
          <div
            className="absolute inset-0 pointer-events-none z-20"
            style={{
              outline: '2px dashed #f97316',
              outlineOffset: '-1px',
              boxShadow: '0 0 0 1px rgba(249,115,22,0.15), inset 0 0 0 1px rgba(249,115,22,0.15)',
            }}
          />
          {/* Label */}
          <div
            className="absolute pointer-events-none z-30 select-none"
            style={{ top: 6, left: 8 }}
          >
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: '0.05em',
                color: '#f97316',
                background: 'rgba(255,255,255,0.85)',
                padding: '1px 5px',
                borderRadius: 3,
                border: '1px solid rgba(249,115,22,0.4)',
              }}
            >
              ORIGINAL
            </span>
          </div>
        </>
      )}

      {/* 4 dark overlay panels around the crop box */}
      <div className="absolute bg-black/40 pointer-events-none" style={{ top: 0, left: 0, right: 0, height: box.y }} />
      <div className="absolute bg-black/40 pointer-events-none" style={{ top: box.y, bottom: containerHeight - (box.y + box.height), left: 0, width: box.x }} />
      <div className="absolute bg-black/40 pointer-events-none" style={{ top: box.y, bottom: containerHeight - (box.y + box.height), right: 0, left: box.x + box.width }} />
      <div className="absolute bg-black/40 pointer-events-none" style={{ bottom: 0, left: 0, right: 0, top: box.y + box.height }} />

      {/* Crop box */}
      <div
        className={cn(
          'absolute border-2 border-blue-500 ring-1 ring-white/50 shadow-[0_0_15px_rgba(0,0,0,0.2)] bg-blue-500/10',
          locked ? 'pointer-events-auto cursor-default' : (isDragging ? 'pointer-events-auto' : 'pointer-events-auto cursor-move')
        )}
        style={{
          left: box.x,
          top: box.y,
          width: box.width,
          height: box.height,
        }}
        onPointerDown={(e) => handlePointerDown(e, 'move')}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {handles.map((h, i) => (
          <div
            key={i}
            className="absolute w-[10px] h-[10px] bg-white border border-blue-500 z-20"
            style={{
              top: h.top,
              left: h.left,
              right: h.right,
              bottom: h.bottom,
              marginTop: h.mt,
              marginLeft: h.ml,
              cursor: h.cursor,
            }}
            onPointerDown={(e) => handlePointerDown(e, h.mode)}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          />
        ))}
      </div>
    </div>
  );
}
