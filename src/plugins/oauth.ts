import type { FastifyInstance } from 'fastify';
import oauth2 from '@fastify/oauth2';
import { buildConfig } from '../config/index.js';

// Hardcoded because @fastify/oauth2's TS types don't expose these on the
// default export (only on the FastifyOauth2 interface). Values match runtime output.
const GOOGLE_CONFIGURATION = {
  authorizeHost: 'https://accounts.google.com',
  authorizePath: '/o/oauth2/v2/auth',
  tokenHost:     'https://www.googleapis.com',
  tokenPath:     '/oauth2/v4/token',
};

const GITHUB_CONFIGURATION = {
  tokenHost:     'https://github.com',
  tokenPath:     '/login/oauth/access_token',
  authorizePath: '/login/oauth/authorize',
};

/**
 * Registers @fastify/oauth2 for Google and GitHub.
 * Plugin names follow the `oauth2X` convention required by @fastify/oauth2
 * FastifyInstance augmentation (`oauth2${UpperCaseCharacters}${string}`).
 *
 * Decorators added: fastify.oauth2Google, fastify.oauth2Github
 * Start paths: /auth/google, /auth/github
 * Callbacks: /auth/google/callback, /auth/github/callback
 */
export async function registerOAuthPlugin(fastify: FastifyInstance): Promise<void> {
  const config = buildConfig();

  await fastify.register(oauth2, {
    name: 'oauth2Google',
    credentials: {
      client: {
        id:     config.oauth.googleClientId,
        secret: config.oauth.googleClientSecret,
      },
      auth: GOOGLE_CONFIGURATION,
    },
    scope: ['profile', 'email'],
    startRedirectPath: '/auth/google',
    callbackUri: `${config.oauth.callbackBaseUrl}/auth/google/callback`,
  });

  await fastify.register(oauth2, {
    name: 'oauth2Github',
    credentials: {
      client: {
        id:     config.oauth.githubClientId,
        secret: config.oauth.githubClientSecret,
      },
      auth: GITHUB_CONFIGURATION,
    },
    scope: ['user:email'],
    startRedirectPath: '/auth/github',
    callbackUri: `${config.oauth.callbackBaseUrl}/auth/github/callback`,
  });
}
