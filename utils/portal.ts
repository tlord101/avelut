import { useEffect, useState } from 'react';

export const getOrCreatePortalRoot = (id: string): HTMLElement | null => {
  if (typeof document === 'undefined') return null;

  const existing = document.getElementById(id);
  if (existing) {
    return existing as HTMLElement;
  }

  const root = document.createElement('div');
  root.id = id;
  document.body.appendChild(root);
  return root;
};

export const usePortalRoot = (id: string): HTMLElement | null => {
  const [root, setRoot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const portalRoot = getOrCreatePortalRoot(id);
    setRoot(portalRoot);

    return () => {
      if (portalRoot && portalRoot.parentElement === document.body && portalRoot.childElementCount === 0) {
        portalRoot.remove();
      }
    };
  }, [id]);

  return root;
};