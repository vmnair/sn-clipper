// SnClipper/src/components/CropOverlay.tsx
// Vinod Nair
//
// Interactive page-crop overlay extracted from App.tsx.
// Owns all crop geometry (workspace measurement, image scaling, the draggable/
// resizable crop box) and reports the final selection back to the parent in
// image-space pixels via onSave. The parent keeps the native crop + storage logic.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  SafeAreaView,
  StyleSheet,
  Text,
  View,
  Pressable,
  Image,
} from 'react-native';
import { HighContrastButton } from './HighContrastButton';

interface Size {
  width: number;
  height: number;
}

interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface CropOverlayProps {
  pagePath: string | null; // file path to the captured full-page PNG
  imageSize: Size; // true page pixel size
  loading: boolean;
  onCancel: () => void;
  onSave: (rect: CropRect) => void; // selection in image-space pixels
}

// Minimum crop box size, in displayed (workspace) pixels.
const MIN_SIZE = 60;
// Throttle interval for crop-box state updates during a gesture. E-ink panels
// ghost badly when re-rendered on every touch-move event, so we commit at most
// once per interval and force a final commit on touch-end.
const THROTTLE_MS = 90;

// Which edges a given resize handle moves.
const HANDLE_SIDES: Record<string, { l?: boolean; r?: boolean; t?: boolean; b?: boolean }> = {
  nw: { l: true, t: true },
  n: { t: true },
  ne: { r: true, t: true },
  e: { r: true },
  se: { r: true, b: true },
  s: { b: true },
  sw: { l: true, b: true },
  w: { l: true },
};

