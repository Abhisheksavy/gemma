import swaggerUi from 'swagger-ui-express';
import { config } from '../config/index.js';

export const swaggerSpec = {
  openapi: '3.0.0',
  info: {
    title: 'Gemma Inference API',
    version: '1.0.0',
    description: 'Production-ready AI inference server powered by Google Gemma via Ollama. Supports conversation history and custom system prompts.',
    contact: { name: 'GitHub', url: 'https://github.com/Abhisheksavy/gemma' },
  },
  servers: [
    { url: '/api', description: 'Current server' },
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description: 'API key — required only if API_KEY env var is set on the server.',
      },
    },
    schemas: {
      ChatRequest: {
        type: 'object',
        required: ['message'],
        properties: {
          message: {
            type: 'string',
            description: 'The user message to send to the model.',
            example: 'Explain machine learning in 2 sentences.',
            maxLength: 2000,
          },
          systemPrompt: {
            type: 'string',
            description: 'Optional system prompt to control model behaviour.',
            example: 'You are a helpful assistant. Reply concisely.',
          },
          history: {
            type: 'array',
            description: 'Optional conversation history for multi-turn chat (last 10 turns used).',
            items: {
              type: 'object',
              required: ['role', 'text'],
              properties: {
                role: { type: 'string', enum: ['user', 'assistant'] },
                text: { type: 'string' },
              },
            },
            example: [
              { role: 'user', text: 'What is AI?' },
              { role: 'assistant', text: 'AI is the simulation of human intelligence by machines.' },
            ],
          },
        },
      },
      ChatResponse: {
        type: 'object',
        properties: {
          reply: { type: 'string', example: 'Machine learning is a subset of AI where models learn from data.' },
        },
      },
      HealthResponse: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['ok', 'degraded'], example: 'ok' },
          model: { type: 'string', enum: ['loaded', 'not loaded'], example: 'loaded' },
          circuit: { type: 'string', enum: ['CLOSED', 'OPEN', 'HALF_OPEN'], example: 'CLOSED' },
          queue: {
            type: 'object',
            properties: {
              running: { type: 'integer', example: 0 },
              pending: { type: 'integer', example: 0 },
            },
          },
          uptime_s: { type: 'integer', example: 3600 },
          timestamp: { type: 'string', format: 'date-time' },
        },
      },
      MetricsResponse: {
        type: 'object',
        properties: {
          uptime_s: { type: 'integer' },
          requests: {
            type: 'object',
            properties: {
              total: { type: 'integer' },
              success: { type: 'integer' },
              error: { type: 'integer' },
              queued: { type: 'integer' },
            },
          },
          latency_ms: {
            nullable: true,
            type: 'object',
            properties: {
              avg: { type: 'integer' },
              p50: { type: 'integer' },
              p95: { type: 'integer' },
              p99: { type: 'integer' },
              max: { type: 'integer' },
            },
          },
          error_rate_pct: { type: 'number' },
          model: { type: 'string' },
        },
      },
      ErrorResponse: {
        type: 'object',
        properties: {
          error: { type: 'string', example: 'message is required and must be a non-empty string.' },
        },
      },
    },
  },
  paths: {
    '/chat': {
      post: {
        summary: 'Chat with Gemma',
        description: 'Send a message to the Gemma model. Optionally include conversation history and a system prompt for multi-turn, persona-driven conversations.',
        operationId: 'chat',
        security: [{ BearerAuth: [] }],
        tags: ['Inference'],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ChatRequest' } } },
        },
        responses: {
          200: { description: 'Model reply', content: { 'application/json': { schema: { $ref: '#/components/schemas/ChatResponse' } } } },
          400: { description: 'Invalid request body', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          401: { description: 'Missing or invalid API key', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          429: { description: 'Rate limited or queue full', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          503: { description: 'Ollama service unavailable', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          504: { description: 'Inference timed out', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
        },
      },
    },
    '/health': {
      get: {
        summary: 'Health check',
        description: 'Returns server health, Ollama status, and circuit breaker state. Always public — used by load balancers.',
        operationId: 'health',
        tags: ['System'],
        responses: {
          200: { description: 'Healthy', content: { 'application/json': { schema: { $ref: '#/components/schemas/HealthResponse' } } } },
          503: { description: 'Degraded — Ollama unreachable or model not loaded', content: { 'application/json': { schema: { $ref: '#/components/schemas/HealthResponse' } } } },
        },
      },
    },
    '/metrics': {
      get: {
        summary: 'Request metrics',
        description: 'Returns request counts, error rate, and latency percentiles (rolling last 1000 requests).',
        operationId: 'metrics',
        security: [{ BearerAuth: [] }],
        tags: ['System'],
        responses: {
          200: { description: 'Metrics snapshot', content: { 'application/json': { schema: { $ref: '#/components/schemas/MetricsResponse' } } } },
          401: { description: 'Missing or invalid API key', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
        },
      },
    },
  },
};

export function setupSwagger(app) {
  app.use(
    '/api/docs',
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, {
      customSiteTitle: 'Gemma API Docs',
      customCss: '.swagger-ui .topbar { display: none }',
      swaggerOptions: { persistAuthorization: true },
    }),
  );
  // Raw JSON spec — useful for importing into Postman / Insomnia
  app.get('/api/docs.json', (_req, res) => res.json(swaggerSpec));
}
