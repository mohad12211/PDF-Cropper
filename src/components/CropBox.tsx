import React, { useState, useEffect, useRef } from 'react';
import { cn } from '../lib/utils';

interface CropBoxProps {
  containerWidth: number;
  containerHeight: number;
  initialBox?: { x: number; y: number; width: number; height: number };
  onChange: (box: { x: number; y: number; width: number; height: number }) => void;
}

export function CropBox({ containerWidth, containerHeight, initialBox, onChange }: CropBoxProps) {
  const [box, setBox] = useState(initialBox || {
    x: containerWidth * 0.1,
    y: containerHeight * 0.1,
    width: containerWidth * 0.8,
    height: containerHeight * 0.8
  });

  const [isDragging, setIsDragging] = useState(false);
  const dragMode = useRef<string | null>(null);
  const dragStartInfo = useRef<{ startX: number, startY: number, startBox: typeof box } | null>(null);
  const reqRef = useRef<number | null>(null);

  // Use a ref for the box to avoid dependency cycles during active dragging
  const boxRef = useRef(box);

  useEffect(() => {
    if (!initialBox && containerWidth > 0 && containerHeight > 0) {
      const newBox = {
        x: containerWidth * 0.1,
        y: containerHeight * 0.1,
        width: containerWidth * 0.8,
        height: containerHeight * 0.8
      };
      setBox(newBox);
      boxRef.current = newBox;
    }
  }, [containerWidth, containerHeight]);

  useEffect(() => {
    onChange(box);
  }, [box, onChange]);

  const handlePointerDown = (e: React.PointerEvent, mode: string) => {
    e.stopPropagation();
    setIsDragging(true);
    dragMode.current = mode;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStartInfo.current = {
      startX: e.clientX,
      startY: e.clientY,
      startBox: { ...boxRef.current }
    };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging || !dragStartInfo.current || !dragMode.current) return;

    const dx = e.clientX - dragStartInfo.current.startX;
    const dy = e.clientY - dragStartInfo.current.startY;
    const { startBox } = dragStartInfo.current;
    
    // Use requestAnimationFrame to throttle state updates for smooth dragging
    if (reqRef.current) cancelAnimationFrame(reqRef.current);
    
    reqRef.current = requestAnimationFrame(() => {
      let newBox = { ...startBox };

      if (dragMode.current === 'move') {
        newBox.x = Math.max(0, Math.min(containerWidth - newBox.width, startBox.x + dx));
        newBox.y = Math.max(0, Math.min(containerHeight - newBox.height, startBox.y + dy));
      } else {
        if (dragMode.current?.includes('left')) {
          const targetX = Math.min(startBox.x + startBox.width - 20, Math.max(0, startBox.x + dx));
          newBox.width += (startBox.x - targetX);
          newBox.x = targetX;
        }
        if (dragMode.current?.includes('right')) {
          newBox.width = Math.max(20, Math.min(containerWidth - startBox.x, startBox.width + dx));
        }
        if (dragMode.current?.includes('top')) {
          const targetY = Math.min(startBox.y + startBox.height - 20, Math.max(0, startBox.y + dy));
          newBox.height += (startBox.y - targetY);
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
      {/* 4 separate divs for overlay instead of clip-path for much better performance */}
      <div className="absolute bg-black/40 pointer-events-none" style={{ top: 0, left: 0, right: 0, height: box.y }} />
      <div className="absolute bg-black/40 pointer-events-none" style={{ top: box.y, bottom: containerHeight - (box.y + box.height), left: 0, width: box.x }} />
      <div className="absolute bg-black/40 pointer-events-none" style={{ top: box.y, bottom: containerHeight - (box.y + box.height), right: 0, left: box.x + box.width }} />
      <div className="absolute bg-black/40 pointer-events-none" style={{ bottom: 0, left: 0, right: 0, top: box.y + box.height }} />

      <div
        className={cn(
          "absolute border-2 border-blue-500 ring-1 ring-white/50 shadow-[0_0_15px_rgba(0,0,0,0.2)] bg-blue-500/10",
          isDragging ? "pointer-events-auto" : "pointer-events-auto cursor-move"
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
              cursor: h.cursor
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
