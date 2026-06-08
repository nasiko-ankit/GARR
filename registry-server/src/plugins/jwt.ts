import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fjwt from '@fastify/jwt';
import { getConfig } from '../config.js';

export interface JwtPayload {
  userId: string;
  email: string;
  displayName: string | null;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export async function registerJwtPlugin(fastify: FastifyInstance): Promise<void> {
  const config = getConfig();
  await fastify.register(fjwt, { secret: config.jwt.secret });

  fastify.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ error: 'UNAUTHORIZED', detail: 'missing or invalid token' });
    }
  });
}
