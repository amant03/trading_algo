import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { applyPageMeta, pageMeta } from '../seo';

/** Keeps title, description, canonical, and social tags aligned with the route. */
export default function Seo() {
  const { pathname } = useLocation();
  useEffect(() => {
    applyPageMeta(pageMeta(pathname));
  }, [pathname]);
  return null;
}
