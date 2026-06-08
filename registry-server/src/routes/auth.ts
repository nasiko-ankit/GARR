import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { getSql } from '../db.js';
import { getConfig } from '../config.js';

const BCRYPT_ROUNDS = 10;

interface UserRow {
  id: string;
  email: string;
  displayName: string | null;
  passwordHash: string;
}

const jwtResponseSchema = {
  type: 'object',
  required: ['token'],
  properties: { token: { type: 'string' } },
} as const;

const errorSchema = {
  type: 'object',
  required: ['error'],
  properties: {
    error:  { type: 'string' },
    detail: { type: 'string' },
  },
} as const;

/**
 * Auth routes for the Registry Server.
 *
 * POST /auth/register  — create account with email + password
 * POST /auth/login     — sign in, get JWT
 * GET  /auth/me        — get current user info (requires JWT)
 *
 * TODO v2: add rate limiting to /auth/register and /auth/login per §9 to prevent brute-force and spam.
 */
export async function registerAuthRoutes(fastify: FastifyInstance): Promise<void> {
  const config = getConfig();

  // Register
  fastify.post<{ Body: { email: string; password: string; display_name?: string } }>(
    '/auth/register',
    {
      schema: {
        tags: ['auth'],
        summary: 'Create a registry account',
        body: {
          type: 'object',
          required: ['email', 'password'],
          additionalProperties: false,
          properties: {
            email:        { type: 'string', format: 'email', maxLength: 255 },
            password:     { type: 'string', minLength: 8, maxLength: 128 },
            display_name: { type: 'string', maxLength: 255 },
          },
        },
        response: { 201: jwtResponseSchema, 409: errorSchema },
      },
    },
    async (request, reply) => {
      const { email, password, display_name } = request.body;
      const sql = getSql();

      const existing = await sql<UserRow[]>`SELECT id FROM users WHERE email = ${email} LIMIT 1`;
      if (existing[0]) {
        return reply.code(409).send({ error: 'CONFLICT', detail: 'email already registered' });
      }

      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      const rows = await sql<UserRow[]>`
        INSERT INTO users (email, display_name, password_hash)
        VALUES (${email}, ${display_name ?? null}, ${passwordHash})
        RETURNING *
      `;
      const user = rows[0]!;

      const token = await reply.jwtSign(
        { userId: user.id, email: user.email, displayName: user.displayName },
        { expiresIn: config.jwt.expiresIn },
      );
      return reply.code(201).send({ token });
    },
  );

  // Login
  fastify.post<{ Body: { email: string; password: string } }>(
    '/auth/login',
    {
      schema: {
        tags: ['auth'],
        summary: 'Sign in and get a JWT',
        body: {
          type: 'object',
          required: ['email', 'password'],
          additionalProperties: false,
          properties: {
            email:    { type: 'string', format: 'email', maxLength: 255 },
            password: { type: 'string', minLength: 1, maxLength: 128 },
          },
        },
        response: { 200: jwtResponseSchema, 401: errorSchema },
      },
    },
    async (request, reply) => {
      const { email, password } = request.body;
      const sql = getSql();

      const rows = await sql<UserRow[]>`SELECT * FROM users WHERE email = ${email} LIMIT 1`;
      const user = rows[0];

      if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
        return reply.code(401).send({ error: 'UNAUTHORIZED', detail: 'invalid email or password' });
      }

      const token = await reply.jwtSign(
        { userId: user.id, email: user.email, displayName: user.displayName },
        { expiresIn: config.jwt.expiresIn },
      );
      return reply.code(200).send({ token });
    },
  );

  // Me — current user info
  fastify.get(
    '/auth/me',
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ['auth'],
        summary: 'Get current user info',
        response: {
          200: {
            type: 'object',
            required: ['user_id', 'email'],
            properties: {
              user_id:      { type: 'string' },
              email:        { type: 'string' },
              display_name: { type: ['string', 'null'] },
            },
          },
          401: errorSchema,
        },
      },
    },
    async (request, reply) => {
      const user = request.user;
      return reply.send({
        user_id:      user.userId,
        email:        user.email,
        display_name: user.displayName,
      });
    },
  );
}
