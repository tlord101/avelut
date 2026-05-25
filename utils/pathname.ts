export const getWindowPathname = () => (typeof window !== 'undefined' ? window.location.pathname || '/' : '/');
