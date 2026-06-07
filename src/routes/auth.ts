import type { FastifyInstance } from 'fastify';
import { upsertUser } from '../db/queries/users.js';
import { buildConfig } from '../config/index.js';

interface GoogleUserInfo {
  id: string;
  email: string;
  name?: string;
  picture?: string;
}

interface GitHubUserInfo {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
}

interface GitHubEmail {
  email: string;
  primary: boolean;
  verified: boolean;
}

/**
 * OAuth callback routes for Google and GitHub.
 * Both follow the same pattern:
 *   1. Exchange code for access token via @fastify/oauth2
 *   2. Fetch user profile from provider API
 *   3. Upsert user in DB
 *   4. Sign JWT and redirect to frontend /auth/callback?token=<jwt>
 *
 * Decorator names: fastify.oauth2Google, fastify.oauth2Github
 * (matches the `oauth2X` template literal type from @fastify/oauth2)
 */
export async function registerAuthRoutes(fastify: FastifyInstance): Promise<void> {
  const config = buildConfig();

  // Google OAuth callback
  fastify.get('/auth/google/callback', async (request, reply) => {
    try {
      const tokenData = await fastify.oauth2Google!.getAccessTokenFromAuthorizationCodeFlow(request);
      const accessToken = tokenData.token.access_token as string;

      const profileResp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!profileResp.ok) {
        return reply.redirect(`${config.frontendUrl}/login?error=profile_fetch_failed`);
      }
      const profile = await profileResp.json() as GoogleUserInfo;

      const user = await upsertUser({
        email:       profile.email,
        displayName: profile.name ?? null,
        avatarUrl:   profile.picture ?? null,
        provider:    'google',
        providerId:  profile.id,
      });

      const token = await reply.jwtSign(
        { userId: user.id, email: user.email, displayName: user.displayName },
        { expiresIn: config.jwt.expiresIn },
      );

      return reply.redirect(`${config.frontendUrl}/auth/callback?token=${token}`);
    } catch (err) {
      fastify.log.error(err, 'Google OAuth callback error');
      return reply.redirect(`${config.frontendUrl}/login?error=oauth_failed`);
    }
  });

  // GitHub OAuth callback
  fastify.get('/auth/github/callback', async (request, reply) => {
    try {
      const tokenData = await fastify.oauth2Github!.getAccessTokenFromAuthorizationCodeFlow(request);
      const accessToken = tokenData.token.access_token as string;

      const profileResp = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'User-Agent': 'NANDA-Index-Server',
        },
      });
      if (!profileResp.ok) {
        return reply.redirect(`${config.frontendUrl}/login?error=profile_fetch_failed`);
      }
      const profile = await profileResp.json() as GitHubUserInfo;

      // Fetch primary verified email (profile.email may be null for private accounts)
      let email = `${profile.login}@github.noreply`;
      const emailsResp = await fetch('https://api.github.com/user/emails', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'User-Agent': 'NANDA-Index-Server',
        },
      });
      if (emailsResp.ok) {
        const emails = await emailsResp.json() as GitHubEmail[];
        const primary = emails.find(e => e.primary && e.verified);
        email = primary?.email ?? emails[0]?.email ?? email;
      }

      const user = await upsertUser({
        email,
        displayName: profile.name ?? profile.login,
        avatarUrl:   profile.avatar_url,
        provider:    'github',
        providerId:  String(profile.id),
      });

      const token = await reply.jwtSign(
        { userId: user.id, email: user.email, displayName: user.displayName },
        { expiresIn: config.jwt.expiresIn },
      );

      return reply.redirect(`${config.frontendUrl}/auth/callback?token=${token}`);
    } catch (err) {
      fastify.log.error(err, 'GitHub OAuth callback error');
      return reply.redirect(`${config.frontendUrl}/login?error=oauth_failed`);
    }
  });
}