export function CropOverlay({ pagePath, imageSize, loading, onCancel, onSave }: CropOverlayProps) {
  const [workspaceSize, setWorkspaceSize] = useState<Size>({ width: 0, height: 0 });
  const [cropBox, setCropBox] = useState<Box>({ left: 0, top: 0, width: 0, height: 0 });
  // While the WHOLE box is being dragged we hide the handles so the only moving
  // high-contrast element on the e-ink panel is the thin box border (less ghosting).
  // We must NOT hide handles during a resize, or the touched handle unmounts mid-gesture
  // and stops receiving move events.
  const [isDraggingBody, setIsDraggingBody] = useState(false);

  // Gesture snapshots. `box` is the crop box as it was when the gesture started.
  const dragStart = useRef({ x: 0, y: 0, box: { left: 0, top: 0, width: 0, height: 0 } });
  const resizeStart = useRef({ x: 0, y: 0, anchor: 'se', box: { left: 0, top: 0, width: 0, height: 0 } });

  // Throttle bookkeeping.
  const lastCommit = useRef(0);
  const pending = useRef<Box>(cropBox);

  // Whether the crop box has been given its initial centered position yet.
  const initialized = useRef(false);

  const onWorkspaceLayout = (e: any) => {
    const { width, height } = e.nativeEvent.layout;
    setWorkspaceSize({ width, height });
  };

  // Scale the page image to fit the workspace while preserving aspect ratio.
  const displayedSize = useMemo<Size>(() => {
    if (workspaceSize.width === 0 || imageSize.width === 0) return { width: 0, height: 0 };
    const ratio = Math.min(workspaceSize.width / imageSize.width, workspaceSize.height / imageSize.height);
    return {
      width: Math.floor(imageSize.width * ratio),
      height: Math.floor(imageSize.height * ratio),
    };
  }, [workspaceSize, imageSize]);

  // Center the scaled image within the workspace.
  const imageOffset = useMemo(() => ({
    left: Math.floor((workspaceSize.width - displayedSize.width) / 2),
    top: Math.floor((workspaceSize.height - displayedSize.height) / 2),
  }), [workspaceSize, displayedSize]);

  // Fix 1: start with a crop box centered on both axes (~60% of the page). This runs
  // only ONCE, when the workspace is first measured — re-running on every displayedSize
  // change would reset the user's box whenever a re-layout fires (e.g. the
  // invalidatePluginView repaint on gesture end).
  useEffect(() => {
    if (!initialized.current && displayedSize.width > 0 && displayedSize.height > 0) {
      const w = Math.floor(displayedSize.width * 0.6);
      const h = Math.floor(displayedSize.height * 0.6);
      const box = {
        left: Math.floor((displayedSize.width - w) / 2),
        top: Math.floor((displayedSize.height - h) / 2),
        width: w,
        height: h,
      };
      pending.current = box;
      setCropBox(box);
      initialized.current = true;
    }
  }, [displayedSize]);

  // Commit a new box, throttled. `force` bypasses the throttle (use on touch-end).
  const commit = (box: Box, force: boolean) => {
    pending.current = box;
    const now = Date.now();
    if (force || now - lastCommit.current >= THROTTLE_MS) {
      lastCommit.current = now;
      setCropBox(box);
    }
  };

  // ---- Body drag ----
  // Snapshots come from pending.current (always the latest box, even if a throttled
  // commit hasn't flushed to render state yet) rather than the cropBox state.
  const onBodyStart = (e: any) => {
    const { pageX, pageY } = e.nativeEvent;
    dragStart.current = { x: pageX, y: pageY, box: { ...pending.current } };
    setIsDraggingBody(true);
  };

  const onBodyMove = (e: any) => {
    const { pageX, pageY } = e.nativeEvent;
    const dx = pageX - dragStart.current.x;
    const dy = pageY - dragStart.current.y;
    const start = dragStart.current.box;
    const maxLeft = displayedSize.width - start.width;
    const maxTop = displayedSize.height - start.height;
    commit({
      ...start,
      left: Math.min(maxLeft, Math.max(0, start.left + dx)),
      top: Math.min(maxTop, Math.max(0, start.top + dy)),
    }, false);
  };

  // ---- Resize (any of 8 handles) ----
  // Per-anchor touch-start handlers are cached so the 8 handles don't get fresh closures
  // (and new props) on every throttled re-render during a gesture.
  const resizeStartCache = useRef<Record<string, (e: any) => void>>({});
  const getResizeStart = (anchor: string) => {
    if (!resizeStartCache.current[anchor]) {
      resizeStartCache.current[anchor] = (e: any) => {
        e.stopPropagation();
        const { pageX, pageY } = e.nativeEvent;
        resizeStart.current = { x: pageX, y: pageY, anchor, box: { ...pending.current } };
      };
    }
    return resizeStartCache.current[anchor];
  };

  const onResizeMove = (e: any) => {
    e.stopPropagation();
    const { pageX, pageY } = e.nativeEvent;
    const { x, y, anchor, box: start } = resizeStart.current;
    const dx = pageX - x;
    const dy = pageY - y;
    const sides = HANDLE_SIDES[anchor] || {};

    let { left, top, width, height } = start;

    if (sides.l) {
      const newLeft = Math.min(Math.max(0, start.left + dx), start.left + start.width - MIN_SIZE);
      width = start.left + start.width - newLeft;
      left = newLeft;
    }
    if (sides.r) {
      width = Math.min(Math.max(MIN_SIZE, start.width + dx), displayedSize.width - start.left);
    }
    if (sides.t) {
      const newTop = Math.min(Math.max(0, start.top + dy), start.top + start.height - MIN_SIZE);
      height = start.top + start.height - newTop;
      top = newTop;
    }
    if (sides.b) {
      height = Math.min(Math.max(MIN_SIZE, start.height + dy), displayedSize.height - start.top);
    }

    commit({ left, top, width, height }, false);
  };

  const onGestureEnd = (e: any) => {
    if (e && e.stopPropagation) e.stopPropagation();
    commit(pending.current, true);
    setIsDraggingBody(false);
    // The SDK exposes no low-level e-ink waveform control; the only lever is a full
    // plugin-view repaint, which flushes the ghost trails left by the moving box and
    // cleanly redraws the box + restored handles in one pass.
    try {
      const { NativePluginManager } = require('sn-plugin-lib');
      if (NativePluginManager && typeof NativePluginManager.invalidatePluginView === 'function') {
        NativePluginManager.invalidatePluginView();
      }
    } catch (err) {
      // No-op: repaint is a best-effort enhancement.
    }
  };

  const handleSave = () => {
    if (!pagePath || displayedSize.width === 0) return;
    // Use pending.current (the latest gesture geometry) rather than the throttled
    // cropBox render state, so a save right after a fast/interrupted gesture still
    // crops what the user last drew.
    const box = pending.current;
    const scaleX = imageSize.width / displayedSize.width;
    const scaleY = imageSize.height / displayedSize.height;
    const x = Math.max(0, Math.floor(box.left * scaleX));
    const y = Math.max(0, Math.floor(box.top * scaleY));
    const width = Math.min(imageSize.width - x, Math.ceil(box.width * scaleX));
    const height = Math.min(imageSize.height - y, Math.ceil(box.height * scaleY));
    onSave({ x, y, width, height });
  };

  // Offset of a handle's top-left within the box, placing its 48dp square centered
  // on the relevant corner / edge midpoint.
  const handleOffset = (anchor: string, w: number, h: number) => ({
    left: anchor.includes('w') ? -HALF : anchor.includes('e') ? w - HALF : w / 2 - HALF,
    top: anchor.includes('n') ? -HALF : anchor.includes('s') ? h - HALF : h / 2 - HALF,
  });

  // The 8 resize handles. Rendered as siblings of the box inside imageWrapper (not as
  // children of the box) and positioned in absolute workspace coordinates, so each sits
  // fully inside a large touchable container — reliable on Android, where touches that
  // fall outside a parent's bounds are not delivered to overflowing children.
  const renderHandle = (anchor: string) => {
    const off = handleOffset(anchor, cropBox.width, cropBox.height);
    return (
      <View
        key={anchor}
        style={[styles.handleTouch, {
          left: imageOffset.left + cropBox.left + off.left,
          top: imageOffset.top + cropBox.top + off.top,
        }]}
        onTouchStart={getResizeStart(anchor)}
        onTouchMove={onResizeMove}
        onTouchEnd={onGestureEnd}
        onTouchCancel={onGestureEnd}
      >
        <View style={styles.handleDot} />
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.cropHeader}>
          <Text style={styles.cropTitle}>Crop Page Section</Text>
          <Pressable onPress={onCancel} style={styles.cropCloseButton}>
            <Text style={styles.cropCloseText}>Cancel</Text>
          </Pressable>
        </View>

        {loading ? (
          <View style={styles.cropLoadingContainer}>
            <Text style={styles.cropLoadingText}>Capturing page...</Text>
          </View>
        ) : (
          <View style={styles.cropWorkspace} onLayout={onWorkspaceLayout}>
            {workspaceSize.width > 0 && pagePath && (
              <View style={styles.imageWrapper}>
                <Image
                  source={{ uri: 'file://' + pagePath }}
                  style={{
                    width: displayedSize.width,
                    height: displayedSize.height,
                    position: 'absolute',
                    left: imageOffset.left,
                    top: imageOffset.top,
                  }}
                  resizeMode="contain"
                />

                {/* Draggable crop box (body). Handles are siblings, rendered after it. */}
                <View
                  style={[
                    styles.cropBox,
                    {
                      left: imageOffset.left + cropBox.left,
                      top: imageOffset.top + cropBox.top,
                      width: cropBox.width,
                      height: cropBox.height,
                    },
                  ]}
                  onTouchStart={onBodyStart}
                  onTouchMove={onBodyMove}
                  onTouchEnd={onGestureEnd}
                  onTouchCancel={onGestureEnd}
                />

                {/* Resize handles — hidden only while the whole box is being dragged,
                    so the one being touched during a resize never unmounts. */}
                {!isDraggingBody && Object.keys(HANDLE_SIDES).map((anchor) => renderHandle(anchor))}
              </View>
            )}
          </View>
        )}

        {!loading && (
          <View style={styles.cropFooter}>
            <HighContrastButton label="Clip selected region" onPress={handleSave} />
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

// Touch target size for handles (>= 48dp per NFR-1) and the smaller visible dot.
const HANDLE = 48;
const DOT = 22;
const HALF = HANDLE / 2;

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  cropHeader: {
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: 2,
    borderColor: '#000000',
    backgroundColor: '#ffffff',
  },
  cropTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#000000',
  },
  cropCloseButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderWidth: 2,
    borderColor: '#000000',
    backgroundColor: '#ffffff',
  },
  cropCloseText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#000000',
  },
  cropWorkspace: {
    flex: 1,
    backgroundColor: '#e0e0e0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cropLoadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#ffffff',
  },
  cropLoadingText: {
    fontSize: 18,
    color: '#000000',
  },
  imageWrapper: {
    width: '100%',
    height: '100%',
    position: 'relative',
  },
  // Fix 3: single solid black border, no translucent fill, no dashed overlay.
  cropBox: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: '#000000',
    backgroundColor: 'transparent',
  },
  handleTouch: {
    position: 'absolute',
    width: HANDLE,
    height: HANDLE,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  // Hollow (white fill + black border) rather than solid black: a filled-black
  // square moving across e-ink leaves much heavier ghost trails than an outline.
  handleDot: {
    width: DOT,
    height: DOT,
    borderWidth: 2,
    borderColor: '#000000',
    backgroundColor: '#ffffff',
  },
  cropFooter: {
    height: 80,
    padding: 12,
    borderTopWidth: 2,
    borderColor: '#000000',
    backgroundColor: '#ffffff',
  },
});
