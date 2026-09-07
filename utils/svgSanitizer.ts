/**
 * SVG Sanitization & Validation Utility
 * Safely validates and cleans AI-generated SVG markup before DOM rendering.
 */

/**
 * Sanitizes an SVG string removing unsafe elements, event handlers, scripts, and external URLs.
 * Returns null if the SVG is malformed or invalid.
 */
export function sanitizeSvg(svgString: string | null | undefined): string | null {
  if (!svgString || typeof svgString !== 'string') {
    return null;
  }

  const trimmed = svgString.trim();
  if (!trimmed) return null;

  // Extract <svg ...> ... </svg> if embedded in markdown backticks or extra text
  const svgMatch = trimmed.match(/<svg[\s\S]*?<\/svg>/i);
  if (!svgMatch) {
    return null;
  }

  let cleanSvg = svgMatch[0];

  // DOM Parser sanitization if window/DOMParser is available
  if (typeof window !== 'undefined' && typeof window.DOMParser !== 'undefined') {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(cleanSvg, 'image/svg+xml');

      // Check for parsing errors
      const parserError = doc.querySelector('parsererror');
      if (parserError) {
        console.warn('[SVG Sanitizer] SVG parse error:', parserError.textContent);
        return null;
      }

      const svgEl = doc.documentElement;
      if (!svgEl || svgEl.tagName.toLowerCase() !== 'svg') {
        return null;
      }

      // Ensure valid viewBox attribute
      if (!svgEl.hasAttribute('viewBox')) {
        const width = svgEl.getAttribute('width') || '800';
        const height = svgEl.getAttribute('height') || '500';
        const cleanW = parseFloat(width) || 800;
        const cleanH = parseFloat(height) || 500;
        svgEl.setAttribute('viewBox', `0 0 ${cleanW} ${cleanH}`);
      }

      // Explicitly set styling attributes for chalkboard contrast if missing
      if (!svgEl.hasAttribute('width')) svgEl.setAttribute('width', '100%');
      if (!svgEl.hasAttribute('height')) svgEl.setAttribute('height', '100%');

      // Remove forbidden tags (keep foreignobject for KaTeX labels in SVG)
      const forbiddenTags = [
        'script',
        'iframe',
        'object',
        'embed',
        'link',
        'style',
        'base',
      ];

      forbiddenTags.forEach((tagName) => {
        const elements = doc.getElementsByTagName(tagName);
        while (elements.length > 0) {
          elements[0].parentNode?.removeChild(elements[0]);
        }
      });

      // Recursively sanitize attributes on all elements and fix dark chalkboard stroke/fill colors
      const allNodes = doc.getElementsByTagName('*');
      for (let i = 0; i < allNodes.length; i++) {
        const node = allNodes[i];
        const attrsToRemove: string[] = [];

        for (let j = 0; j < node.attributes.length; j++) {
          const attr = node.attributes[j];
          const attrName = attr.name.toLowerCase();
          const attrVal = attr.value.toLowerCase().trim();

          // Remove inline event handlers (on*)
          if (attrName.startsWith('on')) {
            attrsToRemove.push(attr.name);
          }
          // Remove javascript: or data: URIs in href / xlink:href / src
          else if (
            (attrName === 'href' || attrName === 'xlink:href' || attrName === 'src') &&
            (attrVal.startsWith('javascript:') || attrVal.startsWith('data:text/html') || attrVal.startsWith('http:') || attrVal.startsWith('https:'))
          ) {
            attrsToRemove.push(attr.name);
          }

          // Transform dark navy / dark slate / black stroke & fill colors into high-contrast chalk colors
          if (attrName === 'stroke' && (attrVal === '#0f172a' || attrVal === '#2c3e50' || attrVal === '#1e293b' || attrVal === '#000' || attrVal === '#000000' || attrVal === 'black')) {
            node.setAttribute(attr.name, '#38BDF8');
          }
          if (attrName === 'fill' && (attrVal === '#0f172a' || attrVal === '#2c3e50' || attrVal === '#000' || attrVal === '#000000' || attrVal === 'black')) {
            node.setAttribute(attr.name, '#E2E8F0');
          }
        }

        attrsToRemove.forEach((attrName) => node.removeAttribute(attrName));
      }

      const serializer = new XMLSerializer();
      return serializer.serializeToString(doc);
    } catch (err) {
      console.warn('[SVG Sanitizer] DOMParser exception:', err);
    }
  }

  // Fallback regex sanitizer if DOMParser is unavailable or threw an exception
  cleanSvg = cleanSvg
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/\son\w+='[^']*'/gi, '')
    .replace(/href="javascript:[^"]*"/gi, '')
    .replace(/href='javascript:[^']*'/gi, '');

  return cleanSvg;
}
