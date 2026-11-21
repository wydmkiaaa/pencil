import { createApiApp } from '../server';

export const config = {
  maxDuration: 60,
};

const app = createApiApp();

export default app;
