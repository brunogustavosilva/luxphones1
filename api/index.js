import { createVercelHandler } from '../server/vercel-handler.js';
export default createVercelHandler(() => import('../server/index.js').then((module) => module.default));
