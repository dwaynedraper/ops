'use client';

/**
 * AccCanvas — wraps ACC dashboard content so a click on empty space (the
 * desktop/canvas, not an element) releases the pinned element. Elements
 * stopPropagation on their own clicks, so only true canvas clicks reach here.
 * A thin client boundary the server dashboard page can wrap its content in.
 */

import type { ReactNode } from 'react';
import { clearPinned } from './focus-store';

export function AccCanvas({ children }: { children: ReactNode }) {
  return (
    <div onClick={() => clearPinned()} style={{ minHeight: '100%' }}>
      {children}
    </div>
  );
}
